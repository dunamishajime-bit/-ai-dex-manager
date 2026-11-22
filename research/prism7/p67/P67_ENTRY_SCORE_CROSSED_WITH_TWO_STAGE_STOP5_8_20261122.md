# P67 — Multi-timeframe W/D/12H/4H/1H Native entry score × STOP exit as-of

Factorial P66 causal score and P65 two-stage STOP5->8 source price replay, all original V20 natural source53 signal/entry preserved, max Gross1, 30bps, 0.75 original reference. No actual execution.

| Original entry size rule | Exit variant | Closed | Wins | DD M5 | NAV ¥ | Source winners skipped |
|---|---|---:|---:|---:|---:|---:|
| NATIVE_UNCHANGED_075 | SOURCE_PINNED_NATIVE | 33 | 18 | 25.100289% | 14193.07 | 0 |
| NATIVE_UNCHANGED_100 | SOURCE_PINNED_NATIVE | 33 | 18 | 32.113046% | 15557.46 | 0 |
| POINTS_LAX | SOURCE_PINNED_NATIVE | 28 | 17 | 13.712705% | 14935.33 | 2 |
| POINTS_LAX_WEEKLY_FAIL_CLOSED | SOURCE_PINNED_NATIVE | 27 | 17 | 13.712705% | 15581.98 | 2 |
| POINTS_NO_REJECT | SOURCE_PINNED_NATIVE | 33 | 18 | 17.688798% | 15028.53 | 0 |
| POINTS_STRICT | SOURCE_PINNED_NATIVE | 18 | 11 | 10.027512% | 14170.33 | 9 |
| NATIVE_UNCHANGED_075 | STANDING_STOP5_ALL | 34 | 18 | 21.245672% | 15401.23 | 0 |
| NATIVE_UNCHANGED_100 | STANDING_STOP5_ALL | 34 | 18 | 27.397234% | 17396.35 | 0 |
| POINTS_LAX | STANDING_STOP5_ALL | 29 | 17 | 15.005392% | 14889.26 | 2 |
| POINTS_LAX_WEEKLY_FAIL_CLOSED | STANDING_STOP5_ALL | 28 | 17 | 15.005392% | 15305.92 | 2 |
| POINTS_NO_REJECT | STANDING_STOP5_ALL | 34 | 18 | 16.653646% | 15212.37 | 0 |
| POINTS_STRICT | STANDING_STOP5_ALL | 19 | 11 | 13.470795% | 12469.44 | 9 |
| NATIVE_UNCHANGED_075 | TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24 | 33 | 18 | 21.245672% | 15411.77 | 0 |
| NATIVE_UNCHANGED_100 | TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24 | 33 | 18 | 27.397234% | 17409.86 | 0 |
| POINTS_LAX | TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24 | 28 | 17 | 15.005392% | 14899.45 | 2 |
| POINTS_LAX_WEEKLY_FAIL_CLOSED | TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24 | 27 | 17 | 15.005392% | 15316.4 | 2 |
| POINTS_NO_REJECT | TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24 | 33 | 18 | 16.653646% | 15096.22 | 0 |
| POINTS_STRICT | TWO_STAGE_STOP5_OR_HOLD8_BTC6_REL24 | 18 | 11 | 13.470795% | 13353.2 | 9 |

Check +100bps buy-cover stress and 10bps costs in accompanying JSON. All results from previously inspected source53. Actual 5/8 STOP implementation can be unsafe without protecting venue STOP orders; do not deploy based on this research alone.
