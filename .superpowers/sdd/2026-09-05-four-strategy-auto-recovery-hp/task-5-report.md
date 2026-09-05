# Task 5 implementation report

## Scope

- Added non-secret runner IDs, heartbeat paths/roots, and service-unit identity bindings to the Q102, V12, and combined PENGU/V52 units.
- Restored V12 immutable-release marker preflights and `Restart=on-failure` while preserving existing safety defaults and write-path restrictions.
- Kept PENGU V8 and V52 mapped to the single `disdex-v96-v52-live.service` singleton; no second service or account-lock owner was introduced.
- The installer was inspected and left unchanged: its existing exact-release marker checks and combined singleton mappings already satisfy Task 5.
- No installer, systemd, deployment, SSH, exchange, order, cancel, modify, close, position, or user-owned untracked-file operation was performed.

## Files

Committed Task 5 files:

- `ops/systemd/disdex-quality102-causal-v1@.service`
- `ops/systemd/disdex-v12-x1-all@.service`
- `ops/systemd/disdex-v96-v52-live.service`
- `tests/disdex_runner_restart_reconciliation.test.ts`

Inspected but not changed or staged:

- `scripts/ops/install-disdex-runner-health.sh`

## Verification

Exact commands and results:

- `npx tsx --test tests/disdex_runner_restart_reconciliation.test.ts` — PASS; 4 passed, 0 failed.
- `npx tsx --test tests/disdex_runner_health.test.ts` — PASS; 27 passed, 0 failed.
- `npx tsc --noEmit` — PASS; exit code 0.
- `git diff --check` — PASS; exit code 0. Git emitted only existing LF-to-CRLF working-copy warnings for the three service files.

## No-order evidence

The restart fixture reloads one managed `PENGUUSDT` position and one open order with identical state, rejects a second file-backed account-lock owner, and asserts `submit=0`, `cancel=0`, `modify=0`, and `close=0`. Watchdog-cycle fixtures for `MANUAL_REVIEW`, `STALE_DATA`, and `KILL_SWITCH` remain fail-closed, authorize no restart, preserve the non-LIVE safety state, and report `{ ordersSent: 0, cancelSent: 0, positionChangesSent: 0 }`.

## Fix round 1

- V12 remains an intentional `Type=oneshot` service invoking the existing `--once` runner mode. The unsupported `Restart=on-failure` and `RestartSec` directives were removed; the unit documents that bounded operational recovery is performed by the shared watchdog after heartbeat, immutable-release, stop-intent, and safety checks. Existing release markers, SHADOW defaults, kill-switch gates, and locks are unchanged.
- Replaced the snapshot-only restart fixture with two real `V12LiveExecutionEngine.tick()` calls using the production `FileV12X1AllRunnerStateStore`, `FileAccountOrderLock`, shared daily-risk validation, V12 market-data boundary, and adapter/reconciliation interfaces backed by in-memory state. One V52-owned `PENGUUSDT` position and one V52-owned open order reload identically; second lock ownership is rejected; submit/cancel/modify/close counters remain zero.

Exact fix-round commands/results:

- `npx tsx --test tests/disdex_runner_restart_reconciliation.test.ts` — PASS; 4 passed, 0 failed.
- `npx tsx --test tests/disdex_runner_health.test.ts` — PASS; 27 passed, 0 failed.
- `npx tsc --noEmit` — PASS; exit code 0.
- `git diff --check` — PASS; only existing LF-to-CRLF working-copy warnings for the two changed text files.

Commit: `ops: wire fail-closed recovery into runner services`

## Fix round 2

- V12 now uses a systemd-valid `Type=simple` daemon with `--daemon`, `Restart=on-failure`, and `RestartSec=15`. Existing exact-release preflights, SHADOW/disabled-live defaults, safety gates, write-path restrictions, and singleton topology remain unchanged.
- The production watchdog no longer infers an intentional stop from a clean inactive result for the V12 daemon. V12 is held only by the explicit allowlisted stop-intent marker; stale heartbeat recovery remains eligible when the configured service is no longer healthy.
- The restart fixture now seeds an ETHUSDT V12-owned managed position, matching V12 resident STOP_MARKET and TAKE_PROFIT_MARKET orders, and corresponding durable V12 state in `FileV12X1AllRunnerStateStore`. Two real `V12LiveExecutionEngine.tick()` calls exercise credentials/preflight, shared-risk validation, account lock, V12 position/order reconciliation, protection verification, and state reload. The fixture asserts managed position/order/ownership and durable state invariance, two lock acquisitions with maximum one concurrent owner, and zero submit/cancel/modify/close calls.
- No deployment, systemd invocation, network/exchange access, order action, position mutation, installer execution, or user-owned untracked-file operation was performed.

Fix-round verification:

