# Idle Surge Add-on Comparison

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | exposure % | ETH contrib | SOL contrib | AVAX contrib | PENGU contrib | surge trades | surge pnl | surge trailing exits | surge time exits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | Current live implementation. | 259715.64 | 179.28 | -36.47 | 2.041 | 53.62 | 69 | 32 | 38.41 | 84315.18 | 13996.9 | 25917.36 | 125486.2 | 0 | 0 | 0 | 0 |
| idle_surge_conservative | Add USDT-only 6H surge entry with dedicated light trailing exit. | 225830.94 | 167.24 | -42.61 | 1.913 | 47.44 | 78 | 41 | 36.77 | 81446.14 | -8450.38 | 18854.67 | 123980.51 | 8 | 4343 | 0 | 3 |
| idle_surge_aggressive | Loosen surge entry slightly to see whether waiting periods can be monetized without replacing the main logic. | 219199.73 | 164.74 | -37.9 | 1.926 | 46.84 | 79 | 42 | 37.05 | 78361.35 | -7037.43 | 17535.9 | 120339.91 | 9 | 8461.87 | 0 | 3 |
| idle_surge_with_smooth_bonus | Surge add-on plus smooth-trend score bonus to improve which normal trend symbol wins when surge is inactive. | 211613.7 | 161.81 | -46.23 | 1.883 | 47.5 | 80 | 42 | 36.68 | 84525.4 | -18529.27 | 19442.58 | 116174.99 | 8 | 4006.52 | 0 | 3 |