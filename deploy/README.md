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
