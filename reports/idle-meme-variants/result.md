# Idle Meme Variants

Base profile: reclaim_plus_avax_sol_aux_alloc100_pengu_idle_v1

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | DOGE pnl | DOGE losses | DOGE late-exit-like | PENGU pnl | PENGU losses | PENGU late-exit-like |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base_pengu_idle | Strongest reference: aux 100% + PENGU idle-only. | 206790.86 | 186.47 | -31.04 | 2.739 | 58.33 | 60 | 0 | 0 | 0 | 95169.16 | 0 | 0 |
| doge_pengu_idle | Add DOGE together with PENGU as idle-only extra trend symbols. | 165531.31 | 165.16 | -28.96 | 2.701 | 57.14 | 63 | 2475.18 | 2 | 1 | 76180.87 | 0 | 0 |
| doge_pengu_idle_sma40_exit | Add DOGE idle-only and speed up exits with SMA40 trend exits. | 139386.51 | 149.78 | -33.21 | 2.137 | 56.25 | 64 | 2404.26 | 2 | 1 | 75251.68 | 0 | 0 |
| doge_pengu_idle_sma40_exit_eff018 | Add DOGE idle-only, use SMA40 exits, and loosen efficiency slightly for earlier entries. | 132192.21 | 145.23 | -33.21 | 2.041 | 55.38 | 65 | 15757.08 | 2 | 1 | 56459.43 | 0 | 0 |

## Summaries

### base_pengu_idle

- Thesis: Strongest reference: aux 100% + PENGU idle-only.
- DOGE: {"symbol":"DOGE","trade_count":0,"pnl":0,"loss_count":0,"quick_loss_count":0,"late_exit_like_count":0}
- PENGU: {"symbol":"PENGU","trade_count":3,"pnl":95169.16,"loss_count":0,"quick_loss_count":0,"late_exit_like_count":0}

### doge_pengu_idle

- Thesis: Add DOGE together with PENGU as idle-only extra trend symbols.
- DOGE: {"symbol":"DOGE","trade_count":3,"pnl":2475.18,"loss_count":2,"quick_loss_count":1,"late_exit_like_count":1}
- PENGU: {"symbol":"PENGU","trade_count":3,"pnl":76180.87,"loss_count":0,"quick_loss_count":0,"late_exit_like_count":0}

### doge_pengu_idle_sma40_exit

- Thesis: Add DOGE idle-only and speed up exits with SMA40 trend exits.
- DOGE: {"symbol":"DOGE","trade_count":3,"pnl":2404.26,"loss_count":2,"quick_loss_count":1,"late_exit_like_count":1}
- PENGU: {"symbol":"PENGU","trade_count":3,"pnl":75251.68,"loss_count":0,"quick_loss_count":0,"late_exit_like_count":0}

### doge_pengu_idle_sma40_exit_eff018

- Thesis: Add DOGE idle-only, use SMA40 exits, and loosen efficiency slightly for earlier entries.
- DOGE: {"symbol":"DOGE","trade_count":4,"pnl":15757.08,"loss_count":2,"quick_loss_count":1,"late_exit_like_count":1}
- PENGU: {"symbol":"PENGU","trade_count":2,"pnl":56459.43,"loss_count":0,"quick_loss_count":0,"late_exit_like_count":0}
