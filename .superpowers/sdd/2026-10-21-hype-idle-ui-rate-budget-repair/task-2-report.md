# Task 2 report — shared Aster rate budget and account-lock contention

Date: 2026-10-21
Worktree: `C:\Users\dis\.codex\worktrees\hype-idle-ui-rate-budget-repair-20261021`
Commit: `75831a4199010d7497591e0386c39e66d1724d8d`

## Outcome

Same-cycle HYPE and Idle market-data reads are now coalesced at the provider boundary, while completed-candle rollover always starts a fresh request. Protective/reconciliation priority, shared rate-budget enforcement, bounded account-lock retry, fail-closed deferral, order authorization, Gross, STOP/TP, pending exposure, shared risk, Margin Guard, Kill Switch, and ownership behavior were preserved.

## Root cause

- HYPE/ZEC market data had no completed-candle cache or in-flight request coalescer. Two overlapping flat ticks therefore issued duplicate BTC/HYPE (or legacy HYPE/ZEC) kline requests for the same candle boundary.
- Idle already cached completed H1 snapshots, but its in-flight map was keyed only by symbol and limit. If a request crossed an H1 boundary while still pending, a new tick reused the old promise and could receive data captured for the previous completed-candle boundary.
- The shared Aster client already routes requests through the global budget with `PROTECTIVE`/`RECONCILIATION` priority ahead of `MARKET_DATA`; the global budget already rejects saturation in bounded time. The account-lock helper already clamps attempts and retry delay. Existing regression coverage confirmed those safety properties, so no change to those authorization boundaries was necessary for this repair.

## Changed files

- `lib/hype-zec-long-market-data.ts`
  - Added a provider-local completed-candle snapshot cache.
  - Added in-flight coalescing by completed-candle boundary.
  - Uses a 1-hour boundary for TREND mode and a 1-minute boundary for legacy mode.
  - Prevents a slower older-boundary request from overwriting a newer cached snapshot.
- `lib/idle-priority-short-market-data.ts`
  - Made in-flight H1 request keys boundary-aware.
  - Prevents an older request from overwriting a newer H1 snapshot after rollover.
- `tests/hype-zec-market-data-scope.test.ts`
  - Added overlapping HYPE/TREND coalescing and completed-candle rollover coverage.
- `tests/idle-priority-short-market-data.test.ts`
  - Added rollover-while-in-flight coverage proving the new boundary does not reuse the old promise.

No strategy signal, entry threshold, Gross, leverage, STOP/TP, operator gate, order API, credential, VPS, LIVE, or deployment file was changed.

## TDD evidence

The newly added tests were run before the implementation:

- HYPE regression failed because two overlapping loads made 4 kline requests instead of 2.
- Idle rollover regression failed because the new boundary reused the old in-flight request (`1` request observed instead of `2`).

After the minimal provider changes, both regressions passed.

## Verification

Focused Task 2 suite:

```text
npx tsx --test tests/aster-global-rate-budget.test.ts tests/aster-rate-limit-cooldown.test.ts tests/account-lock-bounded-retry.test.ts tests/idle-priority-rate-budget-deferral.test.ts tests/hype-zec-market-data-scope.test.ts tests/idle-priority-short-market-data.test.ts tests/hype-trend-live-contract.test.ts tests/hype-trend-runner-gate.test.ts tests/idle-priority-short-live-path.test.ts
49 passed, 0 failed, 1 skipped
```

The one skipped test is the existing Linux-only PID-reuse check on the Windows host.

Broader related HYPE/Idle/rate-budget/account-lock/residual suite:

```text
npx tsx --test tests/account-lock-bounded-retry.test.ts tests/disdex-expired-account-lock-recovery.test.ts tests/aster-*.test.ts tests/hype-*.test.ts tests/idle-*.test.ts tests/v12-rate-budget-resilience.test.ts tests/v12-rate-budget-state-recovery.test.ts tests/v12-v4-idle-baseline-snapshot.test.ts tests/v52-idle-owner-recovery.test.ts
236 passed, 0 failed, 4 skipped
```

Existing skips were platform/fixture-specific: Linux-only PID reuse, Windows symlink creation, and two residual tests that are intentionally skipped on this host.

TypeScript checks:

```text
npx tsc --noEmit -p tsconfig.json       PASS
npm run typecheck                       PASS
```

## Known limitations

- Coalescing is provider-instance/process local. Separate daemons still rely on the existing shared Aster global rate budget and priority scheduler; this change does not bypass or merge requests across processes.
- A fresh completed-candle boundary intentionally causes a new request even if the prior request is still in flight. This avoids stale data crossing the boundary and may temporarily increase requests during a boundary race.
- Dependency installation was required because the isolated worktree initially had no root `node_modules`; the install used `npm install --ignore-scripts`. No dependency manifest or lockfile change was included in the commit.

