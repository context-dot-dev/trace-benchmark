import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { and, asc, eq, getTableColumns, isNull, lt, or, sql } from "drizzle-orm";
import { attempts, runs, worker } from "./schema";
import { providers, type Grade, type Provider, type Receipt } from "./types";
import { createReaders, type Readers } from "./providers";
import { claimReads, claimGrades, releaseReads, releaseGrades, saveReceipts, saveGrades, type Attempt } from "./batch-store";
import type { Store } from "./store";

export type ProviderWorker = {
  provider: Provider;
  shard: number;
  shards: number;
  concurrency: number;
  requestsPerSecond: number;
  judgeRequestsPerSecond?: number;
};

const defaults: Record<Provider, { concurrency: number; rps: number }> = {
  context: { concurrency: 512, rps: 10 },
  exa: { concurrency: 512, rps: 5 },
  firecrawl: { concurrency: 50, rps: 100 },
  keenable: { concurrency: 100, rps: 8 },
};

export function providerWorkers(env = process.env): ProviderWorker[] {
  const workers = providers.flatMap(({ id }) => {
    const prefix = "TRACE_" + id.toUpperCase();
    const concurrency = Number(env[prefix + "_CONCURRENCY"] ?? defaults[id].concurrency);
    const rps = Number(env[prefix + "_RPS"] ?? defaults[id].rps);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4096 ||
        !Number.isFinite(rps) || rps <= 0 || rps > 4000)
      throw new Error("Invalid collector capacity for " + id);
    const capacity = Math.min(concurrency, Math.ceil(rps * 30));
    const shards = Math.ceil(capacity / 256);
    return Array.from({ length: shards }, (_, shard) => ({
      provider: id, shard, shards,
      concurrency: Math.floor(capacity / shards) + (shard < capacity % shards ? 1 : 0),
      requestsPerSecond: rps / shards,
    }));
  });
  const judgeRps = Number(env.TRACE_JUDGE_RPS ?? 200);
  if (!Number.isFinite(judgeRps) || judgeRps <= 0 || judgeRps > 10000)
    throw new Error("Invalid collector judge capacity");
  return workers.map((config) => ({ ...config, judgeRequestsPerSecond: judgeRps / workers.length }));
}

function batcher<I, O>(
  inputId: (input: I) => string,
  outputId: (output: O) => string,
  flush: (inputs: I[]) => Promise<O[]>,
) {
  const pending: { input: I; resolve: (value: O | undefined) => void; reject: (error: unknown) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    clearTimeout(timer);
    timer = undefined;
    const group = pending.splice(0, 128);
    try {
      const results = new Map((await flush(group.map((entry) => entry.input))).map((value) => [outputId(value), value]));
      for (const entry of group) entry.resolve(results.get(inputId(entry.input)));
    } catch (error) {
      for (const entry of group) entry.reject(error);
    }
    running = false;
    if (pending.length >= 128) void drain();
    else if (pending.length) timer = setTimeout(() => void drain(), 100);
  }
  return (input: I) => new Promise<O | undefined>((resolve, reject) => {
    pending.push({ input, resolve, reject });
    if (running) return;
    if (pending.length >= 128) void drain();
    else timer ??= setTimeout(() => void drain(), 100);
  });
}

function limiter(capacity: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < capacity) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try { return await fn(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

function pacer(requestsPerSecond: number, stopAt: number) {
  const slot = limiter(1);
  let next = performance.now();
  return (admit?: () => Promise<boolean>) => slot(async () => {
    while (performance.now() < next && Date.now() < stopAt) {
      const wait = Math.min(next - performance.now(), stopAt - Date.now());
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.ceil(wait))));
    }
    if (Date.now() >= stopAt) return false;
    if (admit && !await admit()) return false;
    next = performance.now() + 1000 / requestsPerSecond;
    return true;
  });
}

