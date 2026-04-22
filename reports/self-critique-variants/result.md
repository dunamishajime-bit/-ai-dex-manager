# Self-Critique Backtest Variants

Same backtest base, grouped by self-critique thesis.

| rank | variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | 2023 % | 2024 % | 2025 % |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | reclaim-aux-alloc100-pengu-idle | Full aux range plus PENGU idle-only candidate. | 205620.37 | 185.91 | -31.04 | 2.739 | 58.33 | 60 | 39.72 | 451.07 | 52.23 | 138.54 |
| 2 | reclaim-aux-relaxed-pengu-idle | Use PENGU only when normal candidates are absent. | 176284.17 | 171.02 | -34.08 | 2.588 | 58.33 | 60 | 39.72 | 451.07 | 44.72 | 115.11 |
| 3 | reclaim-aux-alloc100-pengu-top-removed | Stress test: full aux plus PENGU, but largest PENGU trade is blocked. | 145453.35 | 153.51 | -31.04 | 2.314 | 57.63 | 59 | 39.2 | 451.07 | 52.23 | 68.74 |
| 4 | reclaim-aux-alloc100 | Use full available cash for aux range when no trend candidate exists. | 135769.39 | 147.51 | -31.04 | 2.255 | 57.14 | 56 | 39.2 | 451.07 | 52.23 | 57.51 |
| 5 | reclaim-aux-alloc060 | Push aux range allocation higher while watching drawdown. | 122586.24 | 138.88 | -32.59 | 2.172 | 57.14 | 56 | 39.2 | 451.07 | 47.21 | 47.06 |
| 6 | reclaim-aux-alloc050 | Increase aux range allocation if its edge is real. | 119459.98 | 136.75 | -33.34 | 2.152 | 57.14 | 56 | 39.2 | 451.07 | 45.96 | 44.53 |
| 7 | reclaim-aux-no-sol | Remove SOL aux to test if it is signal or noise. | 117153.05 | 135.15 | -33.53 | 2.134 | 56.36 | 55 | 39.11 | 451.07 | 44.72 | 42.96 |
| 8 | reclaim-aux-relaxed | Reduce idle USDT with ETH reclaim plus AVAX/SOL ATR snapback. | 116398.82 | 134.62 | -34.08 | 2.131 | 57.14 | 56 | 39.2 | 451.07 | 44.72 | 42.04 |
| 9 | reclaim-aux-exit006 | Exit aux range earlier before rebound fades. | 116398.82 | 134.62 | -34.08 | 2.131 | 57.14 | 56 | 39.2 | 451.07 | 44.72 | 42.04 |
| 10 | reclaim-aux-entry080 | Widen aux range entry to reduce missed rebounds. | 116398.82 | 134.62 | -34.08 | 2.131 | 57.14 | 56 | 39.2 | 451.07 | 44.72 | 42.04 |
| 11 | reclaim-aux-entry040 | Tighten aux range entry to reduce shallow rebound noise. | 116398.82 | 134.62 | -34.08 | 2.131 | 57.14 | 56 | 39.2 | 451.07 | 44.72 | 42.04 |
| 12 | weak-exit-loose | Loosen weak-exit gates to avoid exiting trends too early. | 116398.82 | 134.62 | -34.08 | 2.131 | 57.14 | 56 | 39.2 | 451.07 | 44.72 | 42.04 |
| 13 | weak-exit-tight | Tighten weak-exit gates to reduce late exits. | 116398.82 | 134.62 | -34.08 | 2.131 | 57.14 | 56 | 39.2 | 451.07 | 44.72 | 42.04 |
| 14 | reclaim-primary-early | Loosen primary ETH reclaim entry. | 116398.82 | 134.62 | -34.08 | 2.131 | 57.14 | 56 | 39.2 | 451.07 | 44.72 | 42.04 |
| 15 | reclaim-primary-strict | Tighten primary ETH reclaim entry to improve PF. | 115218.81 | 133.79 | -34.08 | 2.13 | 54.72 | 53 | 38.87 | 445.48 | 44.72 | 42.04 |
| 16 | reclaim-aux-hold5 | Hold aux range longer in case exits are too early. | 112994.07 | 132.21 | -34.94 | 2.093 | 55.36 | 56 | 39.39 | 451.07 | 44.05 | 38.52 |
| 17 | reclaim-aux-no-avax | Remove AVAX aux to test if it is signal or noise. | 110331.06 | 130.3 | -36.33 | 2.1 | 54.72 | 53 | 38.77 | 451.07 | 39.79 | 39.38 |
| 18 | trend-eff018 | Loosen trend efficiency to reduce late entries. | 107571.77 | 128.28 | -37.66 | 2.046 | 56.14 | 57 | 39.25 | 451.07 | 33.75 | 42.04 |
| 19 | current-retq22 | Current RETQ22 baseline. | 82553.59 | 108.22 | -45.27 | 1.685 | 51.72 | 58 | 46.67 | 410.04 | 26.25 | 24.77 |
| 20 | decision-12-exit-6 | Keep 12H entries but check trend exits on 6H. | 71035.09 | 97.63 | -48.66 | 1.724 | 41.18 | 68 | 29.03 | 441.11 | 31.6 | -0.25 |
| 21 | trend-eff026 | Tighten trend efficiency to remove false breakouts. | 59143.06 | 85.44 | -34.5 | 1.879 | 55.56 | 54 | 37.68 | 272.43 | 44.72 | 6.79 |
| 22 | top2-trend | Hold top 2 trend symbols if single-symbol rotation misses upside. | 31972.13 | 49.76 | -27.42 | 1.508 | 42.71 | 96 | 37.39 | 144.35 | 35.49 | -4.86 |
| 23 | decision-6-reclaim | Try 6H decisions on the reclaim base. | 27629.01 | 41.29 | -43.7 | 1.387 | 40.82 | 98 | 35.84 | 122.6 | 17.21 | 5.9 |