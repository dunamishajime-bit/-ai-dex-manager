# P52: True initial M5 drop without waiting for H1 close

PENGU M5 first red breakdown below prior12 M5 low, prior H1 24h drop still under3%, previous M5 last60m not down1%. M5 event and taker buy ratios are fully completed before entry.

| Body threshold | Rule | Eligible | Closed | Wins | Win% | DD high | NAV | Entry 5m zero-volume |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 0.3% | RAW_FIRST_M5_BREAK | 142 | 94 | 51 | 54.25532% | 48.83126% | 10746.46 | 37 |
| 0.3% | M5_TAKER_SELL55 | 105 | 75 | 41 | 54.66667% | 43.15186% | 11157.66 | 31 |
| 0.3% | M5_TAKER_SELL60 | 103 | 73 | 40 | 54.79452% | 39.33076% | 11095.15 | 31 |
| 0.3% | M5_SELLER_RELATIVE_TO_BTC | 100 | 71 | 39 | 54.92958% | 42.68097% | 13226.52 | 28 |
| 0.3% | PRIOR_H1_BTC_BEAR | 55 | 42 | 23 | 54.7619% | 44.24112% | 9491.79 | 18 |
| 0.3% | PRIOR_H1_RELATIVE_WEAK | 25 | 23 | 14 | 60.86957% | 13.93956% | 13769.62 | 8 |
| 0.3% | PRIOR_H1_EMA_BEAR | 68 | 48 | 28 | 58.33333% | 22.57629% | 13834.55 | 18 |
| 0.3% | PRIOR_H1_2OF3 | 50 | 35 | 22 | 62.85714% | 19.16177% | 14566.01 | 15 |
| 0.3% | PRIOR_H1_ALL3 | 6 | 6 | 3 | 50.0% | 18.90226% | 8987.19 | 1 |
| 0.3% | M5_TAKER_SELL55_AND_H1_2OF3 | 43 | 32 | 21 | 65.625% | 17.06417% | 15511.09 | 12 |
| 0.3% | M5_TAKER_SELL55_AND_REL_BTC | 98 | 70 | 38 | 54.28571% | 41.93173% | 12717.41 | 28 |
| 0.3% | M5_TAKER_SELL55_AND_LIQUID6OF12 | 49 | 41 | 26 | 63.41463% | 34.95366% | 17773.36 | 11 |
| 0.3% | M5_TAKER_BUY60_NEG_CONTROL | 24 | 23 | 17 | 73.91304% | 15.2443% | 17114.72 | 7 |
| 0.5% | RAW_FIRST_M5_BREAK | 64 | 51 | 29 | 56.86275% | 35.96254% | 10473.82 | 18 |
| 0.5% | M5_TAKER_SELL55 | 46 | 40 | 20 | 50.0% | 41.97284% | 7824.73 | 15 |
| 0.5% | M5_TAKER_SELL60 | 45 | 39 | 20 | 51.28205% | 38.07249% | 8350.68 | 15 |
| 0.5% | M5_SELLER_RELATIVE_TO_BTC | 43 | 37 | 18 | 48.64865% | 40.27223% | 8260.53 | 11 |
| 0.5% | PRIOR_H1_BTC_BEAR | 26 | 23 | 14 | 60.86957% | 30.36429% | 9391.85 | 9 |
| 0.5% | PRIOR_H1_RELATIVE_WEAK | 6 | 6 | 3 | 50.0% | 20.97816% | 9696.29 | 3 |
| 0.5% | PRIOR_H1_EMA_BEAR | 26 | 20 | 14 | 70.0% | 11.96547% | 11782.82 | 6 |
| 0.5% | PRIOR_H1_2OF3 | 19 | 16 | 10 | 62.5% | 14.00866% | 9914.87 | 6 |
| 0.5% | PRIOR_H1_ALL3 | 2 | 2 | 1 | 50.0% | 11.54093% | 9462.58 | 1 |
| 0.5% | M5_TAKER_SELL55_AND_H1_2OF3 | 17 | 14 | 9 | 64.28571% | 14.00866% | 10354.6 | 6 |
| 0.5% | M5_TAKER_SELL55_AND_REL_BTC | 41 | 35 | 17 | 48.57143% | 40.11711% | 8067.13 | 11 |
| 0.5% | M5_TAKER_SELL55_AND_LIQUID6OF12 | 23 | 22 | 10 | 45.45455% | 36.30915% | 9322.31 | 5 |
| 0.5% | M5_TAKER_BUY60_NEG_CONTROL | 10 | 10 | 9 | 90.0% | 11.0078% | 13852.56 | 2 |

Study is retrospective and there is NO independent OOS. All execution and STOPs price proxies only. No LIVE adoption.
