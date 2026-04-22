# Add-on Ideas Comparison

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | exposure % | ETH contrib | SOL contrib | AVAX contrib | PENGU contrib | trailing exits | idle breakout entries |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | Current live implementation. | 259715.64 | 179.28 | -36.47 | 2.041 | 53.62 | 69 | 32 | 38.41 | 84315.18 | 13996.9 | 25917.36 | 125486.2 | 0 | 0 |
| profit_trailing_exit | Keep current entries, but add profit-only trailing for normal trend positions after gains are already large enough. | 170622.56 | 144.63 | -37.44 | 1.999 | 53.52 | 71 | 33 | 36.17 | 57474.58 | 9103.03 | 11605.78 | 82439.17 | 8 | 0 |
| idle_breakout_entry | While in USDT only, allow an extra breakout entry path using 6H structure, volume, and acceleration confirmation. | 259715.64 | 179.28 | -36.47 | 2.041 | 53.62 | 69 | 32 | 38.41 | 84315.18 | 13996.9 | 25917.36 | 125486.2 | 0 | 0 |
| smooth_trend_score_bonus | Keep current eligibility rules, but add score bonus for efficient smooth trends and penalty for overheated moves. | 249702.79 | 175.84 | -38.85 | 1.922 | 53.42 | 73 | 34 | 38.41 | 85482.38 | -3726.13 | 25893.34 | 132053.19 | 0 | 0 |
| addon_combo | Combine profit-only trailing exit, idle breakout entry, and smooth-trend score boost. | 166651.36 | 142.82 | -38.85 | 1.894 | 53.33 | 75 | 35 | 36.64 | 57207.66 | -277.13 | 11588.56 | 88132.28 | 7 | 1 |