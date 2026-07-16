# PENGU Adaptive 72-Hour Swing Robot v2

Research-only directional swing robot for PENGUUSDT. It is isolated from live trading and from the existing Monthly Boost v4 portfolio.

## Current status

- `v1` trend/pullback with close TP/SL: rejected. PENGU reached the exits in roughly 3–4 hours, so it did not satisfy the requested 2–3 day holding objective.
- `v2` adaptive reversal: current research candidate.
- Real trading: disabled.
- Automatic paper trading: disabled because the 2026 final block contains only four trades.

## Objective

- Win rate materially above the long-hold trend sleeve
- Typical holding period close to 48–72 hours
- Use PENGU volatility only when ATR and quote-volume gates pass
- Complement, rather than replace, Monthly Boost v4
- Never reuse stale-price or cross-venue basis logic

## Adaptive v2 signal

At the beginning of each calendar month, the robot examines only the preceding 180 days and selects one rule from a fixed 288-rule grid.

- Positive PENGU 14-day regime:
  - enter long after an 8–15% 24-hour decline
  - RSI must be 30, 35 or 40 or lower, depending on the selected rule
  - require a bullish one-hour reversal candle
- Negative PENGU 14-day regime:
  - enter short after a 5–12% 24-hour rally
  - RSI must be 55, 60 or 65 or higher
  - require a bearish one-hour reversal candle
- ATR/price must be at least 1%
- Quote volume must be at least 50% of its rolling 24-hour median
- Entry is the next one-hour open
- Maximum holding period is 72 hours
- Hard stop is 10% or 15%, selected only from trailing data
- No close take-profit is used; the purpose is to capture the multi-day reversal rather than turn the robot into a scalp
- Only one PENGU position may be open

## Walk-forward structure

- Monthly rule selection: trailing 180 days only
- Research validation: July–December 2025
- Final chronological block: January–June 2026
- Base cost: 6 bps per side plus 2 bps per holding day
- Stress cost: 10 bps per side plus 5 bps per holding day

The strategy family was developed after inspecting historical PENGU behaviour, so these periods must not be described as a pristine untouched holdout. A frozen forward-paper period is still required.

## Current research result

Local reproduction using Binance USD-M futures one-hour OHLCV produced:

- July 2025–June 2026: 17 trades
- Win rate: 76.5%
- Profit factor: 3.33
- Total return at full-notional research scale: +129.09%
- Maximum drawdown: -16.62%
- Average holding time: 67.5 hours
- 10 bps stress total: +123.07%

Practical standalone sleeve proxies:

- 15% notional: +14.91%, maximum drawdown -2.48%
- 30% notional: +31.32%, maximum drawdown -4.94%

The full-notional result is diagnostic and is not the proposed account allocation.

## Evidence blocker

The January–June 2026 block contains only four trades. Although all four were profitable, that sample is too small to authorize automatic paper trading or live use.

## Forward-paper approval gates

All must pass after the robot is frozen:

- At least 12 final/forward trades
- Win rate at least 58%
- Profit factor at least 1.30
- Average hold between 48 and 72 hours
- Maximum sleeve drawdown no worse than -20%
- Positive performance under stress costs
- Bootstrap probability of positive return at least 90%

## Proposed portfolio limits after a pass

- Standard PENGU sleeve notional: 15% of account equity
- Attack cap: 30% only after sufficient forward evidence
- Maximum account risk per trade: 0.60%
- One PENGU position at a time
- Three consecutive losses: 72-hour cooldown
- Sleeve monthly loss of -4%: block new entries until the next month
- Existing portfolio gross and correlation limits remain binding

## Run

```bash
python research/pengu_swing_robot/run_pengu_adaptive_72h_v2.py
```

Outputs are written under `research_outputs/pengu_adaptive_72h_v2`.

## Important distinction

The previously rejected PENGU Aster–Binance stale-price/basis strategy is not reused. This robot is a single-market directional OHLCV swing strategy with next-bar execution and monthly trailing-data rule selection.
