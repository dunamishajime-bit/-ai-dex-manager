# SOL Specialized Variants

| variant | thesis | end equity | CAGR % | MaxDD % | PF | total trades | SOL trades | SOL losses | SOL pnl | top SOL loss reason | count |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| sol_score_demotion | SOL only: keep current entry shape but lower ranking priority unless SOL is clearly stronger. | 733310 | 287.43 | -38.41 | 2.102 | 95 | 24 | 12 | 29143.67 | sma-break | 6 |
| base | Current production logic. | 640293.35 | 271.21 | -38.41 | 2.099 | 92 | 31 | 18 | -49288.4 | sma-break | 10 |
| sol_breakout_plus_weak_exit | SOL only: breakout entry plus early failure cut when momentum quickly weakens. | 179403.01 | 148.53 | -42.7 | 1.82 | 86 | 5 | 1 | 15086.91 | symbol-weak-exit | 1 |
| sol_breakout_entry | SOL only: require clearer breakout and stronger internal trend quality before entry. | 170973.93 | 144.79 | -42.7 | 1.752 | 86 | 5 | 1 | 5273.5 | sma-break | 1 |