# Q102 / HYPE / IDLE reconstruction final V2 - 2026-11-14

Status: RESEARCH ONLY / NO PRODUCTION CHANGE

Period: 2025-10-01 00:00 UTC <= t < 2026-10-01 00:00 UTC
Initial capital: JPY 10,000
Exact STABLE3 source commit: b7133c209ad9e2f59b9b37d032bb1b3379258267

## Exact portfolio result

| Case | Cost | Final JPY | Max DD | Win rate | PF | Fills |
|---|---:|---:|---:|---:|---:|---:|
| STABLE3 | 10bps | 4,512,970 | -26.06% | 61.68% | 1.668 | 856 |
| STABLE3 | 30bps | 1,454,530 | -28.08% | 59.53% | 1.513 | 855 |
| PENGU_R3 | 10bps | 5,435,516 | -26.06% | 61.20% | 1.639 | 853 |
| PENGU_R3 | 30bps | 1,765,365 | -28.08% | 59.06% | 1.493 | 850 |
| HYPE_WAIT_CAUSAL_FRONTIER | 10bps | 9,819,827 | -25.56% | 63.79% | 2.064 | 787 |
| HYPE_WAIT_CAUSAL_FRONTIER | 30bps | 3,163,593 | -26.24% | 61.40% | 1.742 | 785 |
| FINAL_TTL60_HYPE_ACTIVE | 10bps | 10,600,407 | -25.56% | 63.73% | 2.053 | 794 |
| FINAL_TTL60_HYPE_ACTIVE | 30bps | 3,807,597 | -26.24% | 61.57% | 1.855 | 791 |

## Final selected result
- 10bps: JPY 10,600,407, DD -25.56%, WR 63.73%, PF 2.053.
- 30bps: JPY 3,807,597, DD -26.24%, WR 61.57%, PF 1.855.
- Versus HYPE WAIT: +JPY 780,580 at 10bps and +JPY 644,004 at 30bps, with unchanged max DD.

## Q102
Old AVAX MR24 and UNI MR72 remain quarantined. New AVAX uses causal online KNN (k=40, unweighted, pred >= 0.013, agreement >= 0.65), 0.75x, M5 STOP5 + TP3 + 24h time. UNI remains WAIT because no robust new candidate survived.

## HYPE
HYPE is no longer blanket WAIT. Final research candidate remains 1.0x LONG and uses causal consensus entry plus shadow online health.
- TRAIN discovers simple rules; VALID retains/ranks; top 10 vote >=50%; PREHOLD must pass. Target/forward are not used for selection.
- Online health uses the last 2 completed shadow HYPE candidates: mean >= -1%, win rate >=34%, loss streak <=1.
- Health expires after 60 days without a qualifying HYPE candidate. 45/60/90-day sensitivity produces the same target/forward candidate set.
- Exit is 48h time unless a formal-priority runner preempts it.
- Exact 30bps HYPE normalized return: n=7, WR=57.1%, summed normalized return=7.42%, mean=1.06%/trade.

## IDLE
Gross remains 1.0x. RENDER waits because pretarget robust support is absent. TAO is retained as a native-12h risk-off sensor only. DOT/JUP/TIA retain the lower-density legacy routes. The JUP/TIA online variant was rejected because exact portfolio capacity interaction suppressed higher-expectancy runners.

## Robustness
All 12 full target months are positive at both 10bps and 30bps. October 2026 is the end-exclusive boundary with no fills.
Max DD remains concentrated around late-February to early-March 2026 and is dominated by V52/V4 overlap plus one Q102 AVAX STOP5. HYPE TTL60 does not worsen max DD.

## Anti-overfit controls
H48R20 and other holdout-selected HYPE variants remain diagnostics only. HYPE STOP4/5/6 variants worsened exact Shared Risk/DD. TTL sensitivity is invariant across 45/60/90 days. No target-year or forward result is used to choose the selected HYPE consensus/online-health parameters.

## Reproduction
The STABLE3 replay ledger is included under STABLE3_REPRO_REFERENCE. The final wrapper, candidate ledgers, run manifests, robustness report, selected fills/shared-risk audits, and SHA256 list are included.

## Safety
No Production runner, order, position, STOP, Kill Switch, Production config, merge, or deployment was changed.
