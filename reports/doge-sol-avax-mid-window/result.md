# DOGE / SOL / AVAX Mid Window Variants

| variant | thesis | end equity | CAGR % | MaxDD % | PF | trades | DOGE trades | DOGE pnl | SOL trades | SOL pnl | AVAX trades | AVAX pnl |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sol_no_auxrange | Remove SOL from auxRange while keeping the rest of v3. | 11730.97 | 14.64 | -49.76 | 1.099 | 31 | 2 | -3103.57 | 5 | 288.61 | 4 | -739.25 |
| current_v3 | Current v3 profile with DOGE eff018 and SOL score -8. | 11504.4 | 12.74 | -48.22 | 1.091 | 31 | 2 | -2982.77 | 7 | -252.47 | 2 | -137.11 |
| doge_gap20_once | DOGE only stricter rotation with score gap 20. | 11167.42 | 9.91 | -49.74 | 1.069 | 31 | 0 | 0 | 7 | -345.73 | 2 | -93.24 |
| doge_gap15_twice | DOGE only stricter rotation with score gap 15 and 2 consecutive bars. | 11167.42 | 9.91 | -49.74 | 1.069 | 31 | 0 | 0 | 7 | -345.73 | 2 | -93.24 |
| doge_gap15_once_plus_sol_no_auxrange | Combine DOGE stricter rotation (gap15 once) with SOL removed from auxRange. | 10729.49 | 6.21 | -54.05 | 1.04 | 31 | 1 | -937.23 | 5 | 157.8 | 4 | -624.1 |
| doge_gap15_once | DOGE only stricter rotation with score gap 15. | 10522.32 | 4.45 | -52.64 | 1.03 | 31 | 1 | -919.13 | 7 | -356.02 | 2 | -93.24 |
| avax_removed | Remove AVAX from trend and auxRange logic. | 10007.24 | 0.06 | -53.71 | 1 | 30 | 3 | -4736.19 | 7 | -678.46 | 0 | 0 |
| avax_removed_plus_doge_gap15_once_plus_sol_no_auxrange | Remove AVAX, remove SOL from auxRange, and tighten DOGE rotation (gap15 once). | 9951.28 | -0.42 | -55.27 | 0.997 | 27 | 1 | -869.24 | 5 | -1476.76 | 0 | 0 |