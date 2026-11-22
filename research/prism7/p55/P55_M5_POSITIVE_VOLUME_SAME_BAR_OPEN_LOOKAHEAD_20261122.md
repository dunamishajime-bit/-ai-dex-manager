# P55 | M5 volume-based fill-time lookahead in earlier research price model

Original P20 H1 study chooses first future positive-volume M5 candle *at that candle's OPEN*. But volume becomes observable only at candle CLOSE. P55 compares that optimistic open-price model with waiting to observe the printed candle and pricing the subsequent 5m OPEN.

| Signal source | Source H1 candidates | Old closed | Old wins | Old M5 DD | Old ¥10k NAV | New closed | New wins | New M5 DD | New ¥10k NAV | New entry bar zero-volume ex post |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| P47_ALL_FIRST_H1_BREAK_149 | 149 | 97 | 56 | 41.12012% | 18784.31 | 97 | 55 | 44.88667% | 17344.8 | 38 |
| P47_H1_PREARM6_ALL3_21 | 21 | 18 | 13 | 12.13258% | 16700.59 | 18 | 13 | 12.51696% | 16832.98 | 9 |
| P48_STRICT_CLEAN_H1_FIRST107 | 107 | 77 | 41 | 35.83816% | 12980.33 | 77 | 42 | 38.96464% | 12824.31 | 31 |
| P48_STRICT_CLEAN_PREARM6_8 | 8 | 6 | 3 | 11.43516% | 10560.05 | 6 | 3 | 11.21815% | 10570.79 | 3 |

**This is a research execution-model correction test.** It does not imply the real Native V20 LIVE runner reads future M5 volume. Both old and new are not signed fills. No production modification.
