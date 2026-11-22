# P49 pre-onset causal prediction check, full strict-first H1 source (6h prior)

107 strict clean first-onset candidates. Fixed 6 numerical predictors from six full H1 bars before Layer B. No post-entry price in eligibility. Train label embargo 72h and 3 chronological test windows.

| Fold | Model | n candidate | n closed | n won | Win rate | DD high | NAV | 100bps stress win |
|---|---|---:|---:|---:|---:|---:|---:|
| 2026_MAR_TO_MAY | BASE_ALL_CLEAN | 18 | 13 | 5 | 38.46154% | 32.33701% | 8145.51 | 30.76923% |
| 2026_MAR_TO_MAY | FIXED_PREARM6_BEAR_ALL3 | 0 | 0 | 0 | None% | 0.0% | 10000.0 | None% |
| 2026_MAR_TO_MAY | LOGIT_L2_THRESHOLD_0P50 | 4 | 3 | 1 | 33.33333% | 9.71089% | 10162.73 | 33.33333% |
| 2026_MAR_TO_MAY | LOGIT_L2_THRESHOLD_0P60 | 2 | 2 | 0 | 0.0% | 8.176% | 9245.34 | 0.0% |
| 2026_JUN_TO_AUG | BASE_ALL_CLEAN | 17 | 10 | 4 | 40.0% | 17.98233% | 8944.38 | 30.0% |
| 2026_JUN_TO_AUG | FIXED_PREARM6_BEAR_ALL3 | 2 | 1 | 1 | 100.0% | 3.17206% | 10347.46 | 100.0% |
| 2026_JUN_TO_AUG | LOGIT_L2_THRESHOLD_0P50 | 3 | 3 | 0 | 0.0% | 12.46336% | 8985.52 | 0.0% |
| 2026_JUN_TO_AUG | LOGIT_L2_THRESHOLD_0P60 | 2 | 2 | 0 | 0.0% | 10.55872% | 9181.03 | 0.0% |
| 2026_SEP_TO_NOV | BASE_ALL_CLEAN | 24 | 15 | 11 | 73.33333% | 14.71688% | 15416.36 | 73.33333% |
| 2026_SEP_TO_NOV | FIXED_PREARM6_BEAR_ALL3 | 5 | 4 | 2 | 50.0% | 11.43516% | 10304.22 | 50.0% |
| 2026_SEP_TO_NOV | LOGIT_L2_THRESHOLD_0P50 | 1 | 1 | 1 | 100.0% | 4.27774% | 10730.66 | 100.0% |
| 2026_SEP_TO_NOV | LOGIT_L2_THRESHOLD_0P60 | 0 | 0 | 0 | None% | 0.0% | 10000.0 | None% |

No untouched blind OOS. Model performance must be rejected for deployment regardless of good in-sample/chronological subsections without independently sourced future periods.
