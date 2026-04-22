# TWT Idle Rescue v2

## Baseline

- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_v7
- cash_window_count: 153
- end_equity: 858715.57
- cagr_pct: 307.2%
- max_drawdown_pct: -38.41%
- profit_factor: 2.105
- trade_count: 97

## Variants

| variant | thesis | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TWT trades | TWT wins | TWT losses | TWT pnl | idle-breakout trades | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| twt_idle_rescue_v2_confirmed | More confirmed rescue entry with slightly stronger breakout quality and tighter time stop. | 598528.55 | -260187.02 | 263.39 | -44.31 | 1.936 | 109 | 10 | 4 | 6 | -37164.6 | 10 | 38.47 |
| twt_idle_rescue_v2_fast | Fast breakout rescue with shallow trail and short max hold to mimic quick TWT bursts. | 592825.65 | -265889.92 | 262.3 | -44.31 | 1.935 | 110 | 11 | 4 | 7 | -37291.16 | 11 | 38.54 |
| twt_idle_rescue_v2_balanced | 6H rescue breakout for TWT during cash-only windows with light gate bypass and short hold. | 586739.57 | -271976 | 261.12 | -45.63 | 1.926 | 110 | 11 | 3 | 8 | -44206.73 | 11 | 38.67 |
| twt_idle_rescue_v2_soft | More permissive TWT rescue that prioritizes capturing short cash-window breakouts. | 586739.57 | -271976 | 261.12 | -45.63 | 1.926 | 110 | 11 | 3 | 8 | -44206.73 | 11 | 38.67 |