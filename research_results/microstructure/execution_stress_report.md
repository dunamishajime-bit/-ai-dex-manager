# PENGU Cross-Venue Execution Stress

## Verdict

**EXECUTION-STRESS FAIL.**

The bar-based headline is accepted only as a research hypothesis. The required case uses a 10-minute signal-to-fill delay, 10 bps per side on each venue, and excludes the lowest 25% of Aster quote-volume bars.

## Required case

- Total holdout return: -22.61%
- Annualized CAGR: -64.25%
- Maximum drawdown: -37.66%
- Sharpe: -1.66
- Positive weeks: 57.1%

## Next-close check

- Total holdout return: 35.38%
- Annualized CAGR: 237.34%
- Maximum drawdown: -14.00%
- Sharpe: 2.55

## Data-quality diagnostics

- Holdout Aster/Binance return correlation: 0.548
- Holdout price-gap standard deviation: 41.06 bps
- Aster zero quote-volume bars: 51.13%
- Aster missing quote-volume bars: 0.00%
- Aster median 5-minute quote volume: 0.00
- Binance median 5-minute quote volume: 167789.82

Even a pass cannot prove fillability because historical Aster top-of-book snapshots are unavailable. Prospective bid/ask recording remains mandatory.
