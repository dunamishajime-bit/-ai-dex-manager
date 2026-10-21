# V12 V4 LONG + SHORT risk-first exit rollout — source-only handoff

Status: RESEARCH_POLICY_IMPLEMENTED_AS_PURE_FUNCTIONS / RUNNER_NOT_WIRED / NOT_LIVE

## Scope

This branch keeps the previously user-selected V12 V4 LONG rules
from parent commit f63314c066df7a3721880733f841c1b931a47f34:
- TIME37 LONG: initial entry-relative -8% emergency STOP
- After observed completed M5 LONG MFE >= +2%: desired emergency STOP -5%
- Separate X09/X10/X14 LONG: +3% MFE to +1% with 2 completed bearish H1

New V12 V4 SHORT two-axis risk-first candidate:
- All V4 SHORT routes: only after 12 hours since entry, if prior
  max favorable MFE remains below +1%, adverse price +2.5% versus
  signed average entry fill triggers an early exit candidate;
  existing emergency resident SHORT +8% STOP remains intact
- Only after actual filled early SHORT STOP, same symbol+SHORT side
  enters 12h cooldown. Rejected signals, failed orders and profit
  exits MUST NOT create cooldown
- TIME37 SHORT profit protection: MFE >= +5% peak and the SHORT
  unrealized gain has returned to <= +2% following 2 fully closed
  bullish H1 candles -> reduce-only SHORT cover candidate at next
  available market execution. Does not guarantee +2% realized gain
- 3 ATR and 1 NATIVE SHORT still have their own exits; they are
  excluded from this profit guard, but remain eligible for the
  initial adverse-loss research model
- PENGU, Q102, HYPE, V52, FET, Idle and other runners remain unchanged

## Economic evidence (frozen 8 strategy model, 2025-08-10 to 2026-08-10)

Model assumptions: initial JPY 10,000, no topups, compounding, costs
10bps normal and 30bps stress, model price not signed venue fills.
Replayed chronological gross/allocation/position/MTM events.

                          10bps final       10bps DD      30bps final      30bps DD
Untouched model           JPY 222,818,967  -15.621%       JPY 124,289,207  -16.788%
Initial adverse only      JPY 204,448,513  -14.796%       JPY 91,181,051   -15.412%
Initial + Profit +5 to +2 JPY 198,781,134  -14.603%       JPY 80,410,194   -15.773%

The COMBINED proposal improves portfolio DD against untouched baseline
by about +1.02pp for BOTH costs. But it has large 30bps economic decay
(retention ~64.7%) and 30bps DD is WORSE than the initial-only approach.
Thus existing research production economic acceptance gate FAILS.
Treat +5 to +2 as the best of tested SHORT profit guards and a
USER_DESIRED risk-first candidate, NOT a finalized live setting.

Market model 6 candidates x 2 costs, unit tests and 10/10 independent
ledger byte-for-byte hash repeat on research SHA:
ef256afc74b4a7b1eaeeceecf69cba285570a2d7
Research location:
docs/research/results/v12-v4-short-risk-20261021/
V12_V4_SHORT_TWO_AXIS_RESEARCH_REPORT_20261021.md

## Staged source functions, no LIVE operation

New pure TS:
lib/v12-v4-short-two-axis-research-policy.ts
tests/v12-v4-short-two-axis-research-policy.test.ts

These are research policy predicates only. Source models historical
completed M5/H1 candles; the TS prototype candidate observes closed M5.
Neither equivalence for intra-M5 fills nor signed venue execution has
been certified. The V4 runtime currently does NOT call these functions.

Production gate:
1. Exact user/operator acceptance of SHORT numeric thresholds, explicit
   acknowledgement of 30bps capital/DD tradeoff and fresh holdout.
2. Pair the source repo long and short branches with current release.
   Verify exact current Production SHA, flatness, orders, peer ownership.
3. Persistent per-virtual-leg MFE and H1 confirmation with no lookahead,
   restart monotonic STOP and arm state, real signed average fill.
4. Existing +8% resident STOP remains until an actual replacement/exit
   is ACKed/read back; maintain unique reduce-only protection per leg,
   partial fills, stopped/closed position lifecycle, no unprotected gap.
5. Only genuine venue EXIT_FILL by authorized initial SHORT STOP causes
   same-side cooldown. Signed venue order, position and fill evidence.
6. Account/shared lock and Aster rate-budget, Shared Risk, Margin Guard,
   Kill Switch, pending gross, duplicate order and exit/STOP race,
   rollback, exact operator approval, CI, telemetry and watchers.
7. Independent new Task9 dynamic allocator both-cost model / event / MTM
   parity, and genuinely unused out-of-sample robustness.
8. No LIVE/VPS/release/operator/order/position mutation from this branch.
