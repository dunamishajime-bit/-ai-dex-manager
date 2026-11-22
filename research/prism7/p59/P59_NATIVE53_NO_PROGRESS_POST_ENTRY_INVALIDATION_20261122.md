# P59 Native53: early no-progress / wrong-direction invalidation

As-of state machine: at 6/12/24/36 hours after entry, did *any completed positive-volume M5 close* deliver 1% favorable? If NO, model early cover next bar open. Original STOP priority 1h guard. Also adverse1 first. Same original Native source53 signal/entry.

| Rule | fixed33 wins | fixed33 high DD | fixed33 NAV | Dynamic reslot wins / closed | DD high | NAV | Early exit | Zero volume cover |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| NATIVE_SOURCE_EXIT | 18 | 25.10029% | 14193.07 | 18/33 | 25.10029% | 14193.07 | 0 | 0 |
| NO_FAVORABLE1_6H | 11 | 13.5858% | 12446.78 | 11/37 | 16.23857% | 11097.81 | 20 | 8 |
| NO_FAVORABLE1_12H | 17 | 14.31752% | 14277.53 | 17/34 | 17.55119% | 13388.75 | 9 | 7 |
| NO_FAVORABLE1_24H | 16 | 21.71041% | 13346.44 | 16/33 | 21.71041% | 13346.44 | 6 | 4 |
| NO_FAVORABLE1_36H | 17 | 22.9749% | 14507.61 | 17/33 | 22.9749% | 14507.61 | 4 | 3 |
| NO_FAVORABLE2_12H | 15 | 15.3886% | 13114.96 | 16/35 | 17.55119% | 12679.69 | 14 | 10 |
| NO_FAVORABLE2_24H | 16 | 21.61098% | 12695.14 | 17/34 | 20.39085% | 13088.58 | 10 | 5 |
| ADVERSE1_FIRST | 10 | 15.12844% | 13451.87 | 12/40 | 16.34015% | 13149.26 | 22 | 9 |
| FAIL_FAST_12H_OR_ADVERSE1 | 10 | 15.12844% | 13451.87 | 12/40 | 16.34015% | 13149.26 | 22 | 9 |

Original source33 exact P44 baseline was 33 closed 18 wins DD25.10029 NAV14193.07. This research gate is not validated, no new Native source signal and no LIVE modifications.

