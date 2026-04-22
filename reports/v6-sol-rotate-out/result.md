# V6 SOL Rotate-Out Comparison

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solminus8_v6

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | SOL trades | SOL pnl |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sol_rotate_gap5_twice | Rotate out of SOL after 2 consecutive bars where another candidate leads by 5. | 1041047.05 | 332.69 | -33.1 | 2.22 | 54.64 | 97 | 39.66 | 19 | -35524.66 |
| sol_rotate_gap10_once | Rotate out of SOL when another trend candidate leads by 10 points. | 1038443.54 | 332.35 | -31.56 | 2.239 | 54.55 | 99 | 39.66 | 20 | -39580.44 |
| sol_rotate_gap0_once | If SOL is held and another trend candidate becomes eligible, rotate immediately. | 984424.36 | 325.13 | -37.56 | 1.955 | 54.37 | 103 | 39.66 | 20 | -14871.8 |
| base_v6 | Current production v6. | 981154.22 | 324.68 | -38.41 | 2.109 | 53.68 | 95 | 39.66 | 18 | -63433.96 |
| sol_rotate_gap5_once | Rotate out of SOL when another trend candidate leads by 5 points. | 879027.86 | 310.22 | -37.56 | 1.949 | 54.46 | 101 | 39.75 | 20 | -21665.89 |

## Contributions

- sol_rotate_gap5_twice: INJ 9071.42 / ETH 162862.66 / DOGE 278752.02 / SOL -35524.66 / AVAX 89482.35 / PENGU 526403.27
- sol_rotate_gap10_once: INJ 6973.58 / ETH 154513.54 / DOGE 270786.88 / SOL -39580.44 / AVAX 122990.65 / PENGU 512759.33
- sol_rotate_gap0_once: INJ 4946.48 / ETH 19833.91 / DOGE 292195 / SOL -14871.8 / AVAX 122416.51 / PENGU 549904.25
- base_v6: INJ 9071.42 / ETH 177092.19 / DOGE 234032.3 / SOL -63433.96 / AVAX 88373.76 / PENGU 526018.51
- sol_rotate_gap5_once: INJ 6973.58 / ETH 22970.1 / DOGE 261411.26 / SOL -21665.89 / AVAX 108309.55 / PENGU 491029.26