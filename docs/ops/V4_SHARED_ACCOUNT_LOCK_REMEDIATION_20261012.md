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

## Phase 2 structural contention reduction (2026-10-12)

**Implementation branch revision tested:** `9305afcd948d842ba8f02acb0fd85257d75f6a4f`. This remains a **staged candidate**, not the running production/Canary SHA.

1. V4 market H2 prefetch:
   - `V4RunnerEngine.prepareFlatMarketDecision()` retrieves completed market candles **before** the shared account lock only if the V4 durable store has no intents and no open/pending legs.
   - The signed account mark, fill reconciliation, resident STOP recovery, Gross/risk/source-parity/authority check, and all order actions remain **inside** `V4RunnerEngine.tick()` under its exclusive lock.
   - After lock acquisition and signed reconciliation, the prefetched result is accepted only within the same H2 boundary and while still flat; after rollover it is discarded and refreshed.
   - Failed prefetch does not bypass in-lock signed account reconciliations; it fails closed after those checks.
   - A wholly busy tick triggers a **15-second next cycle** rather than the ordinary 60-second interval. No candidate expiry is extended; the 15-minute entry freshness check remains mandatory.

2. Idle Priority SHORT / Idle Residual LONG H1 prefetch:
   - Only local flat, no-pending, no-manual-review market snapshots are fetched prior to acquiring the shared account lock.
   - After the lock is acquired and the pending lifecycle is reconciled, the prefetched snapshot is reused only if still flat and from the exact current completed H1 boundary.
   - In active/pending/unknown states, the existing locked protection-and-reconciliation path is used unchanged.
   - Inability to prefetch falls back to original fail-closed locked fetch.

3. FET BRK48:
   - Dominant recorded locker, but **has a live protected position**. Existing FET STOP, held-position reconciliation, exit and profit-floor logic are **not modified**. No speculative lock shrinkage while an active signed position is at stake.
   - Further improvements require separate safe, phase-granular read-only timing evidence and FET protection-first certification before any refactor.

**Observed owner-hold metrics from independent read-only monitor (acquisitions before ~2026-10-12 11:16 JST):**

| Owner | Completed leases | Median hold | Max hold |
|---|---:|---:|---:|
| FET_BRK48_RESIDUAL | 78 | 2.854s | 8.506s |
| V12_V4_RUNNER | 33 | 1.277s | 4.296s |
| IDLE_PRIORITY_SHORT | 9 | 3.394s | 6.852s |
| IDLE_RESIDUAL_LONG | 9 | 3.343s | 5.360s |
| ACCOUNT_CONFIG_READINESS | 8 | 0.413s | 0.875s |

These are **owner-lock hold durations**, not a proven causal attribution for every V4 missed tick.

### Reproducible staging evidence

Staging worktree:
`/home/deploy/disdex-trading/work/v4-lock-contention-audit-20261012`.

- `./node_modules/.bin/tsc --noEmit -p tsconfig.json`: **PASS**.
- `tsx --test tests/idle-lock-safe-market.test.ts tests/idle-priority*test.ts tests/idle-residual*test.ts`: **73 total; 71 pass, 2 pre-existing skips, zero failures**.
- `tsx --test tests/v12-v4-lock-minimal-critical-section.test.ts tests/v12-v4-lock-contention-observer.test.ts tests/v12-v4-runner-engine.test.ts tests/account-lock-bounded-retry.test.ts`: **12/12 PASS**.
- Earlier structural regression with V4 monitor-coherence checks: **18/18 PASS**, with TypeScript PASS.

**Not yet established**: numerical reduction in LIVE lock contention (fix not active), full exchange venue lifecycle certification, exact-SHA trading operator permit, release/rollback/restart certification. Never claim these as accomplished from passing isolated tests.

## Stage-to-LIVE cutover boundary

Active V4 Canary and FET/Idle remain on their previous verified SHAs unless later explicitly and safely switched. **Do not overwrite an immutable release or disable operator/STOP/Gross gates to force this refactor into production.** Protect the current FET resident reduce-only STOP and exact ownership. Before deploying any modified FET/Idle/V4 production bundle: full source/diff review, signed venue inventory/STOP, pending exposure, watchdog, operator artifacts, candidate SHA-bound store migration, live/rollback readiness, phase-integrity tests and explicit deployment authorization.
