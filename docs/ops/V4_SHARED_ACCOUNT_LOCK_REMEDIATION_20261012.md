# V12 V4 shared account-lock contention remediation — 2026-10-12

## Verified changes

- Code fix branch: `fix/v4-account-lock-contention-evidence-20261012`
- Last source commit before this handoff: `1311eba4966be52e4bdbf8b4903e7c81b2ac8383`
- New `lib/v12-v4-lock-contention-observer.ts`: V4 tick wraps existing exclusive account lock acquisition with bounded retry (10 attempts, 750 ms interval; 6.75 s max sleep), never removes or overrides a lock.
- The current lock owner (`ownerId`, acquired/expires timestamps, hashed lease fingerprint, time held/remaining), number of busy attempts, wait duration, and resolution outcome are appended to `/var/lib/disdex/v12-v4/lock-contention-events.jsonl` when **this candidate runner** is activated.
- `scripts/v12-v4-production-runner.ts` invokes the audited wrapper around `engine.tick()`. Existing signed-position, STOP, Gross, peer state, shared account-order lock, and operator gates remain inside the original protected critical section.
- Isolated VPS worktree: `/home/deploy/disdex-trading/work/v4-lock-contention-audit-20261012`. Run 15 focused tests + TypeScript `tsc --noEmit`: **PASS 15/15; typecheck PASS** (checked at commit `b71a9f9a...`; subsequent changes only add Python diagnostic artifacts).
- NO full V4 LIVE switch was authorized by this change. Do not assume source edits are deployed into the live Canary.

## Deployed independent read-only lock owner recorder

Live on Xserver VPS since 2026-10-12 10:32 JST:
- `disdex-v4-account-lock-recorder.service`: independent systemd watcher, read-only to `/var/lib/disdex/shared/account-order.lock`.
- `/usr/local/libexec/disdex-v4-account-lock-recorder.py` (source SHA256 `553b99e80f9f86b8c8aad84d4a161de291266a74229df592091ec425da721dc7`).
- Records lock owner arrivals/releases to `/var/lib/disdex/v12-v4/lock-holder-events.jsonl`, with UTC timestamp, sanitized strategy owner ID, SHA256-shortened lease fingerprint and observed tenure. Does NOT read trading credentials or mutate lock, positions, orders, stops, or Runners.
- Works independently of V4; captures future FET, PENGU, Q102, IDLE etc. owner events. Prior history cannot be reconstructed exactly.

### Quick inspection commands (after following repository AGENTS.md SSH preflight)

```bash
systemctl show disdex-v4-account-lock-recorder.service -p ActiveState -p MainPID -p NRestarts
jq -r 'select(.event=="LEASE_OWNER_OBSERVED")|[.observedAt,.ownerId,.heldForMs,.remainingMs]|@tsv' /var/lib/disdex/v12-v4/lock-holder-events.jsonl | tail -n 35
journalctl -u disdex-v12-v4-canary@447205ee22ab64d2d0013922eeccfd4a1e14a72f.service --since '60 minutes ago' --no-pager -o cat | grep SHARED_ACCOUNT_LOCK_BUSY | tail
```

### Initial forensic findings (not an attribution for all past collisions)

The 2026-10-12 10:32–10:34 JST observer captured owners:
- `FET_BRK48_RESIDUAL:ce1edee...` (three acquisitions),
- `IDLE_PRIORITY_SHORT:...` (one acquisition),
- `IDLE_RESIDUAL_LONG:...` (one acquisition).

A FET ownership interval overlaps a V4 heartbeat with `SHARED_ACCOUNT_LOCK_BUSY`. These are the first concrete owner observations. Historical 13/60 busy ticks happened **before** full owner logging and cannot all be assigned retroactively.

## Deployment boundary for fixed V4 code

At last check, active Canary still uses SHA `447205ee22ab64d2d0013922eeccfd4a1e14a72f`; Production current remains `ce1edeead8d0f9e5d88e829d415057117502a335`. V4 state and operator authorization are bound to the former exact SHA, so **do not patch an immutable live release in place or silently reissue one-entry trading approval**.

Before activating patched exact-SHA Canary, validate fresh signed Aster positions and reduce-only STOPs, execution-store bootstrap/migration, root managed permit, operator activation, mutual exclusion, reproducible tests, rollback, and expected releases. Changing this branch does NOT satisfy real venue lifecycle certification for full Production.

### Safety/reliability principles

- **Never** delete stale lease files or bypass `SHARED_ACCOUNT_LOCK_BUSY` to force an order.
- Preserve all existing Runners, active FET positions and resident protective STOPs.
- Monitor must remain read-only; only the owning Runner may release its lock.
- Determine outcome from logs and actual active unit. Do not claim the retry fix is active until the exact new SHA is deployed and a fresh V4 heartbeat and contention journal demonstrate it.
