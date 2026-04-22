# Production Improvement Analysis

## Variant Comparison

| variant | thesis | end equity | CAGR % | MaxDD % | PF | trades | losses | sma-break losses | risk-off losses | rotate losses | exposure % | PENGU contribution |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | Current live implementation. | 259715.64 | 179.28 | -36.47 | 2.041 | 69 | 32 | 15 | 6 | 2 | 38.41 | 125486.2 |
| eth_sol_weak_exit | Add earlier weak exit for ETH and SOL when both momentum and momentum acceleration deteriorate. | 179506.64 | 148.57 | -46.29 | 2.227 | 80 | 44 | 2 | 4 | 0 | 26.77 | 106459.29 |
| pengu_rotate_volume_filter | Keep current logic but require stronger volume when PENGU enters as strict-extra candidate. | 194737.17 | 155.04 | -36.47 | 2.138 | 65 | 29 | 14 | 6 | 1 | 37.94 | 99857.76 |
| combo | Combine ETH/SOL weak exit and PENGU strict-extra volume filter. | 102855.31 | 108.54 | -46.29 | 1.881 | 78 | 44 | 2 | 4 | 0 | 25.86 | 36504.6 |

## Longest Idle Window Diagnostics

| start | end | days | reserve-wait bars | trend eligible bars | PENGU eligible bars | max top score | max PENGU score | top symbols |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2025-10-10T00:00:00.000Z | 2026-01-04T00:00:00.000Z | 86.5 | 164 | 9 | 4 | 50.46 | 50.46 | ETH:88, SOL:38, AVAX:37 |
| 2026-01-19T12:00:00.000Z | 2026-03-16T12:00:00.000Z | 56.5 | 106 | 7 | 1 | 31.59 | 31.59 | AVAX:41, ETH:31, PENGU:22 |
| 2024-08-02T12:00:00.000Z | 2024-09-23T12:00:00.000Z | 52.5 | 86 | 19 | 0 | 62.54 | -Infinity | AVAX:57, ETH:28, SOL:20 |
| 2023-08-10T00:00:00.000Z | 2023-09-26T12:00:00.000Z | 48 | 91 | 5 | 0 | 21.02 | -Infinity | ETH:62, SOL:34 |
| 2025-02-21T12:00:00.000Z | 2025-04-09T12:00:00.000Z | 47.5 | 94 | 0 | 0 | 46.58 | 28.81 | AVAX:36, ETH:24, PENGU:18 |
| 2024-04-08T12:00:00.000Z | 2024-05-20T00:00:00.000Z | 42 | 67 | 14 | 0 | 42.89 | -Infinity | ETH:46, SOL:34, AVAX:4 |
| 2024-06-09T00:00:00.000Z | 2024-07-19T12:00:00.000Z | 41 | 69 | 7 | 0 | 34.28 | -Infinity | ETH:38, SOL:34, AVAX:10 |
| 2023-04-21T12:00:00.000Z | 2023-05-28T12:00:00.000Z | 37.5 | 70 | 5 | 0 | 14.52 | -Infinity | ETH:56, SOL:18, AVAX:1 |