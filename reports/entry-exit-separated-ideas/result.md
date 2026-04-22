# Entry/Exit Separation Ideas

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | exposure % | ETH contrib | SOL contrib | AVAX contrib | PENGU contrib | sma-break losses | risk-off losses | rotate losses |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | Current live implementation. | 259715.64 | 179.28 | -36.47 | 2.041 | 53.62 | 69 | 32 | 38.41 | 84315.18 | 13996.9 | 25917.36 | 125486.2 | 15 | 6 | 2 |
| quality_entry | Separate large-trend entry logic: require structure breakout, capital inflow proxy, and positive acceleration while keeping current exits. | 16692.13 | 17.53 | -39.57 | 1.421 | 62.96 | 27 | 10 | 19.25 | 6993.52 | 4619.25 | -1716.56 | -3204.09 | 7 | 2 | 0 |
| faster_exit_6h | Keep current entries, but monitor exits on 6H bars to reduce exit delay. | 105629.13 | 110.3 | -48.52 | 1.615 | 38.55 | 83 | 51 | 28.2 | 34806.55 | 6988.77 | 24596.5 | 29237.31 | 35 | 2 | 3 |
| quality_entry_plus_faster_exit | Combine stricter large-trend entry selection with 6H exit monitoring. | 8863.18 | -3.73 | -39.86 | 0.867 | 41.38 | 29 | 17 | 11.01 | 475 | 390.49 | -1342.6 | -659.71 | 9 | 1 | 0 |