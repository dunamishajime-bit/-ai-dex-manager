# P53: P52 first M5 down-break, prior 24h market path & taker ratio

142 raw first M5 lower-low bearish events. All initial eligible events are preserved; per-event return uses original research stop72 and 30bps, not native V20 full exit. Groups are source intents, NOT tradable single-slot DD.

| Body % | Group | Qualifying | Closed | Won | Win% | Wilson 95% | 100bps-worse Win% | Prior24 path down>=3% | Zero volume next bar |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|
| 0.3 | ALL | 142 | 141 | 82 | 58.15603 | [49.9, 65.98] | 53.90071 | 103 | 51 |
| 0.3 | SELL_TAKER55 | 105 | 104 | 57 | 54.80769 | [45.24, 64.03] | 50.0 | 81 | 40 |
| 0.3 | BUY_TAKER60 | 24 | 24 | 17 | 70.83333 | [50.83, 85.09] | 70.83333 | 14 | 8 |
| 0.3 | MIDDLE | 13 | 13 | 8 | 61.53846 | [35.52, 82.29] | 53.84615 | 8 | 3 |
| 0.3 | BUY_TAKER60_AND_PRIOR24_PATH_LT3 | 10 | 10 | 7 | 70.0 | [39.68, 89.22] | 70.0 | 0 | 3 |
| 0.3 | BUY_TAKER60_AND_PRIOR24_PATH_LT5 | 20 | 20 | 14 | 70.0 | [48.1, 85.45] | 70.0 | 10 | 5 |
| 0.3 | SELL_TAKER55_AND_PRIOR24_PATH_LT3 | 24 | 24 | 10 | 41.66667 | [24.47, 61.17] | 29.16667 | 0 | 9 |
| 0.3 | SELL_TAKER55_AND_PRIOR24_PATH_LT5 | 72 | 71 | 41 | 57.74648 | [46.15, 68.55] | 52.11268 | 48 | 29 |
| 0.5 | ALL | 64 | 64 | 39 | 60.9375 | [48.69, 71.94] | 56.25 | 50 | 20 |
| 0.5 | SELL_TAKER55 | 46 | 46 | 24 | 52.17391 | [38.14, 65.88] | 45.65217 | 37 | 17 |
| 0.5 | BUY_TAKER60 | 10 | 10 | 9 | 90.0 | [59.58, 98.21] | 90.0 | 8 | 2 |
| 0.5 | MIDDLE | 8 | 8 | 6 | 75.0 | [40.93, 92.85] | 75.0 | 5 | 1 |
| 0.5 | BUY_TAKER60_AND_PRIOR24_PATH_LT3 | 2 | 2 | 2 | 100.0 | [34.24, 100.0] | 100.0 | 0 | 1 |
| 0.5 | BUY_TAKER60_AND_PRIOR24_PATH_LT5 | 8 | 8 | 7 | 87.5 | [52.91, 97.76] | 87.5 | 6 | 1 |
| 0.5 | SELL_TAKER55_AND_PRIOR24_PATH_LT3 | 9 | 9 | 3 | 33.33333 | [12.06, 64.58] | 0.0 | 0 | 2 |
| 0.5 | SELL_TAKER55_AND_PRIOR24_PATH_LT5 | 27 | 27 | 16 | 59.25926 | [40.73, 75.49] | 48.14815 | 18 | 11 |

Counterintuitive taker BUY in red candle is a negative control, NOT permission to use high taker buy as a validated short signal. Some signals follow previous large drawdowns. NEXT trade must reconstruct real volume, liquidity, and true blind testing.
