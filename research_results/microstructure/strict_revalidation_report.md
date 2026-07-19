# Strict PENGU Aster–Binance Revalidation

## Verdict

**STRICT REVALIDATION FAIL.**

This audit fixes the previously discovered signal (absolute gap z-score 2.5, 60-minute hold) and does not re-optimize it on the April–June 2026 holdout.

## Corrections versus the prior stress test

- Liquidity thresholds are calculated from **positive-volume selection bars only**. The former 25th percentile was zero and therefore filtered nothing.
- Signal, entry and exit bars must contain positive quote volume and trades on both venues.
- The strict case requires every Aster bar during the holding interval to be active.
- Pair exposure is normalized to **1.0x gross** (0.5x per venue); the previous headline used 2.0x gross.
- A 2 bps operational/funding reserve per 1.0x gross trade is added beyond explicit two-venue costs.
- Uncertainty is measured from the 14 weekly holdout observations using 20,000 bootstrap resamples.

## Fixed cases

| Case | Trades | Holdout return | Max DD | Weekly Sharpe | Bootstrap P(return>0) | 95% bootstrap total | Median account capacity at 1% Aster participation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Moderate: next close, 5m delay, 10bps/side/venue, entry+exit active | 14 | -2.92% | -2.92% | -3.54 | 0.0% | [-6.23%, -0.55%] | $10 |
| Strict: adverse 25% bar range, 10m delay, 15bps/side/venue, all held bars active | 2 | -1.74% | -1.74% | -2.80 | 0.0% | [-4.18%, 0.00%] | $24 |

## Parameter-region test

- Plausible 1.0x-gross scenarios tested: 72
- Fraction profitable: 0.0%
- Required robustness fraction: 60.0%

## Interpretation

A positive point estimate is not enough. The signal is considered deployable only if the strict case remains positive with at least 30 trades, has at least 90% bootstrap probability of a positive 14-week result, and most nearby plausible execution assumptions remain profitable.

Historical top-of-book and queue data are still unavailable, so even a pass would permit paper trading only.
