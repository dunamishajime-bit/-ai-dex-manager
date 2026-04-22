# NEAR / INJ Dedicated Logic

## NEAR

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | symbol trades | wins | losses | pnl | top loss reason | count |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| near_smooth_trend | Smooth medium-term trend follow: moderate breakout, positive acceleration, clean path. | 20684.43 | 25.76 | -51.16 | 1.64 | 37.5 | 8 | 8 | 3 | 5 | 10684.43 | sma-break | 5 |
| near_smooth_trend_trailing | NEAR trend follow with profit protection after the move is established. | 12204.9 | 6.48 | -38.19 | 1.282 | 50 | 8 | 8 | 4 | 4 | 2204.9 | sma-break | 4 |
| near_base_only | NEAR only with current production-style trend logic. | 12004.73 | 5.93 | -59.45 | 1.078 | 23.33 | 30 | 30 | 7 | 23 | 2004.73 | sma-break | 19 |
| near_smooth_trend_fast_fail | Same NEAR trend entry, but exit a bit earlier when momentum rolls over. | 8242.39 | -5.91 | -48.09 | 0.682 | 12.5 | 8 | 8 | 1 | 7 | -1757.61 | symbol-weak-exit | 7 |

## INJ

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | symbol trades | wins | losses | pnl | top loss reason | count |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| inj_breakout_surge_fast_exit | INJ breakout with quicker failure exit when acceleration fades. | 16112.01 | 16.23 | -33.04 | 2.014 | 44.44 | 9 | 9 | 4 | 5 | 6112.01 | symbol-weak-exit | 5 |
| inj_breakout_surge | Fast breakout entry: stronger breakout, volume, acceleration and efficiency. | 14606.16 | 12.69 | -34.49 | 1.66 | 33.33 | 9 | 9 | 3 | 6 | 4606.16 | sma-break | 5 |
| inj_breakout_surge_trailing | INJ breakout with tighter profit protection after the move extends. | 14192.03 | 11.67 | -27.19 | 1.674 | 44.44 | 9 | 9 | 4 | 5 | 4192.03 | sma-break | 4 |
| inj_base_only | INJ only with current production-style trend logic. | 13141.61 | 9 | -47.41 | 1.151 | 37.5 | 32 | 32 | 12 | 20 | 3141.61 | sma-break | 16 |