function pauseGate(store: Store, bucket: Provider | "judge", now: () => Date) {
  const id = `pause:${bucket}`;
  let reason: string | null = null;
  let checkedAt = -Infinity;
  let checking: Promise<boolean> | undefined;
  return {
    get error() { return reason; },
    async paused(): Promise<boolean> {
      if (reason) return true;
      if (Date.now() - checkedAt < 250) return false;
      checking ??= (async () => {
        const [pause] = await store.db.select().from(worker).where(eq(worker.id, id));
        if (pause?.leaseUntil && pause.leaseUntil > now()) reason = pause.error ?? "Provider paused";
        checkedAt = Date.now();
        return reason !== null;
      })().finally(() => { checking = undefined; });
      return checking;
    },
    async pause(status: number) {
      reason = `${bucket === "judge" ? "JUDGE_" : ""}HTTP_${status}`;
      const clock = now();
      const until = new Date(clock.getTime() + (status === 429 ? 60_000 : 900_000));
      await store.db.insert(worker).values({ id, leaseUntil: until, lastTick: clock, error: reason })
        .onConflictDoUpdate({ target: worker.id, set: {
          leaseUntil: sql`greatest(${worker.leaseUntil}, ${until})`,
          lastTick: clock,
          error: sql`case when ${worker.leaseUntil} > ${until} then ${worker.error} else ${reason} end`,
        } });
    },
  };
}

