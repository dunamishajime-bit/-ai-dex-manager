# V6 SOL Filter + Size Comparison

- start_utc: 2022-01-01T00:00:00.000Z
- end_utc: 2026-04-18T23:59:59.999Z
- strategy_id: reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solminus8_v6

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | SOL trades | SOL wins | SOL losses | SOL pnl |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base_v6 | Current production v6. | 981154.22 | 324.68 | -38.41 | 2.109 | 53.68 | 95 | 39.66 | 18 | 7 | 11 | -63433.96 |
| sol_5pct_only | SOL only 5% allocation, no extra filter. | 851790.12 | 306.16 | -31.66 | 2.372 | 53.68 | 95 | 39.66 | 18 | 7 | 11 | -2193.93 |
| sol_5pct_eff_vol | SOL 5% allocation + require stronger efficiency and volume. | 745624.01 | 289.47 | -35.29 | 2.152 | 53.76 | 93 | 38.84 | 14 | 6 | 8 | 892.48 |
| sol_100pct_eff_vol | SOL 100% allocation + require stronger efficiency and volume. | 743159.37 | 289.06 | -38.41 | 2.097 | 53.76 | 93 | 38.84 | 14 | 6 | 8 | 12040.76 |
| sol_5pct_eff_vol_accel | SOL 5% allocation + stronger efficiency, volume, and momentum acceleration. | 469590.21 | 236.63 | -37.38 | 2.062 | 49.44 | 89 | 37.2 | 7 | 2 | 5 | -139.82 |
| sol_5pct_light_breakout | SOL 5% allocation + light breakout gate and stricter quality. | 350184.53 | 206.88 | -38.08 | 1.973 | 48.31 | 89 | 36.64 | 4 | 1 | 3 | -321.3 |