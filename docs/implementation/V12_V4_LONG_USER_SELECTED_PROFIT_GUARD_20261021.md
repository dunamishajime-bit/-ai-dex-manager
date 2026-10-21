# V12 V4 LONG +3% to +1% bearish-confirmed profit guard — USER SELECTED

## Adoption status

**USER_SELECTED_RESEARCH_POLICY — NOT DEPLOYED / NOT PRODUCTION CERTIFIED.**

The user selected: Once a V12 V4 LONG position reaches maximum unrealized
gain of +3.0%, if its gain subsequently contracts to +1.0% or below AND
bearish trend reversal is confirmed, exit the remaining LONG.

The only economically backtested version is
PROFIT_X_3P0_FLOOR1P0_BEAR2, applying to three TIME routes:
REC_X09_TIME_48H, REC_X10_TIME_48H and REC_X14_TIME_48H.
It requires two successive completed bearish H1 closes, with exit
modeled at the next 5m market open. The remaining 34 TIME routes,
three ATR routes and one NATIVE route have not passed equivalent BT:
do not silently apply to all 41 routes.

## Exact economically replayed impacts

Full 8-logic price model, 2025-08-10 through 2026-08-10, initial 10,000 JPY,
no subsequent capital contributions.

- 10bps: baseline 222,818,966.878 JPY; selected 222,373,710.680 JPY.
  Change -445,256.198 JPY (-0.200% of baseline net profit).
  Maximum MTM DD unchanged -15.620637%.
  Original losing positions improved 0, original winners cut early 1.
- 30bps: baseline 124,289,206.818 JPY; selected 123,696,117.154 JPY.
  Change -593,089.664 JPY (-0.477% of baseline net profit).
  Maximum MTM DD unchanged -16.787769%.

Explicit user policy selection is NOT evidence of a DD improving backtest;
therefore model approval, economic adoption and actual LIVE deployment must
be tracked separately.

## The +2% gain / reversal gap

An earlier profit peak of +2.0% through +2.999% never arms the chosen +3%
criterion. Under current TIME routes, the resident emergency stop remains
-8% of original average entry fill. The user's +2% reversal risk remains
UNADDRESSED by the selected rule.

Three separate NONADOPTED protective fallback candidates are being
backtested for the same three TIME LONG routes:
1. +2% arm and 2 completed bearish H1 closes, exit at closed-H1 -2%.
2. Same, with -1% H1-close threshold.
3. Same, with 0% H1-close threshold before fees/slippage.
After +3% arm, the user-selected +1% reversal threshold always takes
priority over the exploratory +2% fallback. Do not promote either
untested/uneconomic backup to LIVE without a new operator decision.

## Real exchange implementation limitations

The current pinned V4 LIVE code uses entry fill x 0.92 for a TIME LONG
resident emergency STOP. It currently rejects protective LONG stop
quotes at or above entry in lib/v12-v4-runner-engine.ts
ensureResidentProtection and recalculates the original -8% level
whenever it reconciles.

A completed-H1 decline model which submits at the next 5m open
**does not guarantee** realized +1% profit. Gaps, execution delay,
fees, fill price and slippage can result in less than +1% or negative
realized gain. A resident STOP_MARKET tightened to +1% when +3% is
first observed is a DIFFERENT trigger contract from requiring
two bearish completed H1 closes, and requires its own BT/certification.

For real profit protection after +3%:
- Persist per-leg arm and trailing STOP state causally, including
  restart and reconciliation; do not arm from future values.
- Authenticate signed average fills, leg quantity, account exposure
  and open resident STOP orders before adjustment.
- Always protect first: prepare/send/readback replacement
  reduce-only STOP_MARKET with correct order owner, quantity and price,
  then cancel/verify the former STOP, then verify unique owned STOP.
  Do not cancel old STOP before replacement confirmation.
- Move STOP monotonically; restart must not reset +1% protection
  to the initial -8% level. Handle mark below requested price
  with authenticated exit and signed fill; no false price guarantees.
- Validate partial fills, same-symbol virtual ownership, STOP/EXIT races,
  quantity and tick rounding, exchange minimum notional, venue STOP
  condition and duplicate risk, Shared Risk, Kill Switch, margin,
  account mutex, operator exact SHA, rollback, CI and telemetry.
- Independently establish new Task9 dynamic-full8 strategy parity
  with current production before cutover.

The chosen research applies to selected TIME LONG routes only.
DO NOT automatically modify V4 SHORT, other routes, PENGU, HYPE,
FET, V52, Q102, Idle, or existing LIVE STOPs.
**No new trading action or VPS deployment is authorized by this document.**

Source BT: docs/research/results/v12-v4-long-route-risk-20261021/
V12_V4_LONG_H1_TWO_AXIS_RESEARCH_20261021.json
Research code: scripts/dd-reduction/run-task9-v4-long-two-axis-20261021.py
