# TRX / BCH Dedicated Logic

## TRX

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | symbol trades | wins | losses | pnl | top loss reason | count |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| trx_smooth_trend | Stable trend follow with light breakout, modest acceleration and cleaner efficiency. | 14577.2 | 12.62 | -38.5 | 5.456 | 66.67 | 3 | 3 | 2 | 1 | 4577.2 | risk-off | 1 |
| trx_base_only | TRX only with current production-style trend logic. | 12896.48 | 8.35 | -46.86 | 1.481 | 33.33 | 27 | 27 | 9 | 18 | 2896.48 | sma-break | 14 |
| trx_smooth_trend_trailing | TRX trend follow with profit protection after the move is established. | 11061.27 | 3.23 | -16.61 | 2.362 | 66.67 | 3 | 3 | 2 | 1 | 1061.27 | risk-off | 1 |
| trx_smooth_trend_fast_fail | TRX trend follow with slightly quicker failure exit once momentum deteriorates. | 10448.14 | 1.39 | -16.23 | 1.655 | 66.67 | 3 | 3 | 2 | 1 | 448.14 | symbol-weak-exit | 1 |

## BCH

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | symbol trades | wins | losses | pnl | top loss reason | count |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| bch_base_only | BCH only with current production-style trend logic. | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | none | 0 |
| bch_breakout_surge | Fast breakout entry with stronger breakout, volume and acceleration for BCH spikes. | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | none | 0 |
| bch_breakout_surge_fast_exit | BCH breakout with quicker loss-cut once momentum stalls. | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | none | 0 |
| bch_breakout_surge_trailing | BCH breakout with tighter trailing once profits extend. | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | none | 0 |