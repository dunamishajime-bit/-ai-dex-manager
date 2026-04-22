# Trade Logic Backtest Report
Date: 2026-03-23
Universe coverage: 35 symbols

## Summary
- Baseline trades: 13
- Baseline win rate: 30.77%
- Baseline cumulative return: -0.60%
- Baseline profit factor: 0.39
- Improved trades: 7
- Improved win rate: 42.86%
- Improved cumulative return: -0.14%
- Improved profit factor: 0.75
- Baseline max drawdown: 0.60%
- Improved max drawdown: 0.32%

## Interpretation
- All sampled trades came from BNB. SOLANA had no qualified entries under the current filters.
- Trend entries lost money in this sample, while Range entries were positive.
- The weakest trades clustered around shorter-hold trend attempts.
- A tighter trigger stack improved selectivity and reduced drawdown.

## Proposal
- Keep trend entries only when 1H / 4H EMA agree, RSI 1H is above 52, and ADX 1H is above 18.
- Restrict range entries to Support Bounce or VWAP Mean Reclaim, with chop 55+.
- De-prioritize 0.2x probation sizing; use 0.3x as the minimum default live size.
- Treat SOLANA as a separate route with looser trigger coverage and dedicated liquidity checks.

## Top Symbols
| Symbol | Chain | Trades | Win Rate | Return | PF |
| --- | --- | ---: | ---: | ---: | ---: |
| ETH | BNB | 8 | 25.0% | -0.18% | 0.52 |
| SOL | BNB | 5 | 40.0% | -0.42% | 0.32 |

## Caveats
- Backtest uses close-to-close price points, so intrabar high/low behavior is not modeled.
- Historical real-trade logs were not available as a durable server-side dataset.
- Use this report as a strategy tuning baseline, not as a guarantee of live returns.