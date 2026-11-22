# P51: M5 continuation / rebound after CLOSED H1 first-break event

Source 149 H1 first-break candidates, 107 cleaner pre-drop, 53 Native V20 source cases frozen.
All M5 gates use ONLY fully completed bars before entry. Zero volume candles are not selling pressure. Entry uses scheduled future M5 OPEN price proxy, independent of that bar's future volume.

| Group | Mode | Wait | Eligible | Closed | Wins | Win% | M5 High DD | ¥10k NAV | Zero-vol at entry (ex post) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ALL149_P48 | D0_H1_OPEN | 0 | 149 | 103 | 56 | 54.36893% | 42.40734% | 15082.08 | 37 |
| ALL149_P48 | WAIT15_ONLY | 15 | 149 | 103 | 57 | 55.33981% | 40.48965% | 14491.98 | 38 |
| ALL149_P48 | WAIT30_ONLY | 30 | 149 | 102 | 55 | 53.92157% | 34.43965% | 15273.3 | 41 |
| ALL149_P48 | WAIT60_ONLY | 60 | 149 | 99 | 57 | 57.57576% | 35.65476% | 18599.34 | 36 |
| ALL149_P48 | WAIT15_LIQUID_2OF3 | 15 | 89 | 67 | 34 | 50.74627% | 48.14207% | 7016.51 | 15 |
| ALL149_P48 | WAIT15_SELL_VOL60 | 15 | 20 | 18 | 10 | 55.55556% | 32.59147% | 11372.57 | 1 |
| ALL149_P48 | WAIT15_CONTINUATION_0P3 | 15 | 19 | 17 | 9 | 52.94118% | 28.8078% | 9950.67 | 1 |
| ALL149_P48 | WAIT30_LIQUID_3OF6 | 30 | 94 | 70 | 35 | 50.0% | 40.35012% | 8742.91 | 18 |
| ALL149_P48 | WAIT30_SELL_VOL60 | 30 | 19 | 19 | 9 | 47.36842% | 32.48773% | 9809.22 | 7 |
| ALL149_P48 | WAIT30_LOWER_LOW | 30 | 32 | 29 | 14 | 48.27586% | 35.89732% | 8884.31 | 9 |
| ALL149_P48 | WAIT30_SELL_AND_BREAK | 30 | 15 | 15 | 7 | 46.66667% | 33.33134% | 9097.26 | 5 |
| ALL149_P48 | WAIT30_NO_REBOUND | 30 | 41 | 38 | 18 | 47.36842% | 26.16904% | 9141.03 | 10 |
| ALL149_P48 | WAIT30_BEAR_MOMENTUM | 30 | 27 | 24 | 15 | 62.5% | 19.71421% | 14407.43 | 8 |
| ALL149_P48 | WAIT30_BULL_RECOVERY_CONTROL | 30 | 25 | 23 | 11 | 47.82609% | 37.14619% | 7741.25 | 7 |
| ALL149_P48 | WAIT60_SELL_AND_BREAK | 60 | 18 | 18 | 12 | 66.66667% | 22.62462% | 12792.31 | 5 |
| STRICT107_FIRST_UNDROPPED | D0_H1_OPEN | 0 | 107 | 81 | 42 | 51.85185% | 38.1777% | 13339.32 | 29 |
| STRICT107_FIRST_UNDROPPED | WAIT15_ONLY | 15 | 107 | 81 | 43 | 53.08642% | 33.88451% | 11757.38 | 30 |
| STRICT107_FIRST_UNDROPPED | WAIT30_ONLY | 30 | 107 | 80 | 42 | 52.5% | 29.27918% | 12237.28 | 34 |
| STRICT107_FIRST_UNDROPPED | WAIT60_ONLY | 60 | 107 | 79 | 44 | 55.6962% | 28.99934% | 14261.66 | 34 |
| STRICT107_FIRST_UNDROPPED | WAIT15_LIQUID_2OF3 | 15 | 58 | 47 | 24 | 51.06383% | 36.08735% | 8198.43 | 12 |
| STRICT107_FIRST_UNDROPPED | WAIT15_SELL_VOL60 | 15 | 12 | 11 | 6 | 54.54545% | 20.29165% | 11743.0 | 0 |
| STRICT107_FIRST_UNDROPPED | WAIT15_CONTINUATION_0P3 | 15 | 12 | 11 | 6 | 54.54545% | 25.66967% | 10950.69 | 0 |
| STRICT107_FIRST_UNDROPPED | WAIT30_LIQUID_3OF6 | 30 | 66 | 52 | 27 | 51.92308% | 22.75864% | 10500.94 | 14 |
| STRICT107_FIRST_UNDROPPED | WAIT30_SELL_VOL60 | 30 | 11 | 11 | 6 | 54.54545% | 12.57543% | 11152.71 | 4 |
| STRICT107_FIRST_UNDROPPED | WAIT30_LOWER_LOW | 30 | 21 | 20 | 11 | 55.0% | 22.29124% | 10894.89 | 4 |
| STRICT107_FIRST_UNDROPPED | WAIT30_SELL_AND_BREAK | 30 | 9 | 9 | 5 | 55.55556% | 18.09089% | 10395.93 | 2 |
| STRICT107_FIRST_UNDROPPED | WAIT30_NO_REBOUND | 30 | 28 | 26 | 13 | 50.0% | 20.21184% | 11185.26 | 7 |
| STRICT107_FIRST_UNDROPPED | WAIT30_BEAR_MOMENTUM | 30 | 18 | 17 | 11 | 64.70588% | 14.38465% | 13276.44 | 4 |
| STRICT107_FIRST_UNDROPPED | WAIT30_BULL_RECOVERY_CONTROL | 30 | 17 | 16 | 8 | 50.0% | 26.8942% | 8340.43 | 5 |
| STRICT107_FIRST_UNDROPPED | WAIT60_SELL_AND_BREAK | 60 | 13 | 13 | 9 | 69.23077% | 15.26283% | 12604.3 | 4 |

All scenario metrics are research-only, no true OOS, no real venue execution. M5 event starts after a CLOSED H1 decline, so this tests continuation after the first H1 move, not truly predictive pre-drop entry.
