# Aster-only V33 Residual-Gross Overlay Protocol

## Goal

Use only the Gross capacity left after Production V96 and the accepted V11-EQ / V19 Stock route, rather than requiring all priority strategies to be completely flat. The overlay must exceed the raised standalone line and improve the unified portfolio without exceeding total account Gross 2.0.

## Integrated evidence window

- 2025-07-01 through 2026-06-30 inclusive;
- exact 365-day integrated window ending 2026-07-01 00:00 UTC;
- frozen V96 evidence covers this interval;
- Development 60%, Validation 20%, Final chronological 20%.

## July candidate-only audit

- 2026-07-01 through 2026-07-24;
- no unified-capacity claim is made because frozen V96 Gross evidence is incomplete after June 30;
- the candidate must still be positive under Normal and P95 with at least three trades.

## Capacity priority

1. Production V96 source Gross;
2. V11-EQ / V19 Stock route, requiring 1.0 available Gross for the entire Stock hold;
3. V33 overlay using the remaining Gross.

Frozen limits:

- total concurrent Gross cap: 2.0;
- V33 maximum Gross: 0.25, 0.50 or 0.75 depending on the candidate;
- minimum executable V33 Gross: 0.15;
- V33 trade is rejected unless the minimum available Gross over its complete maximum-hold interval is at least 0.15;
- maximum one V33 position;
- no forced utilization.

## Candidate families

### Rule-based families retained from V31

- Funding crowd-unwind continuation;
- high-volume exhaustion reversal while BTC is stable;
- volatility-compression breakout.

### Online-model families retained from V32

- causal daily-refit ridge models;
- lookback fixed at 30 days;
- target horizon one, two or four hours;
- ridge penalty 1.0 or 10.0;
- predicted threshold 20 or 35 bps;
- confidence ratio 0.25 or 0.50;
- regime NONE or BTC_STABLE;
- risk profile R1, R2 or R3.

Total candidates: 999.

## Cost and execution

- AsterDEX only;
- BTC, ETH, BNB, SOL, LINK, AVAX, DOGE and AAVE;
- decision grid every two UTC hours;
- one-, two- or four-hour maximum hold;
- same-bar Stop is applied before Take Profit;
- Normal/P95/Severe round trips 16/24/60 bps;
- transaction cost is multiplied by actual V33 Gross;
- predicted / estimated Net Edge must exceed cost by at least 10 bps per unit Gross.

## Acceptance

The V33 contribution itself must satisfy all conditions:

- integrated-year Normal at least +50%;
- integrated-year P95 at least +30%;
- Normal PF at least 1.50;
- Normal DD no worse than -15%;
- at least 50 Normal trades;
- Validation at least 10 Normal trades, Normal/P95 positive and PF at least 1.20;
- Final chronological Normal/P95 positive;
- July candidate-only at least three trades and Normal/P95 positive;
- best-trade-removed and best-month-removed Normal/P95 positive;
- Severe non-negative;
- maximum one-symbol positive-profit concentration at most 40%.

The unified integrated portfolio must also:

- exceed its no-V33 baseline under Normal and P95;
- not worsen Normal DD by more than two percentage points;
- have zero total-Gross-cap violations.

Development sends at most 60 candidates to Validation. Validation selects at most one. Final and July are audit-only.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11-EQ, V19 and V13D remain unchanged.