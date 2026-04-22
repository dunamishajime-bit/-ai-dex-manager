# V5 Improvement Analysis

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_inj_idle_solminus8_v5

## Variant Summary

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v5_inj_dedicated | Keep v5, but add the dedicated INJ breakout-surge conditions that previously tested well. | 981154.22 | 324.68 | -38.41 | 2.109 | 53.68 | 95 | 39.66 |
| v5_combo | Combine dedicated INJ logic, better ETH quality, and stronger SOL suppression. | 495412.85 | 242.36 | -35.14 | 1.721 | 54.35 | 92 | 37.94 |
| base_v5 | Current production v5 as deployed. | 300741.37 | 192.5 | -40.63 | 1.554 | 47.96 | 98 | 40.14 |
| v5_sol_minus10 | Push SOL priority a bit lower to suppress weak SOL participation further. | 300741.37 | 192.5 | -40.63 | 1.554 | 47.96 | 98 | 40.14 |
| v5_no_sol_specific | Remove SOL score demotion and re-enable SOL aux range to verify SOL-specific logic actually matters. | 269479.85 | 182.55 | -39.88 | 1.531 | 49.49 | 99 | 40.09 |
| v5_eth_quality | Raise ETH entry quality slightly to reduce risk-off and weak entries. | 164861.56 | 141.99 | -43.23 | 1.399 | 50.52 | 97 | 38.45 |

## v5_inj_dedicated

### Symbol Stats

| symbol | trades | wins | losses | total pnl | avg pnl |
| --- | ---: | ---: | ---: | ---: | ---: |
| ETH | 36 | 18 | 18 | 177092.19 | 4919.23 |
| SOL | 18 | 7 | 11 | -63433.96 | -3524.11 |
| AVAX | 10 | 9 | 1 | 88373.76 | 8837.38 |
| PENGU | 8 | 4 | 4 | 526018.51 | 65752.31 |
| DOGE | 17 | 10 | 7 | 234032.3 | 13766.61 |
| INJ | 6 | 3 | 3 | 9071.42 | 1511.9 |

### Loss Reasons

- ETH: risk-off (2, -184294.01) / sma-break (7, -103888.39) / strict-extra-rotate (6, -41148.72) / trend-switch (2, -5874.52) / range-time (1, -142.5)
- SOL: risk-off (2, -95550.25) / sma-break (6, -47659.67) / strict-extra-rotate (2, -11619.69) / off22-strong (1, -713.69)
- AVAX: trend-switch (1, -66857.01)
- PENGU: sma-break (1, -126275.94) / trend-switch (2, -85850.3) / end-of-test (1, -7660.28)
- DOGE: trend-switch (5, -58245.45) / risk-off (1, -31872.59) / sma-break (1, -6513.18)
- INJ: trend-switch (3, -1901.79)

## v5_combo

### Symbol Stats

| symbol | trades | wins | losses | total pnl | avg pnl |
| --- | ---: | ---: | ---: | ---: | ---: |
| ETH | 22 | 13 | 9 | 59113.37 | 2686.97 |
| SOL | 25 | 8 | 17 | -208570.02 | -8342.8 |
| AVAX | 11 | 10 | 1 | 43005.88 | 3909.63 |
| PENGU | 7 | 5 | 2 | 503021.27 | 71860.18 |
| DOGE | 21 | 11 | 10 | 81282.37 | 3870.59 |
| INJ | 6 | 3 | 3 | 7560 | 1260 |

### Loss Reasons

- ETH: risk-off (2, -97653.6) / sma-break (3, -37067.72) / trend-switch (2, -2991.32) / strict-extra-rotate (1, -321.86) / range-time (1, -121.92)
- SOL: risk-off (3, -131378.95) / sma-break (8, -78270.84) / strict-extra-rotate (6, -61486.26)
- AVAX: sma-break (1, -54155.3)
- PENGU: trend-switch (1, -14989.77) / end-of-test (1, -3867.89)
- DOGE: sma-break (5, -134586.53) / trend-switch (4, -28357) / risk-off (1, -26407.04)
- INJ: trend-switch (3, -1886.73)

## base_v5

### Symbol Stats

| symbol | trades | wins | losses | total pnl | avg pnl |
| --- | ---: | ---: | ---: | ---: | ---: |
| ETH | 26 | 10 | 16 | 19840.73 | 763.11 |
| SOL | 16 | 6 | 10 | -16530.27 | -1033.14 |
| AVAX | 10 | 9 | 1 | 30858.18 | 3085.82 |
| PENGU | 9 | 5 | 4 | 185301.32 | 20589.04 |
| DOGE | 14 | 8 | 6 | 148772.05 | 10626.58 |
| INJ | 23 | 9 | 14 | -77500.64 | -3369.59 |

### Loss Reasons

