# BT PR #481 — Q102 native 180-day monthly rule selector on isolated closed-trade evidence

Date: 2026-11-15. This is an **offline research-only source adapter**, not the live production Q102 signal or a completed integrated synthetic backtest.

## Preserved original selector

The pinned original `lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline.ts` source has upstream SHA256 `7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f` (reference source details in the Q102 source documentation). It contains the original `selectQuality102HighVolMonthlyRule()` which requires exact month-start boundaries, the preceding 180-day window (start = month start minus 180 days, end = month start minus 1 hour), at least five closed trades, positive sum and expectancy, PF >=1.15, a win rate >=52%, and `availableAtTs <= trainingEndTs`. The source computes Wilson/expectancy/Profit Factor/DD scoring and selects one eligible rule.

The new `q102-highvol-closed-ledger-monthly.ts` adapter runs that **existing native selector unchanged**, using an *explicitly provided* list of isolated, completed research trade outcomes and exact 180-day coverage metadata. It never manufactures missing wins, net returns, monthly rule IDs, or the upstream S1/S2 stage membership.

## Fail-closed and proof requirements

- No ledger supplied => `MISSING_COMPLETED_LEDGER`, zero rule signals.
- Missing/inexact 180d data coverage, duplicated trade IDs, open/unclosed trades, future entry/exit, pre-window trades, invalid realized net returns and rules outside native grid => explicit hard rejection.
- For an exact, engineered research ledger, the adapter computes total net return, wins, payoff sums, profit factor, expectancy and multiplicative research drawdown and asks the native monthly selector for the winner. The selected rule remains `SELECTED_RESEARCH_ONLY`: **never promoted to executable S1/S2**, no verified source IDs, no positions, orders, Gross, PnL or portfolio admission. Its compound-trade DD calculation is research adapter evidence, not proof of historical production DD semantics.
- The existing current BT page does **not** have a signed/validated completed S1/S2 trade ledger covering a genuine preceding 180 days. Therefore the real workspace remains **blocked** for monthly S1/S2 trading decisions.

## Tests

`scripts/bt-hp-q102-180d-native-monthly-ledger-selftest.ts` exercises source native selection on two strictly engineered collections for the March 1, 2026 UTC monthly boundary: eight closed wins/losses for a qualifying rule and eight lower-quality closed outcomes for an ineligible rule. The native selector chooses the qualifying research rule; no production entry is authorized. The test also checks absence of ledger, under-five-trade case, invalid month start, insufficient coverage, duplicate trade IDs, unclosed and future trade rejection, invalid realized returns, invalid rule grids, deterministic repeatability and zero fills.

**These 16 engineered closed trades are positive/negative unit fixtures, not historical or simulated STABLE4 trades.** They must never be advertised as results of actual price-path execution.

## Still required before real 180-day Q102 simulation

Produce the exact full native S1/S2 signals on completed causal synthetic history, simulate their native exits and venue fee/funding assumptions, emit event-level closed trade evidence with original stage membership and pin SHA, and validate a complete pre-evaluation 180-day training window. Only then can the monthly selector feed future timestamped S1/S2 entry decisions. All-layer opportunity, Q102 one-slot, V4 priority, Shared Risk, combined 7-family MTM and owner-approved HP deployment remain independent gates.

No LIVE, Codex worktree, VPS, real order, STOP or risk setting was changed.
