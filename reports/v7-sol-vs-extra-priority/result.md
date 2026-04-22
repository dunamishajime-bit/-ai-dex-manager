# V7 SOL vs DOGE/PENGU Priority Comparison

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- strategy_id_source: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_uni_twt_cashrotate_v8

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base_v7_style | Current V7-style baseline with SOL still chosen by normal trend priority. | 858715.57 | 307.2 | -38.41 | 2.105 | 52.58 | 97 | 39.66 |
| extra_over_sol_gap8_mom_eff | Prefer DOGE/PENGU over SOL when score leads by 8 and both mom20 / efficiency are stronger. | 779347.26 | 294.94 | -41.71 | 2.116 | 52.69 | 93 | 39.58 |
| extra_over_sol_gap10_mom_eff | Prefer DOGE/PENGU over SOL when score leads by 10 and both mom20 / efficiency are stronger. | 779347.26 | 294.94 | -41.71 | 2.116 | 52.69 | 93 | 39.58 |
| extra_over_sol_gap10 | Prefer DOGE/PENGU over SOL when strict-extra score leads by 10. | 650315.32 | 273.03 | -41.71 | 2.003 | 51.61 | 93 | 39.02 |
| extra_over_sol_gap8 | Prefer DOGE/PENGU over SOL when strict-extra score leads by 8. | 647507.83 | 272.52 | -41.71 | 1.995 | 51.61 | 93 | 38.97 |

## Symbol Contribution

- base_v7_style: INJ 6973.58 / ETH 153860.99 / DOGE 237263.13 / SOL -49940.8 / AVAX 42135.05 / PENGU 458423.62
- extra_over_sol_gap8_mom_eff: INJ 6973.58 / ETH 151929.48 / DOGE 190986.4 / SOL -70393.47 / AVAX 74528.86 / PENGU 415322.4
- extra_over_sol_gap10_mom_eff: INJ 6973.58 / ETH 151929.48 / DOGE 190986.4 / SOL -70393.47 / AVAX 74528.86 / PENGU 415322.4
- extra_over_sol_gap10: INJ 6973.58 / ETH 132207.94 / DOGE 161112.09 / SOL -65321.52 / AVAX 58783.26 / PENGU 346559.96
- extra_over_sol_gap8: INJ 6973.58 / ETH 132593.5 / DOGE 161112.09 / SOL -59948.22 / AVAX 58783.26 / PENGU 337993.62