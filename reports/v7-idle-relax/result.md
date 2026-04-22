# V7 Idle Relax Comparison

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_v7

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | idle % | idle days |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base_v7 | Current production v7 baseline. | 858715.57 | 307.2 | -38.41 | 2.105 | 52.58 | 97 | 39.66 | 60.34 | 699 |
| idle_trend_gate_relax | While in USDT only, allow trend entry even when the normal trend gate is off. | 850668.59 | 305.99 | -38.41 | 2.105 | 52.04 | 98 | 39.71 | 60.29 | 698.5 |
| idle_eff_relax | While in USDT only, lower the trend efficiency threshold slightly. | 812049.96 | 300.09 | -41.76 | 2.092 | 52.04 | 98 | 39.71 | 60.29 | 698.5 |
| idle_mom20_relax | While in USDT only, allow slightly softer momentum at entry. | 695488.38 | 281.01 | -43.43 | 2.008 | 51 | 100 | 40.14 | 59.86 | 693.5 |
| idle_all_relaxed | While in USDT only, relax trend gate, efficiency, and momentum together. | 651529.89 | 273.25 | -46.5 | 1.994 | 50 | 102 | 40.22 | 59.78 | 692.5 |

## Contributions

- base_v7: INJ 6973.58 / ETH 153860.99 / DOGE 237263.13 / SOL -49940.8 / AVAX 42135.05 / PENGU 458423.62
- idle_trend_gate_relax: INJ 6890.52 / ETH 152293.7 / DOGE 235059.99 / SOL -49443.49 / AVAX 41740.32 / PENGU 454127.54
- idle_eff_relax: INJ 6973.58 / ETH 146992.5 / DOGE 225247.89 / SOL -52200.33 / AVAX 41525.11 / PENGU 433511.2
- idle_mom20_relax: INJ 6973.58 / ETH 121959.15 / DOGE 219413.2 / SOL -68623.04 / AVAX 34480.54 / PENGU 371284.96
- idle_all_relaxed: INJ 6890.52 / ETH 115150.53 / DOGE 206471.55 / SOL -68765.71 / AVAX 33965.18 / PENGU 347817.82