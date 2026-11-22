# P46 | pre-D3 leading H1 condition stability check

Tests 3 bearish context flags with 1h/3h/6h/12h/24h lead before crossing D3. Same native53 H1 original exits and P44 one-slot gross0.75.

| Lead h | Before D3 regime? | Source kept | Source winners | Single-slot n | Single-slot wins | win% | M5 high DD | NAV yen |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | False | 21 | 19 | 14 | 12 | 85.71429% | 15.20671% | 17380.78 |
| 1 | True | 21 | 19 | 14 | 12 | 85.71429% | 15.20671% | 17380.78 |
| 3 | False | 10 | 8 | 8 | 6 | 75.0% | 9.66449% | 14411.04 |
| 3 | True | 4 | 3 | 4 | 3 | 75.0% | 7.27869% | 12506.66 |
| 6 | False | 13 | 9 | 10 | 6 | 60.0% | 14.52123% | 12734.18 |
| 6 | True | 1 | 1 | 1 | 1 | 100.0% | 5.88366% | 11010.52 |
| 12 | False | 13 | 3 | 6 | 2 | 33.33333% | 19.14114% | 9372.29 |
| 12 | True | 4 | 1 | 3 | 1 | 33.33333% | 11.15137% | 10019.43 |
| 24 | False | 14 | 9 | 7 | 5 | 71.42857% | 7.40416% | 12198.82 |
| 24 | True | 3 | 3 | 2 | 2 | 100.0% | 4.41255% | 11334.74 |

Status: no unseen OOS, no production approval, any positive result research only.
