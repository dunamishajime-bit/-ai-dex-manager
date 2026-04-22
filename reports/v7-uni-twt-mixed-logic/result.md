# V7 UNI/TWT Mixed Logic

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- base_strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_v7
- cash_window_count: 153

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | TWT trades | TWT pnl | TWT structure-break entries | UNI trades | UNI pnl | UNI structure-break entries |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base_v7 | Current production v7 baseline. | 858715.57 | 307.2 | -38.41 | 2.105 | 52.58 | 97 | 39.66 | 0 | 0 | 0 | 0 | 0 | 0 |
| v7_plus_uni_twt_mixed_logic | Add TWT and UNI as normal trend symbols, but use TRX-style trend thresholds only during base-v7 cash windows. | 263246.49 | 180.47 | -47.9 | 1.623 | 48.6 | 107 | 39.92 | 11 | -55370.77 | 1 | 18 | -51991.34 | 1 |

## Contributions

- base_v7: INJ 6973.58 / ETH 153860.99 / DOGE 237263.13 / SOL -49940.8 / AVAX 42135.05 / PENGU 458423.62
- v7_plus_uni_twt_mixed_logic: INJ 6893.86 / UNI -51991.34 / ETH 84904.92 / DOGE 91144.37 / TWT -55370.77 / SOL 14630.65 / AVAX 69533.29 / PENGU 93501.51