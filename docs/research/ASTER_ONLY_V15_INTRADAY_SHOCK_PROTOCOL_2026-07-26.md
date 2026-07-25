# Aster-only V15 Intraday Basis Shock Tournament Protocol

## Purpose

Test a second, economically distinct AsterDEX-only replacement cycle after V14 produced positive Development pockets but too few Validation trades. V15 does not relax V14 thresholds after seeing its result. It moves the decision later in the U.S. session and tests newly formed intraday Basis shocks with a maximum one- or two-hour capital lock.

This is research only. Production, LIVE, VPS, Crypto V96, V11-EQ, current V13D, credentials, orders, positions and systemd services are unchanged.

## Frozen inputs

- Universe: AMZN, META, MSFT, NVDA and TSLA Aster Stock perpetuals;
- underlying cash-equity proxy: Yahoo public 60-minute chart history;
- Aster trade history: 30-minute candles;
- actual historical Aster Funding;
- period: 2025-07-01 inclusive through 2026-07-01 exclusive;
- V11 cash/Aster source: `0fad24c105a7f0f61af6042ba04a8b1386ffec7c`;
- V13D benchmark source: `dbfd7e026a81343a23ab97d202761f7f9bbe5755`;
- frozen successful V13D one-year artifact: workflow `30117325883`, artifact `8605974635`, digest `sha256:6f2ff3b5fd6b3429da436d2bef1887f3fe407e424319212013655ce6ad7c60bc`.

## Fixed entry opportunities

V15 evaluates only information available at these New York times:

- 11:30;
- 12:30;
- 13:30.

Each candidate either uses one fixed slot or the first eligible slot in chronological order. It cannot select the best future slot retrospectively.

## Fixed candidate families

Exactly seven families are declared before the run:

1. intraday Basis-shock fade;
2. time-slot 20-day Basis-residual fade;
3. time-slot volatility-scaled residual fade;
4. same-time cross-sectional Basis-extreme fade;
5. absolute-Basis acceleration fade;
6. Basis-rejection fade after initial reversion;
7. Funding-supported time-slot residual fade.

Each family has three frozen thresholds, four entry policies, maximum holding periods of one or two hours, and variants with or without one-trade previous-symbol cooldown.

Total candidates: 336.

No additional threshold, slot, take-profit, stop, family or holding time may be introduced after seeing the V15 output on this history.

## Execution model

- AsterDEX only;
- no Hyperliquid leg;
- no cash-equity execution leg;
- one position per day;
- Gross 1.0;
- both Long and Short allowed;
- entry at the selected causal slot;
- take-profit at +0.75%;
- stop-loss at -1.00%;
- otherwise exit after one or two hours;
- no overnight position;
- actual Aster Funding during the holding interval is included.

## Cost and entry-quality model

Round-trip cost scenarios:

- Forward median: 24 bps;
- Normal: 40 bps;
- P95: 44 bps;
- Severe: 100 bps.

Entry fails closed when:

- observable round-trip cost exceeds 60 bps; or
- the pre-entry economic-edge proxy minus estimated cost is below 10 bps.

The Severe scenario therefore produces no entry rather than assuming a 100 bps round trip can remain profitable.

## Chronological selection discipline

- first 50% of aligned sessions: Development;
- next 25%: Validation;
- final 25%: final reused-history diagnostic;
- Development retains no more than 20 candidates;
- Validation may select only one winner;
- final chronological results are evaluated once;
- no final-segment retuning is permitted.

The final segment has already been exposed to previous Stock research and is not an independent Holdout.

## Replacement target

A V15 candidate reaches the historical replacement target only if:

- Development and chronological Validation pass;
- Validation contains at least five accepted Normal trades;
- final chronological Normal and P95 returns are positive;
- full-period Normal and P95 returns are each at least the frozen V13D benchmark;
- Severe is non-negative through the pre-entry cost gate;
- Normal net bps per Aster capital-hour is at least the V13D result after counting both V13D venue legs.

Even a historical target pass authorizes only untouched Pyth/IEX plus Aster order-book Forward Shadow collection. It does not authorize Production or LIVE.

## Historical limitations

- cash reference data are Yahoo 60-minute bars rather than Pyth ticks;
- Aster data are 30-minute candles rather than exact bid/ask, depth, queue and fills;
- scenario cost is treated as observable before entry;
- the final segment is reused history;
- no conclusion from this run is an assurance of future profit.
