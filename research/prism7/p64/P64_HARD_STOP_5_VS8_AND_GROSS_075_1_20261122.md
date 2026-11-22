# P64 Gross1.0 and -5% hard STOP research for pinned original V20

Retain original Native entries and all profit exits. Source stop8 unchanged in pinned runtime. Simulate standing short STOP when positive-volume M5 HIGH first touches 1.05 entry; exit at max(M5 open, resting STOP limit), NOT a signed venue fill. 1-hour guard models uncertain within-H1 priority; same original 33 and re-slot independently.

| Stop level | Guard H | Gross | fixed33 winners | fixed33 M5 DD | fixed33 NAV ¥ | Re-slot closed | Re-slot winners | Re-slot DD | Re-slot NAV ¥ | original winners turned loser |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SOURCE_NATIVE_HARD_STOP_8PCT | 0 | 0.75 | 18/33 | 25.10029% | 14193.07 | 33 | 18 | 25.10029% | 14193.07 | 0 |
| SOURCE_NATIVE_HARD_STOP_8PCT | 0 | 1.0 | 18/33 | 32.11305% | 15557.46 | 33 | 18 | 32.11305% | 15557.46 | 0 |
| SOURCE_NATIVE_HARD_STOP_8PCT | 1 | 0.75 | 18/33 | 25.10029% | 14193.07 | 33 | 18 | 25.10029% | 14193.07 | 0 |
| SOURCE_NATIVE_HARD_STOP_8PCT | 1 | 1.0 | 18/33 | 32.11305% | 15557.46 | 33 | 18 | 32.11305% | 15557.46 | 0 |
| STANDING_STOP_4PCT | 0 | 0.75 | 15/33 | 20.99061% | 15006.54 | 35 | 16 | 22.79354% | 14780.21 | 7 |
| STANDING_STOP_4PCT | 0 | 1.0 | 15/33 | 27.06668% | 16824.86 | 35 | 16 | 29.34795% | 16482.25 | 7 |
| STANDING_STOP_4PCT | 1 | 0.75 | 15/33 | 20.99061% | 15006.54 | 35 | 16 | 22.79354% | 14780.21 | 7 |
| STANDING_STOP_4PCT | 1 | 1.0 | 15/33 | 27.06668% | 16824.86 | 35 | 16 | 29.34795% | 16482.25 | 7 |
| STANDING_STOP_5PCT | 0 | 0.75 | 17/33 | 21.24567% | 15495.85 | 34 | 18 | 21.24567% | 15770.76 | 2 |
| STANDING_STOP_5PCT | 0 | 1.0 | 17/33 | 27.39723% | 17550.34 | 34 | 18 | 27.39723% | 17965.47 | 2 |
| STANDING_STOP_5PCT | 1 | 0.75 | 17/33 | 21.24567% | 15132.77 | 34 | 18 | 21.24567% | 15401.23 | 2 |
| STANDING_STOP_5PCT | 1 | 1.0 | 17/33 | 27.39723% | 16994.37 | 34 | 18 | 27.39723% | 17396.35 | 2 |
| STANDING_STOP_6PCT | 0 | 0.75 | 17/33 | 21.47387% | 15240.76 | 34 | 18 | 21.47387% | 15511.13 | 2 |
| STANDING_STOP_6PCT | 0 | 1.0 | 17/33 | 27.60558% | 17152.87 | 34 | 18 | 27.60558% | 17558.6 | 2 |
| STANDING_STOP_6PCT | 1 | 0.75 | 17/33 | 21.47387% | 14774.84 | 34 | 18 | 21.47387% | 15036.95 | 2 |
| STANDING_STOP_6PCT | 1 | 1.0 | 17/33 | 27.60558% | 16443.83 | 34 | 18 | 27.60558% | 16832.79 | 2 |

**Decision gate:** Do not reduce live STOP from8 to5 or raise Gross to1 based on this study; require positive source improvement in DD and capital NAV after fees/slippage and original winner retention plus full production venue stop execution and independent data checks.
