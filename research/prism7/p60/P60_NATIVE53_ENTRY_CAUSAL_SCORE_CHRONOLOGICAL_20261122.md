# P60: native V20 entry-time quality classifier, frozen source53, causal H1 features

Original Native source53 (29 wins,24 losses). Fixed 6 H1 pre-entry as-of features, L2 regularization and 72h after-EXIT train purge, 2 non-overlapping chronological test periods already previously inspected.

| Test period | Train | Test | Brier model | Baseline Brier | 0.50 gate wins/cases | 0.60 gate wins/cases | Hist P44 gate |
|---|---:|---:|---:|---:|---|---|---|
| 2026_JAN_TO_AUG | 26 | 13 | 0.31113 | 0.25 | 3/7 | 1/5 | 5/5 |
| 2026_SEP_TO_NOV | 39 | 14 | 0.28515 | 0.25411 | 5/11 | 0/2 | 5/5 |

Not independent untouched holdout; in-source source native entries not LIVE signed fills or full STOP parity. Use this to identify unstable early regime, not automatic new LIVE filter.
