# PRISM VII P47-P49 | true first PENGU downleg: negative evidence checkpoint

**Research gate: NOT ACCEPTED.** Full Native source V20 remains unchanged. No code path, action, Runner or LIVE orders were modified.

## What was actually learned
1. An early H1 lower-low and <=-1% bearish-candle short without prior bearish state had 56/97 wins, 57.73% and M5 DD 41.12%.
2. Looking for three bearish conditions from six H1 before the break produced 13/18 wins (72.22%) and M5 DD 12.13%, but **11 of these 18 had already seen a >=3% 24h fall before the proposed pre-arm!** The model was substantially an existing-downtrend/rebound signal.
3. When pre-arm was truly before 24h -3%, 4/7 wins (57.14%). Removing an earlier structural H1 break reduced to 3/6 wins (50%). This sample is too small to infer edge.
4. P49 used 107 strict-first prearm-clean candidates, a six-predictor fixed L2 logistic ranking and 72h training-target purges. The 3 chronological already-viewed windows all had *worse* Brier score than constant training base-rate.
5. These data do not support preauthorizing first-drop shorts. Layer A pre-alert vs Layer B confirmation must remain observational, do not activate new trades.

## Verifiable results

| Model | Closed | Wins | Win rate | 0.75x M5 DD |
|---|---:|---:|---:|---:|
| First H1 >=1% bearish drop, no arm | 97 | 56 | 57.73% | 41.12% |
| Layer A H1 -6 all3, including postdrop | 18 | 13 | 72.22% | 12.13% |
| Layer A H1 -6, no prior D3 drop | 7 | 4 | 57.14% | 11.44% |
| Same, no prior large H1 structural break | 6 | 3 | 50.00% | 11.44% |

## P49 chronological falsification

| Test months 2026 | Train | N clean first-break candidates | Logit score>=0.50 wins/closed | Brier model | Baseline Brier |
|---|---:|---:|---:|---:|---:|
| MAR_TO_MAY | 46 | 18 | 1/3 | 0.28653 | 0.24223 |
| JUN_TO_AUG | 63 | 17 | 0/3 | 0.26092 | 0.2449 |
| SEP_TO_NOV | 77 | 24 | 1/1 | 0.31177 | 0.28108 |

The split is chronological with 72h label purge but not an untouched holdout: earlier research saw all months. Each monthly fold starts flat for the single-slot study; real account position state not reconstructed.

## Future research separate by cause
- Native V20 rebound SHORT: test context quality + exiting profit giveback, strict source parity and unseen feeds
- Genuine first-drop anticipation: acquire independent order-flow or new market context data; current 6-feature H1 scheme failed falsification
- Stop/entry invariants and full cross-runner DD must be certified independently before any possible LIVE decision.

**All source paths, fixed thresholds, SHA, full scenario stats and per-trade ledgers are retained locally and in GitHub research branch. No production action.**
