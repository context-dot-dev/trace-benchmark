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

## Railway migration

The Railway runtime uses one service and one volume for the dashboard and collector.
Mount a volume at `/data`; SQLite and receipt blobs live in `/data/private`, and
only the generated exports in `/data/public` are served. Keep one replica and
serverless/app sleeping disabled. The existing collector requires at least 10 GB
of free space before dispatch: provision at least 30 GB for the current 8.6 GB
archive plus growth. Enable Railway volume backups before cutover.

`Dockerfile` builds the existing Vite client and SSR app, installs the locked Python
dependencies, and starts `deploy/railway.py` under tini. `railway.json` uses
`/healthz` to verify that a real publication is readable. A missing imported
database fails startup instead of silently creating an empty replacement.
`TRACE_WORKER_ENABLED` defaults to `0`, so preview deployments cannot spend credits.

The supervisor runs the collector at 00:15 UTC with an 18-hour deadline, preserves
the worker lock and stored dispatch reservations, and stops both processes on
SIGTERM. A missed daily slot runs on startup once collection is enabled. The slot
is persisted before dispatch; a failed or interrupted job is logged and is not
repeated automatically in the same slot. The next daily tick resumes unfinished
work according to the existing CLI's recovery rules. For an intentional same-day
resume, run `python -m bench.cli tick --state /data/private --export /data/public/latest.json`
inside the service after checking that no collector is active.

### Doppler and automatic deployment

The Doppler project is `trace-benchmark`, production config `prd`, in the Context
workspace. It holds `CONTEXT_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`,
`KEENABLE_API_KEY`, and `TYPESAFE_API_KEY`. Connect this config through Doppler's
Railway integration to the TRACE service in **motivated beauty**. Sync variables
at runtime; never pass API keys as Docker build arguments or commit an env file.
Keep `TRACE_WORKER_ENABLED=0` in Doppler until the cutover below is complete.

Connect the service to this GitHub repository's `main` branch and enable Railway's
Wait for CI setting. `.github/workflows/verify.yml` checks the real runtime against
a temporary volume, builds the container, and retains its verification artifact.
Once the integration is connected, passing main-branch changes deploy automatically.
A draft PR does not authorize merging or enabling collection.

### Cutover and rollback

1. Create the service and volume in **motivated beauty**, with collection disabled.
   Import the data before expecting the health check to pass. The CLI can upload
   a directory with `railway volume files upload ./trace-import /private` against
   the linked service. Do not upload credentials or private state into `/public`.
2. Disable `trace-bench.timer` on Hetzner. If `trace-bench.service` is active, let it
   finish before the final copy; stopping the timer does not stop that job. Keep
   `trace-dashboard.service` running during verification.
3. Make a consistent SQLite backup using Python's `sqlite3.Connection.backup` and
   copy the receipt `blobs`, discovery data and historical screenshots into the
   import directory. Preserve the full original state as rollback evidence.
   Upload that directory to `/private`. Do not carry over the old browser cache,
   logs, or redundant database backups. The current live protocol does not render
   browser references; historical screenshot files are retained as evidence.
4. Deploy, verify `/healthz`, `/api/summary`, a result detail, a manifest and the
   complete download. Compare run IDs and record counts with Hetzner. Run
   `TRACE_PRODUCTION_URL=https://YOUR-RAILWAY-DOMAIN node scripts/verify-production.mjs`.
   Confirm private paths return 404 and verify the volume survives a restart.
5. Set `TRACE_WORKER_ENABLED=1` in Doppler, sync, and verify exactly one collector.
   Only then move the public domain/proxy. Retain Hetzner's state for rollback.
6. To roll back, disable and stop the Railway collector first, reconcile any new
   Railway runs back to the retained state, then re-enable the Hetzner timer.
   Never run both collectors against divergent copies of the database.

## Vercel and the permanent domain

The ContextDev Vercel team currently rejects project creation (403). The personal
`mrmps-projects` team rejects deployment because of a fair-use billing block (402).
No production Vercel project was created. Do not use an unrelated team's project.

`deploy/vercel/vercel.json` contains the optional HTTPS proxy configuration. Once
ContextDev project-creation access is granted:

```sh
vercel project add trace-benchmark --scope contextdev
vercel link --yes --project trace-benchmark --scope contextdev --cwd deploy/vercel
vercel deploy --prod --yes --scope contextdev --cwd deploy/vercel
```

The current URL relies on sslip.io DNS and this server's address. Next, assign a
permanent Context-owned domain (for example `trace.context.dev`, after confirming
its availability), update Caddy and the citation, and add uptime/failure alerts.
Vercel would serve as the public proxy; the scheduled worker remains on Hetzner.
This keeps long API runs outside serverless execution limits.
