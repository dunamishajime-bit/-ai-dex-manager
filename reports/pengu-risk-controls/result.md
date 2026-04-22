# PENGU Risk Controls

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | PENGU contribution | PENGU risk exits |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | Current strongest profile. | 206790.86 | 186.47 | -31.04 | 2.739 | 58.33 | 60 | 95169.16 | 0 |
| pengu_tighter_trailing | Keep base logic but tighten PENGU trailing protection once profit is on the table. | 241345.05 | 202.28 | -31.04 | 2.924 | 58.33 | 60 | 125308.66 | 3 |
| pengu_hard_stop_12pct | Keep base logic but cut PENGU if it falls 12% below entry. | 206790.86 | 186.47 | -31.04 | 2.739 | 58.33 | 60 | 95169.16 | 0 |
| pengu_max_hold_12bars | Keep base logic but cap PENGU holding time to 12 bars. | 206790.86 | 186.47 | -31.04 | 2.739 | 58.33 | 60 | 95169.16 | 0 |
| pengu_hard_stop_and_trailing | Combine PENGU hard stop and tighter trailing protection. | 241345.05 | 202.28 | -31.04 | 2.924 | 58.33 | 60 | 125308.66 | 3 |