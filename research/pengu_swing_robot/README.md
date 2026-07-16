# PENGU 2–3 Day Swing Robot v1

Research-only directional swing robot for PENGUUSDT. It is isolated from live trading and from the existing Monthly Boost v4 portfolio.

## Objective

- Higher trade win rate than the long-hold trend sleeve
- Typical holding period of 2–3 days
- Use PENGU's volatility only when ATR and quote-volume gates pass
- Avoid stale-price and cross-venue basis logic

## Signal design

- Timeframe: 1-hour OHLCV
- Entry: next 1-hour open after a completed signal bar
- Regime: PENGU EMA trend plus BTC 72-hour trend
- Setup: pullback toward the fast EMA followed by reclaim/rejection
- Volatility: ATR/price minimum
- Liquidity proxy: quote volume versus rolling median
- Exit: intrabar TP/SL, trend-failure exit after 24 hours, or 48/72-hour time stop
- Same-bar TP and SL: stop is assumed first, which is deliberately adverse

## Chronological research split

- Development: 2025-01-01 through 2025-04-30
- Selection: 2025-05-01 through 2025-06-30
- Validation: 2025-07-01 through 2025-12-31
- Final holdout: 2026-01-01 through 2026-06-30

Parameters are selected before validation and final holdout are evaluated.

## Cost assumptions

Base:

- 6 bps per side
- 2 bps per holding day as a funding/operational reserve

Stress:

- 10 bps per side
- 5 bps per holding day

## Forward-paper approval gates

All must pass:

- Validation and final holdout positive
- At least 12 final-holdout trades
- Final-holdout win rate at least 58%
- Final-holdout profit factor at least 1.30
- Average hold between 24 and 72 hours
- Final-holdout maximum drawdown no worse than -15%
- Positive final holdout under stress costs
- Bootstrap probability of positive holdout total at least 90%

## Proposed portfolio limits after a pass

- Paper trading only
- Account risk per trade: 0.60%
- Maximum PENGU notional: 30% of equity
- One PENGU position at a time
- Three consecutive losses: 72-hour cooldown
- Sleeve monthly loss of -4%: block new entries until next month
- Existing portfolio gross and correlation limits remain binding

## Run

```bash
python research/pengu_swing_robot/run_pengu_swing_research.py
```

Outputs are written under `research_outputs/pengu_swing_v1`.

## Important distinction

The previously rejected PENGU Aster–Binance stale-price/basis strategy is not reused. This robot is a single-market directional OHLCV swing strategy with next-bar execution.
