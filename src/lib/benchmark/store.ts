import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { candidates } from "./schema";
import type { Candidate } from "./types";
export function openStore(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 4,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 20000,
  });
  const db = drizzle(pool);
  return {
    db,
    pool,
    async seedCandidates(rows: Candidate[]) {
      for (let i = 0; i < rows.length; i += 200)
        await db
          .insert(candidates)
          .values(rows.slice(i, i + 200))
          .onConflictDoNothing();
    },
    close: () => pool.end(),
  };
}
export type Store = ReturnType<typeof openStore>;
let singleton: Store | undefined;
export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Benchmark database is not configured");
  return (singleton ??= openStore(url));
}
export async function migrateStore(store: Store) {
  await migrate(store.db, { migrationsFolder: "drizzle" });
}
