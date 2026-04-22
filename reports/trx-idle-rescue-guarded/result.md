# TRX Idle Rescue Guarded Variants

## Baseline

- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_v7
- end_equity: 858715.57
- cagr_pct: 307.2%
- max_drawdown_pct: -38.41%
- profit_factor: 2.105
- trade_count: 97
- idle_window_count: 41

## Variants

| variant | thesis | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TRX trades | TRX pnl | idle-breakout trades | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| trx_idle_rescue_long_idle_4bars | Allow TRX rescue only inside baseline idle windows lasting at least 4 decision bars. | 653024.45 | -205691.12 | 273.61 | -42.82 | 2.003 | 113 | 14 | -16559.16 | 14 | 39.46 |
| trx_idle_rescue_long_idle_6bars | Allow TRX rescue only inside longer idle windows lasting at least 6 decision bars. | 653024.45 | -205691.12 | 273.61 | -42.82 | 2.003 | 113 | 14 | -16559.16 | 14 | 39.46 |
| trx_idle_rescue_long_idle_4bars_fast | Long-idle-only TRX rescue with shorter hold to release capital back to main symbols faster. | 663228.38 | -195487.19 | 275.44 | -44.39 | 1.994 | 113 | 14 | -20878.03 | 14 | 38.86 |