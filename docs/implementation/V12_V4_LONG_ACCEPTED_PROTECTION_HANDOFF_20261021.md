# V12 V4 LONG protection — adopted rules (2026-10-21)

Status: **Operator selected / pure rule code and tests / not connected to LIVE**.

## Adopted TIME37 risk rule

- Scope: LONG side of all 37 TIME exit routes. Leave ATR(3),
  NATIVE(1), all SHORT and other strategies untouched.
- Initially: protective STOP trigger at **entry -8%**.
- Once a completed five-minute candle observes **MFE >= +2%**
  of the signed average entry fill: move the desired protective
  STOP trigger to **entry -5%**.
- Save the armed state per virtual position; reloading must never
  lower its desired STOP from -5% back to -8%.
- STOP-market prices can slip. -5% is not a guaranteed fill.
- This change prioritizes individual downside control over profits.

## Previously selected LONG profit protection

- If **MFE >= +3%**, then return falls to **+1% or less**
  and two completed H1 closes confirm a bearish decline, exit.
- The economic BT and code selector cover **X09/X10/X14** only.
  No unverified expansion of this second rule is implied.

## Historical all-eight-strategy model (one year)

Initial JPY 10,000, no deposits; 10bps/30bps costs.
TIME37 +2% arm -> -5% floor, together with the previous
three-route +3% to +1% exit:
- 10bps final: JPY 216,725,170
- 30bps final: JPY 115,339,340

This lost more profit and slightly worsened portfolio maximum
mark-to-market drawdown in both cost assumptions. Historical
losers rescued: zero. The user accepts this as a tail-loss policy;
do not call it a proven improvement in maximum portfolio DD.

Research SHA: 40107b7ae487b102687b462dfd1f3ba5c9492b56.
Implementation source base: e523f29a6dbbfc5f752f2f3a530f5f73975acec9.

## Git contents and remaining wiring

Pure policy: lib/v12-v4-long-accepted-exit-policy.ts
Tests: tests/v12-v4-long-accepted-exit-policy.test.ts

Remaining for actual deployment: journalled causal M5 state;
signed fill and average-price handling; persistent STOP migration;
readback before retiring old STOP; restart and partial-fill safety;
exact release/operator certification; independently verified dynamic
eight-strategy engine matching; execution/rollback verification.

Existing LIVE, VPS, exchange positions and STOP orders unchanged.
Pushing this branch is not deployment or live activation.
