# TRX Idle Slot Variants

## Baseline

- end_equity: 858715.57
- cagr_pct: 307.2%
- max_drawdown_pct: -38.41%
- profit_factor: 2.105
- trade_count: 97

## Variants

| variant | thesis | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TRX trades | wins | losses | TRX pnl | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| strict_extra_12h_soft | TRX as idle-only strict-extra on 12H with soft trend thresholds. | 77502.86 | -781212.71 | 90.74 | -38.16 | 1.641 | 71 | 0 | 0 | 0 | 0 | 38.07 |
| strict_extra_6h_soft | TRX as idle-only strict-extra on 6H to catch smoother earlier moves. | 64466.76 | -794248.81 | 79.97 | -45.95 | 1.5 | 74 | 0 | 0 | 0 | 0 | 37.46 |
| expanded_idle_trx_soft | TRX as expanded trend symbol only during idle windows, with soft TRX trend thresholds. | 858715.57 | 0 | 307.2 | -38.41 | 2.105 | 97 | 0 | 0 | 0 | 0 | 39.66 |
| expanded_idle_trx_with_idle_relax | TRX idle rescue with TRX soft thresholds plus idle-only gate relaxation. | 506768.33 | -351947.24 | 244.81 | -54.14 | 1.83 | 109 | 0 | 0 | 0 | 0 | 40.44 |