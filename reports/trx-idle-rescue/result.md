# TRX Idle Rescue Variants

## Baseline

- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_v7
- end_equity: 858715.57
- cagr_pct: 307.2%
- max_drawdown_pct: -38.41%
- profit_factor: 2.105
- trade_count: 97

## Variants

| variant | thesis | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TRX trades | TRX wins | TRX losses | TRX pnl | idle-breakout trades | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| trx_idle_rescue_balanced | TRX-only cash rescue on 6H with light breakout and efficiency bias. | 655670.35 | -203045.22 | 274.08 | -43.48 | 2.033 | 106 | 8 | 3 | 5 | -1208.57 | 8 | 39.01 |
| trx_idle_rescue_soft | Softer TRX cash rescue to maximize firing during reserve windows. | 558423.7 | -300291.87 | 255.62 | -43.47 | 1.922 | 112 | 15 | 7 | 8 | 3105.2 | 15 | 39.83 |
| trx_idle_rescue_confirmed | More confirmed TRX rescue with slightly stricter breakout and shorter hold. | 685595.22 | -173120.35 | 279.39 | -42.4 | 2.041 | 106 | 7 | 3 | 4 | -6106.98 | 7 | 38.82 |