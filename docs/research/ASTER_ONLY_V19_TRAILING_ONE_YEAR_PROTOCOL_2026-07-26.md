# Aster-only V19 Exact Trailing One-Year Backtest Protocol

## Purpose

Recalculate the frozen Aster-only V18 Shadow candidate over the latest exact 365-day window without changing any strategy parameter.

## Fixed period

- Start inclusive: 2025-07-25 00:00:00 UTC
- End exclusive: 2026-07-25 00:00:00 UTC
- Calendar span: exactly 365 days
- Warm-up starts 2025-06-15 UTC only to form the prior-20-session Basis distribution. Warm-up trades are not counted.

## Frozen candidate

`TIME_SLOT_ZSCORE_FADE__T2__SLOT_1230__H2__NONE`

- AsterDEX only;
- universe: AMZNUSDT, METAUSDT, MSFTUSDT, NVDAUSDT and TSLAUSDT;
- one position total;
- Gross 1.0;
- 12:30 New York decision;
- prior 20-session same-time Basis distribution;
- absolute Basis Z-score at least 2.0;
- absolute Basis residual at least 35 bps;
- estimated round-trip cost at most 60 bps;
- estimated residual-reversion edge after cost at least 10 bps;
- select the largest absolute eligible Z-score;
- positive residual: short Aster;
- negative residual: long Aster;
- +0.75% take profit;
- -1.00% stop loss;
- otherwise exit after no more than two hours;
- no overnight position;
- Hyperliquid not used.

## Cost scenarios

- Forward median: 24 bps round trip
- Normal: 40 bps round trip
- P95: 44 bps round trip
- Severe: 100 bps round trip, rejected through the frozen 60 bps fail-closed gate

## Required outputs

- compounded return and CAGR for the exact 365-day window;
- Profit Factor, win rate, average trade and maximum drawdown;
- accepted trade count, Long/Short split and symbol counts;
- total capital-hours and net bps per capital-hour;
- monthly Normal/P95 performance;
- best-trade removal;
- best-month removal;
- leave-one-symbol-out results;
- Long-only and Short-only results;
- full trade audit.

## Pass classification

A Shadow-only pass requires:

- at least 20 accepted Normal trades;
- positive Normal and P95 compounded return;
- Normal Profit Factor above 1.30;
- Normal maximum drawdown no worse than -10%;
- positive Normal/P95 after best-trade removal;
- positive Normal/P95 after best-month removal;
- positive Normal/P95 for every leave-one-symbol-out portfolio;
- Severe nonnegative through fail-closed no-entry behavior.

A pass is not a Production or LIVE authorization.

## Interpretation limits

- Yahoo 60-minute cash data is used, not historical Pyth ticks.
- Aster 30-minute candles cannot reconstruct exact spread, depth, queue position or post-only fills.
- The candidate was selected using overlapping earlier history, so this exact-year replay is not an independent Holdout.
- Historical returns do not guarantee future returns.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11-EQ and current V13D remain unchanged.
