# Aster-only V31 V96-Idle Crypto Fallback Protocol

## Goal

Find an AsterDEX-only, short-horizon Crypto fallback that uses capital only while Production Crypto V96 is flat and exits before the next V96 occupancy window. It must clear the raised acceptance line on its own and improve the unified V96 + V11-EQ + V19 portfolio.

## Frozen architecture

- AsterDEX only;
- universe: BTC, ETH, BNB, SOL, LINK, AVAX, DOGE and AAVE perpetuals;
- exact trailing period: 2025-07-25 through 2026-07-24;
- maximum concurrent Gross 1.0;
- maximum one fallback position;
- maximum holding one, two or four hours;
- candidate Entry allowed only when the complete maximum-hold interval is free of:
  - Crypto V96 occupancy;
  - V11-EQ position occupancy;
  - frozen V19 position occupancy;
- V96 has first priority, followed by V11-EQ, V19 and then V31;
- no forced utilization;
- daily loss lock -2%;
- Normal fallback round trip 16 bps;
- P95 fallback round trip 24 bps;
- Severe fallback round trip 60 bps.

## Economic families

1. BTC lead / alt lag continuation;
2. cross-sectional relative momentum continuation;
3. Funding crowd-unwind continuation;
4. volume-confirmed 24-hour breakout continuation;
5. high-volume exhaustion reversal while BTC is stable;
6. volatility-compression breakout.

These families do not use the stock Basis logic and do not increase leverage.

## Frozen tournament

- 558 candidates declared before execution;
- decision grid every two UTC hours;
- signal data ends before Entry;
- same-bar TP/SL ambiguity is resolved against the strategy by applying the Stop first;
- Development sends at most 60 candidates to Validation;
- Validation selects at most one candidate;
- Final chronological and July Holdout are audit-only.

## Acceptance

The fallback itself must satisfy all of the following:

- exact-year Normal return at least +50%;
- exact-year P95 return at least +30%;
- Normal PF at least 1.50;
- Normal maximum DD no worse than -15%;
- at least 50 accepted Normal trades;
- Validation at least 10 accepted Normal trades;
- Validation Normal/P95 positive and PF at least 1.20;
- Final chronological Normal/P95 positive;
- July Holdout at least three trades and Normal/P95 positive;
- best-trade-removed and best-month-removed Normal/P95 positive;
- Severe non-negative;
- maximum one-symbol share of positive profit at most 40%.

The unified portfolio must also:

- exceed the frozen-priority baseline under Normal and P95;
- not worsen Normal maximum DD by more than two percentage points;
- preserve zero overlap with V96, V11-EQ and V19 occupancy.

## Safety

Research only. No Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11-EQ, V19 or V13D state may be changed.