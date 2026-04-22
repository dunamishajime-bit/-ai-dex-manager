# SOL V4 Optimization

| variant | thesis | end equity | CAGR % | MaxDD % | PF | total trades | SOL trades | SOL wins | SOL losses | SOL pnl | top SOL loss reason | count |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| sol_failcut | Keep SOL entry logic, but cut SOL earlier when momentum fails immediately after entry. | 806660.65 | 299.25 | -36.78 | 2.16 | 94 | 23 | 10 | 13 | -59150.85 | symbol-weak-exit | 9 |
| sol_score_minus10 | Lower SOL rank slightly more so it needs to be more clearly superior before selection. | 786438.12 | 296.07 | -37.15 | 2.109 | 93 | 18 | 8 | 10 | -35479.23 | sma-break | 5 |
| sol_score_minus10_plus_failcut | Combine stronger SOL demotion with early failure cut. | 767043.85 | 292.96 | -41.17 | 2.143 | 93 | 21 | 10 | 11 | -54616.38 | symbol-weak-exit | 8 |
| base_v4 | Current production v4. | 744852.64 | 289.34 | -38.41 | 2.101 | 94 | 20 | 8 | 12 | -43722.34 | sma-break | 6 |
| sol_score_minus12 | Lower SOL rank further to cut marginal SOL entries. | 722321.06 | 285.59 | -37.15 | 2.072 | 96 | 18 | 8 | 10 | -45675.7 | sma-break | 4 |
| sol_loose_breakout_plus_demote | Require SOL to break out a bit more cleanly while still demoting ranking modestly. | 172271.55 | 145.37 | -38.19 | 1.919 | 86 | 3 | 1 | 2 | -173.37 | strict-extra-rotate | 1 |
| sol_quality_gate | Keep SOL in the universe, but require better volume and momentum quality before taking it. | 143750.05 | 131.76 | -40.89 | 1.809 | 86 | 2 | 0 | 2 | -1901.22 | strict-extra-rotate | 1 |
| sol_quality_gate_strict | Require clearly stronger SOL participation before entry, aiming to remove marginal losers. | 143750.05 | 131.76 | -40.89 | 1.809 | 86 | 2 | 0 | 2 | -1901.22 | strict-extra-rotate | 1 |