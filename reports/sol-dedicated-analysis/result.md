# SOL Dedicated Analysis

## Summary

- trendable_windows_estimated: 8
- trendable_windows_captured: 2
- trendable_windows_missed: 6
- sol_trade_count: 31
- sol_loss_count: 18
- sol_win_count: 13
- sol_net_pnl: -49288.4

Trendable window assumption:
- 12H close > SMA40
- mom20 >= 12%
- ADX14 >= 18
- efficiency >= 0.18
- at least 3 bars
- peak move inside the window >= 15%

## Loss Reasons

| exit reason | count | total net pnl | avg net pnl |
| --- | ---: | ---: | ---: |
| sma-break | 10 | -101746.02 | -10174.6 |
| strict-extra-rotate | 4 | -9090.19 | -2272.55 |
| risk-off | 2 | -63935 | -31967.5 |
| off22-strong | 1 | -663.24 | -663.24 |
| trend-switch | 1 | -19.77 | -19.77 |

## Trendable Windows

| start | end | bars | return % | peak % | avg mom20 | avg adx14 | avg eff | entered | overlapping trades |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2023-07-12T12:00:00.000Z | 2023-07-16T12:00:00.000Z | 9 | 26.8 | 45.19 | 0.3385 | 49.2 | 0.609 | no |  |
| 2023-10-20T00:00:00.000Z | 2023-10-24T12:00:00.000Z | 10 | 27.72 | 31.61 | 0.3205 | 36.62 | 0.665 | no |  |
| 2023-10-30T12:00:00.000Z | 2023-11-03T12:00:00.000Z | 9 | 12.05 | 34.23 | 0.3258 | 48.35 | 0.729 | no |  |
| 2023-11-08T12:00:00.000Z | 2023-11-14T00:00:00.000Z | 12 | 19.14 | 47.66 | 0.371 | 58.03 | 0.526 | yes | retq22-0021 |
| 2023-12-07T12:00:00.000Z | 2023-12-11T00:00:00.000Z | 8 | 16.66 | 21.19 | 0.2389 | 29.37 | 0.578 | no |  |
| 2023-12-21T12:00:00.000Z | 2023-12-27T00:00:00.000Z | 12 | 29.28 | 45.22 | 0.4545 | 32.48 | 0.771 | no |  |
| 2024-03-12T00:00:00.000Z | 2024-03-20T12:00:00.000Z | 18 | 15.61 | 41.22 | 0.2933 | 30.24 | 0.558 | yes | retq22-0036 |
| 2025-01-18T12:00:00.000Z | 2025-01-20T12:00:00.000Z | 5 | 9.06 | 23.8 | 0.3537 | 30.52 | 0.721 | no |  |

## Missed Trendable Windows

| start | end | bars | return % | peak % | class | desired | held | note |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| 2023-07-12T12:00:00.000Z | 2023-07-16T12:00:00.000Z | 9 | 26.8 | 45.19 | timing_mismatch | ETH | SOL | SOL became a desired symbol at times, but the actual trade timing did not overlap this trend window. |
| 2023-10-20T00:00:00.000Z | 2023-10-24T12:00:00.000Z | 10 | 27.72 | 31.61 | timing_mismatch | SOL | SOL | SOL became a desired symbol at times, but the actual trade timing did not overlap this trend window. |
| 2023-10-30T12:00:00.000Z | 2023-11-03T12:00:00.000Z | 9 | 12.05 | 34.23 | other_symbol_already_held | SOL | DOGE | DOGE was already held, so the single-position rule blocked a SOL entry. |
| 2023-12-07T12:00:00.000Z | 2023-12-11T00:00:00.000Z | 8 | 16.66 | 21.19 | other_symbol_preferred | AVAX | AVAX | SOL became eligible on some bars, but AVAX was preferred by the ranking. |
| 2023-12-21T12:00:00.000Z | 2023-12-27T00:00:00.000Z | 12 | 29.28 | 45.22 | other_symbol_already_held | SOL | AVAX | AVAX was already held, so the single-position rule blocked a SOL entry. |
| 2025-01-18T12:00:00.000Z | 2025-01-20T12:00:00.000Z | 5 | 9.06 | 23.8 | timing_mismatch | SOL | SOL | SOL became a desired symbol at times, but the actual trade timing did not overlap this trend window. |

## Worst SOL Losses

| trade id | entry | exit | net pnl | bars | entry reason | exit reason |
| --- | --- | --- | ---: | ---: | --- | --- |
| retq22-0084 | 2025-09-16T12:00:00.000Z | 2025-09-22T12:00:00.000Z | -53256.88 | 12 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | risk-off |
| retq22-0085 | 2025-10-03T00:00:00.000Z | 2025-10-08T00:00:00.000Z | -52835.16 | 10 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | sma-break |
| retq22-0089 | 2026-01-10T00:00:00.000Z | 2026-01-19T12:00:00.000Z | -13540.71 | 19 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | sma-break |
| retq22-0068 | 2025-04-15T12:00:00.000Z | 2025-04-16T00:00:00.000Z | -10678.12 | 1 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | risk-off |
| retq22-0038 | 2024-04-01T00:00:00.000Z | 2024-04-02T12:00:00.000Z | -10483.99 | 3 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | sma-break |
| retq22-0047 | 2024-09-29T12:00:00.000Z | 2024-10-03T00:00:00.000Z | -8027.84 | 7 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | sma-break |
| retq22-0028 | 2023-12-29T12:00:00.000Z | 2024-01-06T12:00:00.000Z | -5800.1 | 16 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | sma-break |
| retq22-0086 | 2025-10-08T12:00:00.000Z | 2025-10-10T00:00:00.000Z | -5169.89 | 3 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | sma-break |
| retq22-0040 | 2024-05-20T12:00:00.000Z | 2024-05-26T00:00:00.000Z | -4942.13 | 11 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | strict-extra-rotate |
| retq22-0057 | 2024-11-18T00:00:00.000Z | 2024-11-21T00:00:00.000Z | -3107.95 | 6 | trend-close>sma40|mom20-ok|sol-ok|eff-ok|retq22-off | strict-extra-rotate |