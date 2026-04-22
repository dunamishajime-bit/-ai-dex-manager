# Symbol Individual Optimization

## SOL

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | SOL pnl | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sol_base_only | SOL only with current production logic. | 97418.02 | 105 | -37 | 1.845 | 47.92 | 48 | 25 | 18897.42 | 36.81 |
| sol_weak_exit | SOL only with symbol-specific weak exit. | 91917.03 | 101.28 | -49.05 | 1.737 | 45.45 | 55 | 30 | 6929.12 | 32.2 |
| sol_quality_bonus | SOL only with smooth-trend score bonus and overheat penalty. | 90971.77 | 100.62 | -40.96 | 1.73 | 49.02 | 51 | 26 | 14980.79 | 36.81 |
| sol_sma40 | SOL only with faster SMA40 trend exit. | 82622.65 | 94.62 | -43.5 | 1.637 | 46.94 | 49 | 26 | 5438.53 | 36.51 |
| sol_trailing | SOL only with profit-protection trailing on normal trends. | 58493.07 | 74.54 | -41.76 | 1.653 | 47.06 | 51 | 27 | 12897.45 | 33.66 |

## AVAX

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | AVAX pnl | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| avax_base_only | AVAX only with current production logic. | 97418.02 | 105 | -37 | 1.845 | 47.92 | 48 | 25 | 10825.2 | 36.81 |
| avax_looser_eff | AVAX only with slightly looser efficiency gate for earlier trend capture. | 90029.83 | 99.96 | -40.42 | 1.786 | 46.94 | 49 | 26 | 12038.41 | 36.86 |
| avax_sma40 | AVAX only with faster SMA40 trend exit. | 82622.65 | 94.62 | -43.5 | 1.637 | 46.94 | 49 | 26 | 10238.4 | 36.51 |
| avax_trailing | AVAX only with profit-protection trailing on normal trends. | 58493.07 | 74.54 | -41.76 | 1.653 | 47.06 | 51 | 27 | 2210.39 | 33.66 |
| avax_entry_quality | AVAX only with stronger acceleration requirement and smoother score bias. | 18860.79 | 22.15 | -47.04 | 1.411 | 46.88 | 32 | 17 | 7417.91 | 30.77 |

## DOGE

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | DOGE pnl | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| doge_eff018 | DOGE only with looser strict-extra efficiency gate for earlier entry. | 122235.57 | 120.21 | -34.2 | 1.927 | 48.15 | 54 | 28 | 22171.6 | 37.59 |
| doge_6h_entry_exit | DOGE only with 6H strict-extra decision and exit checks. | 96708.18 | 104.53 | -43.92 | 1.852 | 46.3 | 54 | 29 | 2595.77 | 37.11 |
| doge_base_only | DOGE only as idle strict-extra candidate with current baseline-style settings. | 78536.53 | 91.53 | -34.2 | 1.819 | 47.06 | 51 | 27 | 2139.01 | 37.29 |
| doge_trailing | DOGE only with dedicated strict-extra trailing protection. | 78536.53 | 91.53 | -34.2 | 1.819 | 47.06 | 51 | 27 | 2139.01 | 37.29 |
| doge_sma40 | DOGE only with faster SMA40 exit. | 66607.63 | 81.84 | -43.5 | 1.614 | 46.15 | 52 | 28 | 2072.6 | 36.99 |