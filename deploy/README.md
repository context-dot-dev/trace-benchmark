# Production deployment

Live website: https://trace.2.28.61.111.sslip.io/
Private repository: https://github.com/context-dot-dev/trace-benchmark

The existing Hetzner server (`smry-search`) runs both the daily collector and the
live dashboard. Caddy terminates HTTPS on ports 80/443 and proxies only to the
loopback dashboard at `127.0.0.1:18090`. Its certificate renews automatically.
No API keys, raw private receipts or repository files are served. The source ZIP
is no longer publicly available; source archives are written under `artifacts/`.

## What runs every day

`trace-bench.timer` is enabled with `OnCalendar=*-*-* 00:15:00 UTC` and
`Persistent=true`. That is 5:15 PM Pacific during daylight saving time, 4:15 PM
in standard time, on the preceding local calendar date. Missed activations catch
up when the server returns. Systemd and the worker lock prevent overlapping jobs.

Each tick polls due public feeds/registries, resumes unstarted work, freezes up
to 3,000 independent URLs, and calls Context, Firecrawl, Exa and Keenable. A
separate NEEDLE query cohort uses Context Search to discover URLs. Each provider
gets its zero-age/live-fetch setting. Jev grades and compares the saved outputs.
Shortages, failures and unknown judgments are retained. Paid requests are subject
to provider credits and daily application budgets; 3,000 is a target, not a promise.

The worker atomically exports progress at most once a minute and at completion.
The dashboard picks up changed exports; browsers recheck the small summary every
60 seconds. Rankings use the latest completed daily panel while progress shows
the current run. New data requires no website build or redeploy.

## State and services

- `/opt/trace-bench`: deployed application and static website assets.
- `/var/lib/trace-bench-v2`: canonical SQLite database and private receipt blobs.
- `/etc/trace-bench.env`: private provider credentials (0600).
- `trace-bench.service`: one daily run, 18-hour deadline, 5 GiB memory ceiling,
  four CPU cores, request budgets and a low-disk guard.
- `trace-dashboard.service`: Node 24, artifact backend, 1 GiB memory ceiling,
  768 MiB Node heap, automatic restart on failure.

Neon/Drizzle read-model code is included but is **not the production datastore**.
The collector in this repository uses SQLite. A future Neon migration must be
validated against a backup before switching; do not assume setting DATABASE_URL
migrates the collector or its receipt blobs.

```sh
ssh smry-search 'systemctl list-timers trace-bench.timer --no-pager'
ssh smry-search 'systemctl status trace-dashboard.service caddy --no-pager'
ssh smry-search 'journalctl -u trace-bench.service -n 30 --no-pager'
```

Stopping the timer prevents future activations; it does not stop an active run.
Never delete state or replay already-dispatched requests to recover a failed job.

## Deploying code changes

Run `npm ci && npm run build` locally. Review the change before copying selected
source files, `site/index.html`, `site/assets/`, and `server/render/` to the server.
Preserve `site/data/`, private state and credentials. Restart only the dashboard
for UI changes. Collector changes take effect on its next run; avoid changing an
active run's configuration without a recorded execution segment.

```sh
TRACE_PRODUCTION_URL=https://trace.2.28.61.111.sslip.io node scripts/verify-production.mjs
TRACE_DASHBOARD_URL=https://trace.2.28.61.111.sslip.io node scripts/verify-dashboard.mjs
```

GitHub pushes do not deploy application changes automatically. Daily data updates
are automatic. Keep deploy credentials outside GitHub until a reviewed CI workflow
with scoped credentials is installed.

## Vercel and Neon migration

The `contextdev/trace-benchmark` Vercel project is connected to this repository.
`vercel.json` uses the existing Vite build and `site` output, serves SSR and the
paginated API from Neon, and schedules authenticated collector, export and
publication functions. There is no Hetzner proxy or remote-worker fallback.

Canonical rows, original JSON strings, binary64 reservations, and private receipt
files live in `trace_collector`. Large historical backups are chunked to avoid PostgreSQL single-value limits. The `trace_dashboard` schema remains a public
read model; regenerating it never deletes canonical evidence. Historical legacy
runs are retained. Only the current live protocol is scheduled on Vercel.

Collector ticks use a direct Neon connection and a session advisory lock. Never
use a pooled connection for `TRACE_DATABASE_URL`. Each tick performs one bounded
lane: one source, up to four NEEDLE searches, or eight pages with bounded judging
and comparison. Already-dispatched requests are never replayed after a timeout.
Uncertain completions remain visible for review. Discovery and NEEDLE receive
reserved turns so a large independent run cannot starve them. Reader HTTP timing
runs outside the database event loop to exclude PostgreSQL persistence latency.

Set these server-only values in Doppler `trace-benchmark/prd`, then sync them to
this Vercel project only:

- `TRACE_DATABASE_URL`: direct Neon connection with collector and publication access.
- `DATABASE_URL`: Neon dashboard connection (pooling is supported here).
- `TRACE_DASHBOARD_BACKEND=neon` and `TRACE_COLLECTOR=vercel`.
- The existing five provider/judge credentials.
- `CRON_SECRET`: cryptographically random value, at least 32 bytes of entropy.
- `TRACE_WORKER_ENABLED=0` until the migration passes and the old scheduler stops.

Every cron endpoint rejects missing or incorrect bearer authorization, including
when no secret is configured. Do not expose the secret through a `VITE_` variable,
URL, source file, or logs. Preview environments keep collection disabled. The
configured 4 GB Python functions and minute schedule require a suitable Vercel
plan. Browser-reference dependencies remain available through `uv sync --extra browser` or the full `requirements-lock.txt`; production functions install only the current live collector dependencies. Functions return non-success for failures, and retain tick health in Neon.

### Preserve and verify history before cutover

1. Take an online SQLite backup and copy private `blobs`, `discovery`, screenshots,
   verification evidence and existing backups. Browser binaries and runtime caches
   are replaceable, not historical evidence. Keep the source intact.
2. Once the existing worker is idle, stop its timer, take a final consistent SQLite
   backup and synchronize any new files. Never interrupt an in-flight paid request.
3. In the specifically authorized Neon project, run the import against that frozen
   snapshot using `TRACE_DATABASE_URL`:

   ```sh
   PYTHONPATH=. python -m bench.migrate /secure/snapshot --report artifacts/migration/verification.json
   ```

   This refuses conflicting rows/files and is safe to repeat before collection
   starts. The report compares every table's row count and ordered SHA-256, and
   verifies every private file's bytes and SHA-256 against PostgreSQL. Retain the
   report and backup outside Git. Do not enable collection on a failed report.
4. Apply the existing dashboard migrations with `server/publish.ts`, publish the
   final allowlisted export, and verify SSR, filters, details, downloads, manifests,
   and private-path rejection against a Vercel preview.
5. Only after the full import passes, record `vercel:migration_verified=true` in
   collector metadata. Confirm the old timer is stopped, enable the production
   worker, deploy to production, and verify one real authenticated tick plus its
   persisted receipts. Keep original backups until the new system is verified.
6. Confirm the Vercel deployment tracks the intended reviewed Git revision. Draft
   PRs are not merged automatically. Main pushes deploy through the connected
   Vercel Git integration; CI produces repeatable migration and cron artifacts.

A failed cutover leaves the original state available for rollback. Do not re-enable
both schedulers or copy an old SQLite snapshot over a Neon database that has begun
collecting. New Neon receipts must be reconciled before any reverse migration.
