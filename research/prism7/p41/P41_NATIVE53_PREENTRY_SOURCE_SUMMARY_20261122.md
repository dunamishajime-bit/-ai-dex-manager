# P41 | Native SHORT V20 24 losers: was the short entry late?

**Source-native H1 engine signal parity: 53/53**; 24 losers and 29 winners are frozen. 0.75x accounting only, no trading actions.

24h realized decline BEFORE the native entry is a descriptive metric, NOT proof an earlier actual short could have fired.

| 24 original losers | Count |
|---|---:|
| Prior 24h open-to-native-entry short move >=1% | 24 |
| Prior 24h open-to-native-entry short move >=3% | 24 |
| Prior 24h peak-to-later-close trough >=3% | 24 |
| Prior 48h earlier **full native short signal** existed | 8 |
| Earlier first impulse (>=7% prior24h decline) + hypothetical net >=1% to native entry | 11 |
| Earlier armed-setup + hypothetical net >=1% to native entry | 6 |
| Prior 48h earlier full native short signal + >=1% favorable H1 low | 7 |
| Prior 48h earlier full native short signal + net at actual entry >0 with 30bps | 7 |

## The 12 losses that never secured a 1% favorable M5 close

| Sub-question | Count |
|---|---:|
| Earlier prior24h open-to-entry price decline >=1% | 12 |
| Prior24h peak-to-later-trough down >=3% | 12 |
| Earlier full source-native SHORT signal within 48h | 4 |
| Earlier first impulse -> hypothetical net >=1% until native entry | 6 |
| Earlier armed setup -> hypothetical net >=1% until native entry | 2 |
| Earlier full source-native SHORT signal then price fell >=1% before actual entry | 3 |

## Breakdown by original native loss family
- LOSS_NEVER_CONFIRMED_1PCT: 12 loss(es); prior24 >=3% decline=12; earlier native signal in 48h=4
- LOSS_CONFIRMED_3PCT_OR_MORE_GIVEN_BACK: 7 loss(es); prior24 >=3% decline=7; earlier native signal in 48h=1
- LOSS_CONFIRMED_1_TO_LT3PCT: 5 loss(es); prior24 >=3% decline=5; earlier native signal in 48h=3

Interpretation: prior declines without an earlier complete native signal show delayed structural entry **by design**, not a missed executable native entry. Earlier full native signal alone is insufficient without single-slot occupancy and native STOP/exit replay.

Input source SHA and all 53 per-entry ledgers are in the JSON output. Production untouched.