- `npx tsx --test tests/disdex_runner_restart_reconciliation.test.ts` — PASS; 6 passed, 0 failed.
- `npx tsx --test tests/disdex_runner_health.test.ts` — PASS; 27 passed, 0 failed.
- `npx tsx scripts/disdex-v12-x1-all-live-runner.ts --self-test` — PASS; `V12_X1_ALL_RUNNER_SELFTEST_PASS`.
- `npx tsx scripts/disdex-runner-watchdog-selftest.ts` — PASS; `DISDEX_RUNNER_WATCHDOG_SELFTEST_PASS restarts=0 ordersSent=0 cancelSent=0 positionChangesSent=0`.
- `npx tsc --noEmit` — PASS; exit code 0.
- `git diff --check` — PASS; no whitespace errors (Git emitted only existing LF-to-CRLF working-copy warnings for changed text files).
- Limitation: these checks validate the source contract and fixture adapters only; no VPS/systemd/exchange behavior was exercised by design.

## Fix round 3

- V12 now publishes an explicit heartbeat before exiting on disabled or non-live runtime resolution. The heartbeat carries `liveEnabled=false` and `WAITING` when release identity is available, or `UNKNOWN` when identity cannot be verified; no engine is constructed and no order path is entered.
- Watchdog recovery now treats only an explicit non-live `SHADOW`/`PAPER` heartbeat with `WAITING` as an intentional disabled state and returns `NOOP`, including when that heartbeat is stale. A configured active daemon heartbeat remains restartable on staleness, and latched/unknown states remain fail-closed.
- Added an exported, narrow V12 exact-release preflight that verifies the regular `.disdex-release-sha` marker and exact configured SHA. `buildV12LiveRuntime()` runs it before constructing the live client/adapter/engine.
- Extended the restart fixture with a fake watchdog restart adapter/startup harness that executes this production preflight before constructing the real `V12LiveExecutionEngine`, then runs the real reconciliation tick. The fixture preserves the V12-owned ETHUSDT position, resident protection orders, durable state, shared daily risk, and file account lock with zero order/position mutations and one maximum lock owner.
- No deployment, systemd invocation, network/exchange access, order, cancel, modify, close, position mutation, or user-owned untracked-file operation was performed.

Fix-round 3 exact verification:

- `npx tsx --test tests/disdex_runner_restart_reconciliation.test.ts` — PASS; 8 passed, 0 failed.
- `npx tsx --test tests/disdex_runner_health.test.ts` — PASS; 27 passed, 0 failed.
- `npx tsx scripts/disdex-v12-x1-all-live-runner.ts --self-test` — PASS; `V12_X1_ALL_RUNNER_SELFTEST_PASS`.
- `npx tsx scripts/disdex-runner-watchdog-selftest.ts` — PASS; `DISDEX_RUNNER_WATCHDOG_SELFTEST_PASS restarts=0 ordersSent=0 cancelSent=0 positionChangesSent=0`.
- `npx tsc --noEmit` — PASS; exit code 0.
- `git diff --check` — PASS; no whitespace errors; Git emitted only LF-to-CRLF working-copy warnings for the three changed text files.
- Limitation: verification uses in-memory/systemd-mocked fixtures and does not exercise VPS, systemd, exchange, real orders, or position mutations by design.

## Fix round 4 — review round 3 findings

- Intentional enabled `PAPER`/non-`LIVE` V12 configuration now publishes its explicit non-live heartbeat and returns successfully; genuine live gate, release, credential, and startup failures still throw and set a failing process exit through the existing entrypoint handler.
- Added the narrow `buildV12LiveRuntime()` startup seam used by production defaults and the restart fixture. The fixture injects only in-memory engine dependencies, verifies the exact regular-file release marker before engine construction, and re-enters the same production startup seam after the watchdog restart.
- Added an overlapping `FileAccountOrderLock.acquire()` assertion: the second owner returns `null` while the first handle is held; existing zero submit/cancel/modify/close assertions remain.
- No deployment, systemd invocation, VPS/SSH access, network/exchange access, live credentials, order, cancel, modify, close, or position mutation was performed.

Fix-round 4 verification:

- `npx tsx --test tests/disdex_runner_restart_reconciliation.test.ts` — PASS; 9 passed, 0 failed.
- `npx tsx --test tests/disdex_runner_health.test.ts` — PASS; 27 passed, 0 failed.
- `npx tsx scripts/disdex-v12-x1-all-live-runner.ts --self-test` — PASS; `V12_X1_ALL_RUNNER_SELFTEST_PASS`.
- `npx tsx scripts/disdex-runner-watchdog-selftest.ts` — PASS; `restarts=0 ordersSent=0 cancelSent=0 positionChangesSent=0`.
- `npx tsc --noEmit` — PASS; exit code 0.
- `git diff --check` — PASS; only known LF-to-CRLF working-copy warnings.
