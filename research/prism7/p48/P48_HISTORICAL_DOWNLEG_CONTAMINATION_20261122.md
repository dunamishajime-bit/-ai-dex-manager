# P48: six-hour pre-arm was already a rebound-after-drop?

P47 BASE was 13/18 win, 12.13% M5 DD (source proxy). However 11/18 were already down >=3% in the previous 24h at the pre-arm observation.

| Rule | Eligible | Single slot closed | Wins | Win rate | DD high | NAV yen |
|---|---:|---:|---:|---:|---:|---:|
| P47_PREARM6_ORIGINAL | 21 | 18 | 13 | 72.22222% | 12.13258% | 16700.59 |
| PREARM6_CLEAN_NOT_YET_MINUS3 | 9 | 7 | 4 | 57.14286% | 11.43516% | 10561.68 |
| PREARM6_CLEAN_NO_FIVE_H1_DROP | 9 | 7 | 4 | 57.14286% | 11.43516% | 10561.68 |
| PREARM6_CLEAN_NO_EARLIER_STRUCTURAL_BREAK | 8 | 6 | 3 | 50.0% | 11.43516% | 10560.05 |
| PREARM6_CLEAN_PRE_H1_SELLER_CONFIRM | 3 | 2 | 2 | 100.0% | 8.64514% | 10785.09 |
| PREARM6_CLEAN_PREARM3_PERSISTENCE | 5 | 5 | 2 | 40.0% | 11.35763% | 10453.53 |

As-of pre-arm6 may already be after a drawdown: do not call the P47 72% a clean first-leg winrate. With post-drop excluded, proof sample shrinks and robustness must be separately evaluated.
