# V7 + UNI/TWT TRX Logic with TWT Rotation

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- base_strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_v7
- cash_window_count: 153

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | TWT trades | TWT pnl | UNI trades | UNI pnl | TWT rotate entries |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base_v7 | Current production v7 baseline. | 858715.57 | 307.2 | -38.41 | 2.105 | 52.58 | 97 | 39.66 | 0 | 0 | 0 | 0 | 0 |
| v7_plus_uni_twt_trxlogic | Add UNI and TWT using TRX-style smooth trend logic, but only during base-v7 cash-only windows. | 1025504.33 | 330.64 | -38.41 | 2.114 | 53.54 | 99 | 40.22 | 1 | 655.28 | 1 | 3946.39 | 0 |
| v7_plus_uni_twt_trxlogic_twt_rotate | Same cash-only UNI/TWT setup, plus TWT-priority trend rotation while holding other trend symbols. | 1239991.68 | 357.22 | -44.8 | 1.735 | 55.64 | 133 | 39.58 | 4 | 109713.9 | 2 | 8944.25 | 4 |

## Contributions

- base_v7: INJ 6973.58 / ETH 153860.99 / DOGE 237263.13 / SOL -49940.8 / AVAX 42135.05 / PENGU 458423.62
- v7_plus_uni_twt_trxlogic: INJ 8270.93 / ETH 182303.21 / DOGE 282025.55 / SOL -57929.7 / TWT 655.28 / AVAX 48769.09 / UNI 3946.39 / PENGU 547463.59
- v7_plus_uni_twt_trxlogic_twt_rotate: INJ -151472.83 / ETH -36900.06 / SOL -2099.83 / DOGE 367849.22 / TWT 109713.9 / AVAX 110004.17 / UNI 8944.25 / PENGU 823952.87