- ETH: risk-off (2, -55578.44) / sma-break (4, -34479.42) / strict-extra-rotate (5, -17652.77) / trend-switch (4, -9984.15) / range-time (1, -128.91)
- SOL: risk-off (2, -36794.96) / sma-break (4, -20879.09) / strict-extra-rotate (2, -7611.84) / off22-strong (1, -645.57) / trend-switch (1, -419.66)
- AVAX: trend-switch (1, -47100.68)
- PENGU: trend-switch (3, -41622.18) / sma-break (1, -39840.24)
- DOGE: sma-break (3, -35013.61) / trend-switch (3, -24129.94)
- INJ: strict-extra-rotate (4, -61600.88) / sma-break (5, -57200.32) / risk-off (2, -24008.63) / trend-switch (2, -9331.49) / off22-strong (1, -669.57)

## v5_sol_minus10

### Symbol Stats

| symbol | trades | wins | losses | total pnl | avg pnl |
| --- | ---: | ---: | ---: | ---: | ---: |
| ETH | 26 | 10 | 16 | 19840.73 | 763.11 |
| SOL | 16 | 6 | 10 | -16530.27 | -1033.14 |
| AVAX | 10 | 9 | 1 | 30858.18 | 3085.82 |
| PENGU | 9 | 5 | 4 | 185301.32 | 20589.04 |
| DOGE | 14 | 8 | 6 | 148772.05 | 10626.58 |
| INJ | 23 | 9 | 14 | -77500.64 | -3369.59 |

### Loss Reasons

- ETH: risk-off (2, -55578.44) / sma-break (4, -34479.42) / strict-extra-rotate (5, -17652.77) / trend-switch (4, -9984.15) / range-time (1, -128.91)
- SOL: risk-off (2, -36794.96) / sma-break (4, -20879.09) / strict-extra-rotate (2, -7611.84) / off22-strong (1, -645.57) / trend-switch (1, -419.66)
- AVAX: trend-switch (1, -47100.68)
- PENGU: trend-switch (3, -41622.18) / sma-break (1, -39840.24)
- DOGE: sma-break (3, -35013.61) / trend-switch (3, -24129.94)
- INJ: strict-extra-rotate (4, -61600.88) / sma-break (5, -57200.32) / risk-off (2, -24008.63) / trend-switch (2, -9331.49) / off22-strong (1, -669.57)

## v5_no_sol_specific

### Symbol Stats

| symbol | trades | wins | losses | total pnl | avg pnl |
| --- | ---: | ---: | ---: | ---: | ---: |
| ETH | 22 | 10 | 12 | 45261.25 | 2057.33 |
| SOL | 26 | 11 | 15 | -31345.87 | -1205.61 |
| AVAX | 7 | 6 | 1 | -6252.64 | -893.23 |
| PENGU | 9 | 5 | 4 | 166307.96 | 18478.66 |
| DOGE | 13 | 8 | 5 | 152929.55 | 11763.81 |
| INJ | 22 | 9 | 13 | -67420.41 | -3064.56 |

### Loss Reasons

- ETH: risk-off (2, -49664.53) / strict-extra-rotate (3, -13420.19) / sma-break (3, -8196.57) / trend-switch (3, -7323.13) / range-time (1, -128.91)
- SOL: sma-break (6, -65994.93) / risk-off (2, -33156.74) / strict-extra-rotate (4, -7902.35) / off22-strong (1, -645.57) / trend-switch (2, -436.85)
- AVAX: trend-switch (1, -44612.53)
- PENGU: trend-switch (3, -37860.89) / sma-break (1, -37188.33)
- DOGE: sma-break (3, -32014.68) / trend-switch (2, -11831.68)
- INJ: strict-extra-rotate (3, -54733.02) / sma-break (5, -51879.61) / risk-off (2, -22530.29) / trend-switch (2, -8534.85) / off22-strong (1, -669.57)

## v5_eth_quality

### Symbol Stats

| symbol | trades | wins | losses | total pnl | avg pnl |
| --- | ---: | ---: | ---: | ---: | ---: |
| ETH | 15 | 9 | 6 | 19007.13 | 1267.14 |
| SOL | 21 | 7 | 14 | -66860.57 | -3183.84 |
| AVAX | 10 | 9 | 1 | 15263.98 | 1526.4 |
| PENGU | 8 | 6 | 2 | 164267.79 | 20533.47 |
| DOGE | 17 | 8 | 9 | 79437.47 | 4672.79 |
| INJ | 26 | 10 | 16 | -56254.24 | -2163.62 |

### Loss Reasons

- ETH: risk-off (2, -32269.63) / trend-switch (2, -5366.92) / strict-extra-rotate (1, -204.07) / range-time (1, -114.54)
- SOL: risk-off (3, -49639.84) / sma-break (5, -30739.81) / strict-extra-rotate (5, -24559.29) / trend-switch (1, -372.92)
- AVAX: sma-break (1, -37156.7)
- PENGU: trend-switch (2, -16338.19)
- DOGE: sma-break (6, -65850.31) / trend-switch (3, -12425.12)
- INJ: strict-extra-rotate (6, -46856.87) / sma-break (6, -41832.4) / risk-off (2, -18221.51) / trend-switch (1, -6000) / off22-strong (1, -645.39)