export async function runProvider(store: Store, options: ProviderWorker & {
  readers?: Readers;
  now?: () => Date;
  maxPages?: number;
  deadlineMs?: number;
}) {
  const now = options.now ?? (() => new Date());
  const clock = now();
  const day = clock.toISOString().slice(0, 10);
  const token = randomUUID();
  const workerId = `collector:${options.provider}:${options.shard}`;
  const lease = new Date(clock.getTime() + 300000);
  const deadline = Date.now() + (options.deadlineMs ?? 230000);
  const readers = options.readers ?? createReaders();
  const acquired = await store.db.insert(worker).values({
    id: workerId, claim: token, leaseUntil: lease, lastTick: clock, error: null,
  }).onConflictDoUpdate({ target: worker.id,
    set: { claim: token, leaseUntil: lease, lastTick: clock, error: null },
    setWhere: or(isNull(worker.leaseUntil), lt(worker.leaseUntil, clock)),
  }).returning({ id: worker.id });
  if (!acquired.length) return { status: "busy" as const, processed: 0 };

  let processed = 0;
  let failure: unknown;
  let paused = false;
  const providerPause = pauseGate(store, options.provider, now);
  const judgePause = pauseGate(store, "judge", now);
  let judgePaused = false;
  const providerPaused = async () => {
    if (await providerPause.paused()) paused = true;
    return paused;
  };
  const grades: Promise<void>[] = [];
  try {
    await providerPaused();
    const rows = await store.db.select({ ...getTableColumns(attempts), protocol: runs.protocol })
      .from(attempts).innerJoin(runs, eq(attempts.runId, runs.id)).where(and(
      eq(attempts.provider, options.provider),
      or(eq(attempts.state, "queued"), eq(attempts.state, "fetched")),
      sql`mod(abs(hashtext(${attempts.id})::bigint),${options.shards})=${options.shard}`,
    )).orderBy(asc(attempts.day), asc(attempts.pageId)).limit(options.maxPages ?? 4000);
    const protocols = new Map(rows.map((row) => [row.runId, row.protocol]));
    const claimRead = batcher<Attempt, Attempt>((row) => row.id, (row) => row.id,
      (batch) => claimReads(store, batch, token, day, lease, workerId));
    const releaseRead = batcher<Attempt, Attempt>((row) => row.id, (row) => row.id,
      async (batch) => { await releaseReads(store, batch, token, day); return batch; });
    const persistReceipt = batcher<{ row: Attempt; receipt: Receipt }, Attempt>(
      ({ row }) => row.id, (row) => row.id, (batch) => saveReceipts(store, batch, token));
    const claimGrade = batcher<Attempt, { row: Attempt; reservation: number }>(
      (row) => row.id, ({ row }) => row.id,
      (batch) => claimGrades(store, batch, token, day, lease, workerId));
    const releaseGrade = batcher<{ row: Attempt; reservation: number }, Attempt>(
      ({ row }) => row.id, (row) => row.id,
      async (batch) => { await releaseGrades(store, batch, token, day); return batch.map(({ row }) => row); });
    const persistGrade = batcher<{ row: Attempt; grade: Grade; reservation: number }, Attempt>(
      ({ row }) => row.id, (row) => row.id, async (batch) => {
        await saveGrades(store, batch, token, day);
        return batch.map(({ row }) => row);
      });
    const judgeSlot = limiter(64);
    const paceJudge = pacer(options.judgeRequestsPerSecond ?? 200, deadline - (options.deadlineMs ? 0 : 65000));
    function scheduleGrade(row: Attempt) {
      const task = judgeSlot(async () => {
        if (failure || judgePaused || Date.now() + (options.deadlineMs ? 0 : 65000) >= deadline) return;
        if (await judgePause.paused()) { judgePaused = true; return; }
        const protocol = protocols.get(row.runId);
        if (!protocol) throw new Error("Missing benchmark run protocol");
        const claimed = await claimGrade(row);
        if (!claimed) return;
        let admitted: boolean;
        try {
          admitted = await paceJudge(async () => {
            if (failure || judgePaused || Date.now() + (options.deadlineMs ? 0 : 65000) >= deadline) return false;
            if (await judgePause.paused()) { judgePaused = true; return false; }
            return !failure && Date.now() + (options.deadlineMs ? 0 : 65000) < deadline;
          });
        } catch (error) {
          await releaseGrade(claimed);
          throw error;
        }
        if (!admitted) { await releaseGrade(claimed); return; }
        const grade = await readers.grade(claimed.row, {
          text: gunzipSync(claimed.row.evidence!).toString("utf8"),
          chars: claimed.row.chars ?? 0,
        }, protocol);
        const pauseStatus = grade.error?.match(/^JUDGE_HTTP_(401|402|429)$/)?.[1];
        if (pauseStatus) judgePaused = true;
        await persistGrade({ ...claimed, grade });
        if (pauseStatus) await judgePause.pause(Number(pauseStatus));
        processed++;
      });
      task.catch((error) => { failure ??= error; });
      grades.push(task);
    }
    const queued = rows.filter((row) => row.state === "queued");
    for (const row of rows) if (row.state === "fetched") scheduleGrade(row);
    let next = 0;
    const paceRead = pacer(options.requestsPerSecond, deadline - (options.deadlineMs ? 0 : 95000));
    await Promise.allSettled(Array.from({ length: Math.min(options.concurrency, queued.length) }, async () => {
      try {
        while (!failure && !paused && next < queued.length &&
               Date.now() + (options.deadlineMs ? 0 : 95000) < deadline) {
          const row = await claimRead(queued[next++]);
          if (!row) continue;
          let admitted: boolean;
          try {
            admitted = await paceRead(async () => {
              if (paused || failure || Date.now() + (options.deadlineMs ? 0 : 95000) >= deadline) return false;
              return !await providerPaused() && !failure && Date.now() + (options.deadlineMs ? 0 : 95000) < deadline;
            });
          } catch (error) {
            await releaseRead(row);
            throw error;
          }
          if (!admitted) {
            await releaseRead(row);
            continue;
          }
          const receipt = await readers.read(options.provider, row);
          const pauseStatus = [401, 402, 429].includes(receipt.httpStatus ?? 0);
          if (pauseStatus) paused = true;
          const saved = await persistReceipt({ row, receipt });
          if (pauseStatus) await providerPause.pause(receipt.httpStatus!);
          if (saved) {
            processed++;
            if (saved.state === "fetched") scheduleGrade(saved);
          }
        }
      } catch (error) { failure ??= error; }
    }));
    await Promise.allSettled(grades);
    if (failure) throw failure;
    return { status: "advanced" as const, processed, paused };
  } catch (error) {
    await store.db.update(worker).set({ error: "Collection failed; inspect Vercel runtime logs" })
      .where(and(eq(worker.id, workerId), eq(worker.claim, token)));
    throw error;
  } finally {
    await store.db.update(worker).set({ claim: null, leaseUntil: null, lastTick: now(),
      ...(providerPause.error || judgePause.error ? { error: providerPause.error ?? judgePause.error } : {}),
    })
      .where(and(eq(worker.id, workerId), eq(worker.claim, token)));
  }
}
