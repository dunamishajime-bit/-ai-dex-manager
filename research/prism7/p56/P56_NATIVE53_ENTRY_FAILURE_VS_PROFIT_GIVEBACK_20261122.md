# P56 Native V20 53: classify wrong direction vs profit given back

All 53 pinned-source entry/exits verified, 29 wins and 24 losses. Loss family labels are POST-entry DIAGNOSTICS only.

| Outcome family | Cases | Stops | Median favorable M5 CLOSE % | PRE/BASE/POST |
|---|---:|---|---:|---|
| WIN_ORIGINAL_NATIVE_EXIT | 29 | {'SHORT_V20_DEADLINE_EXIT': 2, 'SHORT_TRAILING_STOP': 9, 'SHORT_MAX_HOLD': 18} | 10.24398% | {'PRE_2025_AUG_SEP': 2, 'BASE_2025_2026': 24, 'POST_2026_OCT_NOV': 3} |
| LOSS_NEVER_CONFIRMED_1PCT | 12 | {'SHORT_HARD_STOP': 10, 'SHORT_MAX_HOLD': 2} | 0.13713% | {'PRE_2025_AUG_SEP': 2, 'BASE_2025_2026': 8, 'POST_2026_OCT_NOV': 2} |
| LOSS_CONFIRMED_1_TO_LT3PCT | 5 | {'SHORT_HARD_STOP': 2, 'SHORT_MAX_HOLD': 3} | 2.19577% | {'BASE_2025_2026': 4, 'POST_2026_OCT_NOV': 1} |
| LOSS_CONFIRMED_3PCT_OR_MORE_GIVEN_BACK | 7 | {'SHORT_MAX_HOLD': 5, 'SHORT_HARD_STOP': 2} | 4.18777% | {'PRE_2025_AUG_SEP': 2, 'BASE_2025_2026': 4, 'POST_2026_OCT_NOV': 1} |

| Original as-of entry feature | Keep | Winner kept | Loser kept | Winner dropped | Never-favorable losers kept |
|---|---:|---:|---:|---:|---:|
| BTC6_NONPOS | 21 | 11 | 10 | 18 | 5 |
| PENGU_RELWEAK6 | 33 | 19 | 14 | 10 | 6 |
| M5_PRE_MICRO_DOWNTREND | 45 | 23 | 22 | 6 | 10 |
| M5_TAKER_SELLER60 | 34 | 17 | 17 | 12 | 8 |
| M5_TAKER_SELLER30 | 34 | 18 | 16 | 11 | 9 |
| M5_BELOW_VWAP | 28 | 13 | 15 | 16 | 7 |
| NATIVE48_D3_ALL3 | 21 | 19 | 2 | 10 | 1 |

M5 feature signal missing 6/53 with 5 winners: blanket entry veto would remove those wins. P44 D3-all3 retains 19/29 original winners and 2/24 losers historically, not independent evidence. New objective: fix loss types without optimizing away winners.
