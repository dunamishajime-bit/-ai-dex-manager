# P50: Which strict-before-first-drop H1 characteristics survive multiple-comparison controls?

Pre-event 6 features, 107 strict first-break signals, P20 research stop72 wins/losses. All dates previously inspected; no true unseen OOS.

| Feature | All-sample AUC | Familywise month-shift null p | PRE AUC | BASE AUC | POST AUC | Training coefficient signs |
|---|---:|---:|---:|---:|---:|---|
| btc24 | 0.52863 | 0.998 | 0.52 | 0.53406 | 0.60606 | 1,1,1 |
| rel24 | 0.51922 | 1.0 | 0.56 | 0.47059 | 0.72727 | -1,-1,-1 |
| ema72_168 | 0.51569 | 1.0 | 0.76 | 0.48762 | 0.60606 | 1,-1,-1 |
| sellerShare6 | 0.51608 | 1.0 | 0.6 | 0.54721 | 0.36364 | 1,1,1 |
| lowerHighShare6 | 0.49804 | 1.0 | 0.45 | 0.49768 | 0.51515 | 1,1,-1 |
| pCloseVsEMA72 | 0.55569 | 0.82435 | 0.54 | 0.52864 | 0.87879 | 1,1,1 |

**Familywise passing features**: []. No new trading rule inferred. Recheck on untouched future data.
