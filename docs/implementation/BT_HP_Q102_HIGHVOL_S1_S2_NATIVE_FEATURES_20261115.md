# BT PR #481 — Q102 S1/S2 native HIGH_VOL input evaluation, without fabricated 180-day selectors

Date: 2026-11-15 JST. Scope: isolated BT page branch only. No live runner, order, STOP, deployment, Codex worktree, GitHub master merge or authorization changed.

## What is genuinely connected

Source checkout: `9118eeaa6c209dc6e37887cf5be139b3baaa005d`, read-only reference `C:\tmp\disdex-stable4-impl-20261114`. The original pure source `lib/disdex-quality102-causal-pipeline.ts` was copied **byte for byte** to `lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline.ts`. Windows original SHA256 `7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f`. Existing pinned S3/S4 selector in the same research directory is reused. The native algorithm, grid thresholds, monthly selection rules, and native exits were not changed.

The new adapter `highvol-probe.ts` accepts only 337 fully completed, contiguous H1 synthetic candles. It rejects future/stale, invalid OHLCV and missing H1 bars and invokes the original `computeQuality102HighVolFeatures` and `matchQuality102HighVolGrid` functions. It currently tests the 11 instruments in the frozen Q102 S3/S4 model universe as an **exploratory coverage sample**, not as proof they belong to the exact S1/S2 upstream membership.

## Critical missing data and fail-closed boundary

Actual native `generateQuality102HighVolSignals` requires a month-start-indexed `monthlyRules` map from `selectQuality102HighVolMonthlyRule`, whose own eligibility requires the **exact preceding 180 days of measured completed trades**, qualifying sample size, profitability, profit factor, win rate, expectation, drawdown, and valid time provenance. The upstream S1/S2 stage membership also requires explicit eligible IDs from the upstream producer. These are **not available** in the BT page's synthetic 22-day data.

A raw grid threshold match (for example, satisfying a volume/RSI/14d-return rule) is **not an entry candidate**. No default or handpicked monthly rule is injected. No S1/S2 membership is invented. Thus the new audit always reports `hasVerifiedMonthlyRules=false`, `stageMembershipKnown=false`, `nativeSelectedEntryCandidates=0`, and `simulationFills=0`. No new signal can enter a backtest portfolio, PnL, stop ledger, capital slot, shared-risk or opportunity logic.

Source `generateQuality102HighVolSignals` is called in a negative fixture with a genuinely **empty monthlyRules map**, verifying that even with prepared H1 and a modeled next H1 OPEN, no native signal is generated. A separate positive fixture tests the source `matchQuality102HighVolGrid` directly, not by inventing trades.

## Deterministic artificial input evidence

Test `scripts/bt-hp-q102-highvol-source-selftest.ts` uses `seed=20261115`, `scenario=volatile`, opt-in 26-instrument synthetic market v3, for 2025-10-01 00 UTC through 2025-10-23 00 UTC. In this **invented** 22-day sample:

- H1 observations: 528; required 337-H1 history implies 336 warm-up decision hours, 192 native feature evaluation hours.
- Number of exploratory model symbols that receive all required synthetic H1 inputs: 11/11.
- Raw grid threshold matches: **940**, including simultaneous/overlapping parameter combinations. The count is **not** 940 independent trade events.
- Genuine S1/S2 monthly-selected entries: 0. Orders/fills: 0.
- The earlier source-pinned Q102 S3/S4 and PENGU/FET/IDLE native shadow evaluations remain isolated and unchanged.

The UI now displays the 22-day source feature evaluation, raw threshold matches, missing 180-day selector and missing stage membership separately. Any combination or stage promotion of these thresholds to trades would require the exact upstream 180-day causal training and membership evidence first.

## Next engineering dependencies

1. Generate or import at least 180 full prior calendar days of strictly causal synthetic data and completed H1 outcomes for monthly S1/S2 selector training, without touching the frozen historical STABLE4 backtest ledger or conflating simulated market returns with real market evidence.
2. Recover exact upstream S1/S2 stage IDs from source data and verify eligible rule selection by as-of month; if unavailable, remain fail-closed.
3. Add Q102 Online historical closed outcomes/KNN + limited eligible revival and shared Q102 one-slot comparison.
4. Connect production-parity source V4/V52, PENGU and IDLE lifecycle/exit, seven-runner portfolio opportunity, shared Gross/Risk, and exhaustive 6-month integrated artificial-market replay; verify UI E2E and authorized formal deploy afterward.

No claim is made that the original 13.54m yen STABLE4_OPPORTUNITY historical equity can be recovered from invented OHLCV.
