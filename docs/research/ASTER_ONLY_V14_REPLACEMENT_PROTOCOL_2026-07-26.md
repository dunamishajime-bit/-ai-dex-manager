# Aster-only V14 V13D Replacement Tournament Protocol

## Purpose

Find an AsterDEX-only Stock-perpetual strategy that can replace the two-venue V13D economics without requiring Hyperliquid collateral or locking two venue balances.

This is a fixed research tournament. It does not change Production, LIVE, VPS, Crypto V96, V11-EQ, credentials, orders, positions or systemd services.

## Benchmark

The comparison benchmark is the frozen V13D source commit:

- `dbfd7e026a81343a23ab97d202761f7f9bbe5755`;
- Aster Maker plus opposite Hyperliquid `xyz:` hedge;
- 10:00 New York decision;
- 20 bps minimum cross-venue Basis;
- previous completed symbol cooldown;
- two venue capital-hours are counted.

V13D cost assumptions are frozen at 10 / 16 / 26 / 45 bps per completed cycle for Forward-median / Normal / P95 / Severe.

## Aster-only data

- Universe: AMZN, META, MSFT, NVDA and TSLA Stock perpetuals on Aster;
- Aster trade candles: 30-minute;
- underlying cash-equity proxy: Yahoo public 60-minute chart history;
- actual historical Aster Funding;
- period: 2025-07-01 inclusive through 2026-07-01 exclusive;
- frozen V11 data source commit: `0fad24c105a7f0f61af6042ba04a8b1386ffec7c`.

Historical cash data are not Pyth tick data. Exact spread, queue, depth and post-only fill evidence are unavailable. Any historical lead remains Shadow-only.

## Fixed candidate families

Exactly five economically distinct families are declared together:

1. absolute 20-day Basis-residual fade;
2. volatility-scaled 20-day Basis-residual fade;
3. opening Basis-overshoot fade from 10:00 to 10:30;
4. confirmed absolute-Basis fade after at least 5 bps initial reversion;
5. Funding-supported Basis-residual fade.

Each family has three frozen thresholds, maximum holding periods of 1 / 2 / 3 hours and variants with or without one-trade previous-symbol cooldown.

Total candidates: 90.

The exact existing V11-EQ final-session convergence candidate is excluded. Every V14 candidate has a hard maximum holding period of three hours.

## Execution and cost model

- one Aster position total;
- Gross 1.0;
- no Hyperliquid leg;
- no cash-equity execution leg;
- both Long and Short allowed;
- current candidate is selected from information available by the 10:30 New York entry;
- Basis or rolling-residual convergence exit;
- metric expansion stop at 1.5 times the entry metric;
- maximum exit at 11:30, 12:30 or 13:30 according to the frozen candidate;
- actual Aster Funding during the holding period is included.

Observable round-trip cost scenarios:

- Forward median: 24 bps;
- Normal: 40 bps;
- P95: 44 bps;
- Severe: 100 bps.

A candidate is rejected before entry when:

- estimated round-trip cost exceeds 60 bps; or
- expected metric reversion minus round-trip cost is below 10 bps.

Therefore the Severe scenario deliberately fails closed rather than pretending a 100 bps round trip remains profitable.

## Selection discipline

- first 50% of aligned sessions: Development;
- next 25%: Validation;
- final 25%: final chronological diagnostic;
- Development retains at most 15 candidates;
- Validation selects at most one winner;
- the final segment is evaluated once only;
- no threshold, family, holding period or stop may be added after seeing the result.

The final segment has been reused by earlier V11 research. It is not an independent Holdout and cannot authorize Production.

## Historical replacement target

A selected candidate reaches the historical profit target only when all of the following hold:

- chronological Validation passes;
- final chronological Normal and P95 results are positive;
- full-period Normal profit is at least the V13D benchmark;
- full-period P95 profit is at least the V13D benchmark;
- Severe is non-negative through the pre-entry cost gate;
- Normal net bps per capital-hour is at least V13D after counting both V13D venue legs.

A pass authorizes only an untouched Pyth/IEX plus Aster order-book Shadow collector. It does not authorize LIVE.

## Safety

- research-only;
- orders disabled;
- Production and LIVE unchanged;
- VPS unchanged;
- Crypto V96 unchanged;
- V11-EQ unchanged;
- current V13D Production code unchanged.
