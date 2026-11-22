# P54: true early first M5 break, buyer-seller flow and confirmation

P53 candidate142 -> prior completed M5 24h path-close drawdown <3 ->39. Taker BUY60 in bearish M5 is an exploratory negative control, not an accepted entry. All source decisions as-of.

| Rule | Wait | Eligible | One-slot closed | Wins | Win% | M5 high DD | NAV | Entry bar zero-vol (ex post) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ALL_CLEAN_DIRECT | 0 min | 39 | 32 | 16 | 50.0% | 31.71079% | 10819.67 | 9 |
| ALL_CLEAN_WAIT5_CONTROL | 5 min | 39 | 32 | 16 | 50.0% | 32.47308% | 10576.02 | 13 |
| BUY60_DIRECT | 0 min | 10 | 10 | 7 | 70.0% | 17.79283% | 12744.28 | 3 |
| SELL55_DIRECT | 0 min | 24 | 18 | 8 | 44.44444% | 29.93257% | 8691.85 | 6 |
| BUY60_WAIT5_CONTROL | 5 min | 10 | 10 | 7 | 70.0% | 17.80324% | 12700.57 | 5 |
| SELL55_WAIT5_CONTROL | 5 min | 24 | 18 | 8 | 44.44444% | 29.79758% | 8502.48 | 6 |
| BUY60_FOLLOWTHROUGH_DOWN5 | 5 min | 2 | 2 | 2 | 100.0% | 4.27411% | 13058.95 | 0 |
| SELL55_FOLLOWTHROUGH_DOWN5 | 5 min | 5 | 4 | 1 | 25.0% | 11.35245% | 9017.2 | 1 |
| ALL_FOLLOWTHROUGH_DOWN5 | 5 min | 8 | 7 | 4 | 57.14286% | 13.22789% | 12704.69 | 1 |
| ALL_FOLLOWTHROUGH_UP5_CONTROL | 5 min | 17 | 16 | 7 | 43.75% | 36.66775% | 8300.7 | 7 |
| BUY60_FOLLOWTHROUGH_DOWN10 | 10 min | 2 | 2 | 1 | 50.0% | 6.80776% | 10566.55 | 0 |
| SELL55_FOLLOWTHROUGH_DOWN10 | 10 min | 4 | 4 | 1 | 25.0% | 13.8339% | 8923.82 | 0 |
| BUY60_REVERTED_BUY_TO_SELL5 | 5 min | 0 | 0 | 0 | None% | 0.0% | 10000.0 | 0 |
| BUY60_AND_PRIOR_WICK_DD_LT3 | 0 min | 10 | 10 | 7 | 70.0% | 17.79283% | 12744.28 | 3 |
| SELL55_AND_PRIOR_WICK_DD_LT3 | 0 min | 19 | 15 | 6 | 40.0% | 28.04955% | 8335.41 | 6 |

All historical months already inspected; new entry route source/native economic parity and actual signed fills missing; do not adopt to LIVE.
