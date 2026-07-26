# Aster-only V22 V11-EQ Primary / V19 Fallback Protocol

## Purpose

Test the practical Aster-only Stock architecture under the raised acceptance standard:

1. V11-EQ is evaluated first at 10:30 New York;
2. the frozen V19 12:30 two-hour Z-score Basis fade is evaluated only when V11-EQ is unavailable or fails its observable cost gate;
3. maximum one Stock position is allowed per day;
4. Hyperliquid is never used.

This does not retune V11-EQ or V19. It tests a predeclared capital-efficient router.

## Exact period

- Start inclusive: 2025-07-25 00:00 UTC
- End exclusive: 2026-07-25 00:00 UTC
- Calendar span: 365 days
- July 2026 is excluded from any strategy selection and retained as a short chronological Holdout

## V11-EQ primary

Frozen signal:

- candidate `BOTH__FLAT__CONVERGENCE__ABS_TOP1`;
- absolute Aster/cash Basis at least 50 bps;
- candidate remains absolute-Basis Top1 at entry;
- cash/Aster entry-clock difference at most 1.5 seconds;
- adverse Basis expansion from signal to entry at most 10 bps;
- convergence target 15 bps or zero cross;
- otherwise frozen V11 convergence/time/stop behavior.

Observable execution gate:

- round-trip cost at most 60 bps;
- cost at most 75% of entry Basis;
- estimated net edge after 15 bps convergence target and cost at least 10 bps.

## V19 fallback

Frozen fallback:

- 12:30 New York only;
- prior 20-session same-time Basis distribution;
- absolute Z-score at least 2.0;
- absolute residual at least 35 bps;
- Aster rich to cash: short Aster;
- Aster cheap to cash: long Aster;
- +0.75% take-profit;
- -1.00% stop-loss;
- otherwise two-hour exit;
- no overnight position.

Fallback is considered only when no V11-EQ trade is accepted for that day.

## Portfolio and capital rules

- AsterDEX only;
- Gross 1.0 maximum;
- maximum one Stock position per day;
- no simultaneous V11-EQ and V19 position;
- no Hyperliquid collateral;
- Crypto V96 capital priority remains mandatory before any Production consideration.

## Costs

- Forward median: 24 bps round trip;
- Normal: 40 bps;
- P95: 44 bps;
- Severe: 100 bps and fail-closed no entry.

## Raised pass criteria

The routed architecture must satisfy all of the following:

- exact-year Normal return at least +50%;
- exact-year P95 return at least +30%;
- Normal PF at least 1.50;
- Normal maximum DD no worse than -15%;
- at least 50 Normal trades;
- Development Normal/P95 positive;
- Validation has at least eight Normal trades, PF at least 1.20 and Normal/P95 positive;
- final chronological segment Normal/P95 positive;
- July Holdout has at least three Normal trades and Normal/P95 positive;
- positive-profit concentration at most 40% for any one symbol;
- best-trade-removed and best-month-removed Normal/P95 positive;
- Severe non-negative through fail-closed behavior.

V11-EQ-only is reported under the same rules for comparison.

## Interpretation limits

This remains an observable historical proxy. Historical Yahoo 60-minute cash and Aster 30-minute candle data cannot reproduce Pyth ticks, exact spread, depth, queue position, post-only fill probability or partial fills. V11-EQ and V19 also reuse previously inspected history.

A pass is Shadow-only and does not authorize Production or LIVE orders.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ runtime, credentials, orders and positions remain unchanged.
