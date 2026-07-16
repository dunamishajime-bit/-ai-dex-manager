# Research Lab Live Dashboard

## Deployment target

The dashboard is designed for the existing XServer VPS deployment of DisdexManager.

- It runs inside the existing Next.js Node process started by `next start`.
- It does not require Vercel, a serverless runtime or a new database.
- It does not require a GitHub token because the repository and autonomous state branch are public.

## Data flow

1. GitHub Actions completes an autonomous research cycle.
2. The workflow writes state to the `research-autonomous-state` branch.
3. The XServer VPS endpoint `/api/research-lab/latest` reads the latest JSON state from GitHub.
4. The endpoint keeps a 60-second in-process cache to reduce outbound requests.
5. `/research-lab` refreshes the dashboard every 60 seconds.

If GitHub is temporarily unreachable, the endpoint returns the last in-memory payload as stale data rather than clearing the dashboard.

## Displayed metrics

- Current cycle and next research profile.
- Latest Train, OOS, MaxDD and worst Stress metrics.
- Total unique tested logic and current-cycle deduplication statistics.
- Cycle-by-cycle Train / OOS / Stress trend chart.
- Latest validation counts and final candidate count.
- Automatic reflection plan for the next cycle.
- Elite strategy family, symbols, timeframe, leverage, risk and Edge / Cost threshold.
- Direct links to Actions, latest report, state branch and Issues.

## VPS deployment

After merging to `master`, update the existing VPS checkout and rebuild the running Next.js application using the same process manager already used by DisdexManager.

Typical application commands are:

```bash
git pull origin master
npm ci
npm run build
npm run start
```

When PM2 or systemd already manages `npm run start`, restart that existing service instead of starting a second process.
