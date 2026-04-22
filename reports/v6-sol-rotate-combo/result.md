# V6 SOL Rotation Combo Comparison

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solminus8_v6

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | SOL pnl |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sol_gap5_twice | Rotate out of SOL after 2 consecutive bars with 5-point lead. | 1041047.05 | 332.69 | -33.1 | 2.22 | 54.64 | 97 | 39.66 | -35524.66 |
| sol_gap10_once | Rotate out of SOL immediately on a 10-point lead. | 1038443.54 | 332.35 | -31.56 | 2.239 | 54.55 | 99 | 39.66 | -39580.44 |
| sol_gap10_once_or_gap5_twice | Rotate out of SOL on either 10-point immediate lead or 5-point lead held for 2 bars. | 1038443.54 | 332.35 | -31.56 | 2.239 | 54.55 | 99 | 39.66 | -39580.44 |
| base_v6 | Current production v6. | 981154.22 | 324.68 | -38.41 | 2.109 | 53.68 | 95 | 39.66 | -63433.96 |

## Contributions

- sol_gap5_twice: INJ 9071.42 / ETH 162862.66 / DOGE 278752.02 / SOL -35524.66 / AVAX 89482.35 / PENGU 526403.27
- sol_gap10_once: INJ 6973.58 / ETH 154513.54 / DOGE 270786.88 / SOL -39580.44 / AVAX 122990.65 / PENGU 512759.33
- sol_gap10_once_or_gap5_twice: INJ 6973.58 / ETH 154513.54 / DOGE 270786.88 / SOL -39580.44 / AVAX 122990.65 / PENGU 512759.33
- base_v6: INJ 9071.42 / ETH 177092.19 / DOGE 234032.3 / SOL -63433.96 / AVAX 88373.76 / PENGU 526018.51