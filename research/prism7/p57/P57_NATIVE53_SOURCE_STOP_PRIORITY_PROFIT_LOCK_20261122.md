# P57 Native V20 original source53 entry preserved: M5 causal profit lock vs original STOP priority

Original source 53/53 entry/exit/30bps parity, 29 wins, 24 losses. First one-slot 33 filled proxy rows 18 wins, DD25.10029%, NAV14193.07 at gross0.75. Original native source STOP is not cancelled, early exits must predate source native exit.

| Mode | Lead guard H | Original33 fixed wins/closed | Fixed DD | Fixed NAV ¥ | Reslot wins/closed | Reslot DD | Reslot NAV ¥ | Early covers | Zero volume cover |
|---|---:|---|---:|---:|---|---:|---:|---:|---:|
| NATIVE_PINNED_REFERENCE | 0 | 18/33 | 25.10029% | 14193.07 | 18/33 | 25.10029% | 14193.07 | 0 | 0 |
| NATIVE_PINNED_REFERENCE | 1 | 18/33 | 25.10029% | 14193.07 | 18/33 | 25.10029% | 14193.07 | 0 | 0 |
| TP_1PCT_CONFIRMED_CLOSE | 0 | 26/33 | 22.71181% | 8411.96 | 38/49 | 29.21112% | 7389.05 | 38 | 12 |
| TP_1PCT_CONFIRMED_CLOSE | 1 | 26/33 | 22.71181% | 8411.96 | 38/49 | 29.21112% | 7389.05 | 38 | 12 |
| TP_2PCT_CONFIRMED_CLOSE | 0 | 25/33 | 19.47157% | 10109.42 | 37/49 | 19.28001% | 9569.19 | 36 | 10 |
| TP_2PCT_CONFIRMED_CLOSE | 1 | 25/33 | 19.47157% | 10109.42 | 37/49 | 19.28001% | 9569.19 | 36 | 10 |
| TP_3PCT_CONFIRMED_CLOSE | 0 | 24/33 | 17.80669% | 11043.31 | 32/45 | 18.50044% | 10600.23 | 30 | 5 |
| TP_3PCT_CONFIRMED_CLOSE | 1 | 24/33 | 17.80669% | 11043.31 | 32/45 | 18.50044% | 10600.23 | 30 | 5 |
| TP_5PCT_CONFIRMED_CLOSE | 0 | 20/33 | 22.86031% | 10444.29 | 24/41 | 22.86031% | 9800.9 | 21 | 4 |
| TP_5PCT_CONFIRMED_CLOSE | 1 | 20/33 | 22.86031% | 10444.29 | 24/41 | 22.86031% | 9800.9 | 21 | 4 |
| MFE1_GIVEBACK_HALF | 0 | 21/33 | 24.19869% | 9637.44 | 30/47 | 24.86438% | 8067.82 | 34 | 16 |
| MFE1_GIVEBACK_HALF | 1 | 21/33 | 24.19869% | 9637.44 | 30/47 | 24.86438% | 8067.82 | 34 | 16 |
| MFE3_GIVEBACK_HALF | 0 | 24/33 | 22.52287% | 10874.08 | 28/40 | 22.52287% | 9852.93 | 23 | 3 |
| MFE3_GIVEBACK_HALF | 1 | 24/33 | 22.52287% | 10874.08 | 28/40 | 22.52287% | 9852.93 | 23 | 3 |
| MFE3_GIVEBACK_TO1PCT | 0 | 22/33 | 24.12763% | 11468.39 | 22/36 | 24.12763% | 10075.26 | 15 | 6 |
| MFE3_GIVEBACK_TO1PCT | 1 | 22/33 | 24.12763% | 11468.39 | 22/36 | 24.12763% | 10075.26 | 15 | 6 |

The old and new source cases remain the same 53 original Native V20 entry signals; no extra early SHORT added. 1h priority guard is safer for H1 source stop ambiguity. No LIVE promotion or fresh OOS.
