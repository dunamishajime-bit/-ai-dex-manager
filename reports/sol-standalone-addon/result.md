# SOL Standalone Addon

| variant | thesis | end equity | CAGR % | MaxDD % | PF | total trades | SOL trades | SOL wins | SOL losses | SOL pnl | top SOL loss reason | count |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| base_v4 | Current production v4. | 744852.64 | 289.34 | -38.41 | 2.101 | 94 | 20 | 8 | 12 | -43722.34 | sma-break | 6 |
| sol_standalone_idle | Remove SOL from the shared trend pool and only allow it as an idle-only standalone candidate. | 184025.98 | 150.53 | -40.89 | 1.848 | 86 | 1 | 0 | 1 | -243.66 | trend-switch | 1 |
| sol_standalone_idle_failcut | Standalone idle-only SOL plus early failure cut if the move loses momentum quickly. | 184025.98 | 150.53 | -40.89 | 1.848 | 86 | 1 | 0 | 1 | -243.66 | trend-switch | 1 |
| sol_standalone_idle_strict | Standalone idle-only SOL with stricter breakout quality so only stronger SOL waves are taken. | 184025.98 | 150.53 | -40.89 | 1.848 | 86 | 1 | 0 | 1 | -243.66 | trend-switch | 1 |