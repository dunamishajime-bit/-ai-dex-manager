# Aster-only V32 Online Ridge V96-Idle Crypto Protocol

## Goal

Replace fixed threshold families with a causal online cross-sectional forecasting model. The model is refit every UTC day using only samples whose future outcome was fully known before that day. It trades only inside intervals that are free of frozen V96, V11-EQ and V19 occupancy.

## Evidence windows

### Integrated selection window

- 2025-07-01 00:00 UTC through 2026-07-01 00:00 UTC;
- exactly 365 calendar days;
- chosen because frozen Production V96 evidence is available through the end of June 2026;
- Development 60%, Validation 20%, Final chronological 20%.

### Candidate-only audit

- 2026-07-01 through 2026-07-24;
- no V96-idle or unified-portfolio claim is made for this interval because frozen V96 occupancy does not cover it completely;
- the candidate must nevertheless be positive under Normal and P95 with at least three trades.

## Universe and execution

- AsterDEX only;
- BTC, ETH, BNB, SOL, LINK, AVAX, DOGE and AAVE perpetuals;
- decision grid every two UTC hours;
- maximum Gross 1.0;
- maximum one fallback position;
- holding horizon one, two or four hours;
- TP/SL profiles are frozen from V31;
- same-bar TP/SL ambiguity applies Stop first;
- V96 first priority, then V11-EQ, V19 and V32;
- no forced utilization;
- Normal/P95/Severe fallback round trips 16/24/60 bps.

## Online model

A pooled ridge regression is refit once per UTC day. Features are calculated from completed bars only:

- one-, two-, four- and eight-hour returns;
- four-hour return Z-score;
- relative volume;
- rolling volatility percentile;
- Funding and Funding-missing flag;
- BTC one-, two- and four-hour returns;
- cross-sectional two- and four-hour return Z-scores;
- 12-hour and 24-hour breakout flags.

Targets are future one-, two- or four-hour Aster returns. Training samples become available only on the UTC day after their target horizon is complete.

Frozen model specifications:

- training lookback 30, 60 or 120 days;
- target horizon one, two or four hours;
- ridge penalty 0.1, 1.0 or 10.0.

Frozen Entry policies:

- predicted move threshold 20, 35 or 50 bps;
- predicted move / training RMSE minimum 0.25 or 0.50;
- regime NONE, BTC_STABLE or CROSS_SECTION_DISPERSION;
- risk profile R1, R2 or R3.

Total candidates: 1,458.

## Acceptance

The fallback itself must satisfy every condition:

- integrated-year Normal at least +50%;
- integrated-year P95 at least +30%;
- Normal PF at least 1.50;
- Normal DD no worse than -15%;
- at least 50 Normal trades;
- Validation at least 10 Normal trades, Normal/P95 positive and PF at least 1.20;
- Final chronological Normal/P95 positive;
- July candidate-only audit at least three trades and Normal/P95 positive;
- best-trade-removed and best-month-removed Normal/P95 positive;
- Severe non-negative;
- maximum one-symbol positive-profit concentration at most 40%;
- zero overlap with V96, V11-EQ and V19 inside the integrated window.

The unified integrated portfolio must also:

- exceed the frozen-priority baseline under Normal and P95;
- not worsen Normal DD by more than two percentage points.

Development sends at most 60 candidates to Validation. Validation selects at most one. Final and July are audit-only.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11-EQ, V19 and V13D remain unchanged.