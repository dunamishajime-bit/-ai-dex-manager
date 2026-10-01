# Trail 0.20 + TOP3 integrated comparison — 2026-10-02

Status: RESEARCH_COMPLETE_NOT_LIVE

## Compared configurations
A. Trail 0.20 formal five-logic stack only.
B. A + NEAR-excluded TOP3:
- PENGU MOM + Relative + Break confirmation
- DOGE Relative + Volume
- DASH Momentum
C. A + PENGU-BRK TOP3:
- PENGU Breakout + Relative
- DOGE Relative + Volume
- DASH Momentum

TOP3 contract:
- enters only when all existing formal positions are flat;
- existing formal entries have priority;
- next formal entry preempts TOP3;
- max one TOP3 entry per JST day;
- 12h natural hold, 10% stop, 25% TP;
- causal features from completed H1 only;
- no NEAR in either B or C.

## 10bps integrated result
A:
- final JPY 647,158,808
- trades 1,310
- overall WR 66.18%
- PF 2.3804
- DD -21.36%
- entry-day coverage 310

B:
- final JPY 806,665,379
- delta vs A +JPY159,506,570 / +24.65%
- trades 1,377
- overall WR 65.58%
- PF 2.2747
- DD -22.94%
- TOP3 67 trades
- entry-day coverage 322

C:
- final JPY 729,906,895
- delta vs A +JPY82,748,087 / +12.79%
- trades 1,382
- overall WR 65.34%
- PF 2.2115
- DD -25.29%
- TOP3 72 trades
- entry-day coverage 325

Requested-three winner by final asset: B.
Risk-quality trade-off: B gives the largest endpoint but lowers PF and worsens DD. C is inferior to B and fails 30bps endpoint robustness.

## Cost sensitivity
8bps:
- A JPY803.64M
- B JPY1,015.26M (+26.33%)
- C JPY919.72M (+14.44%)

20bps:
- A JPY220.64M
- B JPY257.21M (+16.57%)
- C JPY231.38M (+4.87%)

30bps:
- A JPY66.76M
- B JPY72.81M (+9.06%)
- C JPY65.12M (-2.46%)

Only B beats A at every tested 8/10/20/30bps cost.

## Frozen route-level 10bps diagnostics
NEAR-excluded TOP3:
- DOGE_REL_VOL: 13 trades / WR69.23% / PF2.87 / positive raw net sum.
- P_MOM_REL_BREAK: 16 / WR50% / PF1.69.
- DASH_MOM: 38 / WR50% / PF1.15.

PENGU-BRK TOP3:
- DOGE_REL_VOL: 13 / WR69.23% / PF2.87.
- P_BRK_REL: 22 / WR40.91% / PF1.09.
- DASH_MOM: 37 / WR48.65% / PF1.11.

The PENGU BRK substitution is the main reason C underperforms B.

## High-quality subset diagnostic
DOGE Relative+Volume only was tested as a diagnostic because it is the strongest component of B.

10bps DOGE-only:
- final JPY706.86M (+9.22% vs A)
- overall WR66.21%
- PF2.3792, essentially unchanged from A
- DD -21.36%, identical to A
- overlay 13 trades / WR69.23% / PF3.01

20bps DOGE-only:
- final JPY237.54M vs A JPY220.64M
- DD unchanged from A
- overlay PF2.63

30bps DOGE-only:
- final JPY70.83M vs A JPY66.76M
- DD unchanged from A
- overlay PF2.24

Interpretation:
- B is the final-asset winner among the three requested configurations.
- DOGE-only is the cleanest high-quality extension if preserving PF/DD is prioritized.
- C should be rejected.
- No LIVE change was made.

## Reuse
Frozen TOP3 intents are stored beside this file.
Trail 0.20 formal fills are in ../10bps/portfolio-trades.jsonl and ../8bps/portfolio-trades.jsonl.
Use scripts/replay-v12-trail020-ledger-20261002.py to rebuild the Trail 0.20 strategy summary from fills.
