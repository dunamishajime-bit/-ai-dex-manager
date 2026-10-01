# V12 Win-Rate Redesign Final — 2026-10-02

Status: RESEARCH_COMPLETE_NOT_LIVE

## Problem
The first redesign improved integrated V12 win rate only from roughly 50.5% to 50.9%. That is not a meaningful win-rate redesign. LTC removal remains useful as a portfolio-capacity observation but is not the primary V12 quality solution.

## Root-cause decomposition
Formal selected V12: 991 trades / WR 50.45% / PF 2.157.
Major weak clusters:
- NEUTRAL: 170 / WR44.12 / PF0.833.
- NEUTRAL Rank1 LONG: 50 / WR38% / PF0.437 / large negative.
- NEUTRAL Rank2 LONG: 9 / WR11.1% / near-zero PF.
- DOGE: 100 / WR41% / PF0.388.
- LTC: 38 / WR39.47% / PF0.628.
- Trades failing within <=2h: 18 / PF0.035.
Entry-only filtering and a causal DEV-trained logistic quality model did not sustain >=55% in HOLD; HOLD remained around 49-50%. Therefore entry filtering alone is rejected as the main win-rate solution.

## Exact exit-model discovery
The frozen formal V12 H1 price-model was reproduced exactly: current Trail ATR 0.40 matched 991/991 formal V12 exit prices.
Only V12 trailing distance was changed. Entry signals, initial stop 2.477 ATR, TP 3.1995 ATR, max hold, rank rules, and portfolio rules stayed unchanged.

### Temporal folds, fixed same entries
Trail 0.40:
- DEV WR49.09 / VAL54.55 / HOLD48.04 / ALL50.55.
Trail 0.30:
- DEV53.94 / VAL59.70 / HOLD52.87 / ALL55.50.
Trail 0.25:
- DEV58.79 / VAL63.94 / HOLD56.19 / ALL59.64.
Trail 0.22:
- DEV60.91 / VAL67.88 / HOLD60.42 / ALL63.07.
Trail 0.20:
- DEV63.03 / VAL69.09 / HOLD61.33 / ALL64.48.
Trail 0.18 and 0.15 were also stronger, but they were examined after 0.20 had already been identified; keep 0.20 as the primary preregistered candidate rather than selecting the most favorable post-hoc value.

## Formal adopted integrated stack
Exact adopted stack: Q102 BRK0.75 / MR0.75 / FET1.0 + dual FET pre-entry gates, PENGU unchanged, same V52, same shared allocator.

10bps current Trail 0.40:
- Final JPY 141,845,207.72
- Closed trades 1,284
- Overall WR 55.14%
- PF 2.0772
- DD -22.873%
- V12 trades 991
- V12 WR 50.45%
- V12 PF 2.1572
- V12 PnL JPY 48,028,237

10bps Trail 0.20:
- Final JPY 647,179,340.66
- Closed trades 1,310
- Overall WR 66.18%
- PF 2.3804
- DD -21.415%
- V12 trades 1,018
- V12 WR 64.73%
- V12 PF 3.8454
- V12 PnL JPY 287,608,048

10bps delta:
- Final asset +JPY505.33M, ~4.56x current adopted final asset.
- V12 win rate +14.28 percentage points.
- Overall win rate +11.04 points.
- V12 PF +1.69.
- DD improves by ~1.46 percentage points.

8bps:
- Trail0.40 JPY175.06M / V12 WR50.96% / PF2.281 / DD-22.743%.
- Trail0.20 JPY803.66M / V12 WR65.91% / PF4.119 / DD-21.299%.
Same direction.

## Fresh unused OOS
Unused Aster H1 window: 2026-08-10 through 2026-10-01.
Current V12 code and exact 14-symbol universe were replayed on newly fetched data.
Trail 0.40: 171 trades / WR57.89% / PF3.22.
Trail 0.30: 171 / WR60.82% / PF4.34.
Trail 0.25: 171 / WR66.08% / PF6.63.
Trail 0.20: 172 / WR66.28% / PF8.56.
The effect persists outside the formal one-year sample and is not isolated to a single 0.20 point.

## Cost stress on adopted dual-gate stack
20bps:
- Trail0.40: final JPY49.99M / V12 WR45.66% / V12 PF1.674 / DD-23.52%.
- Trail0.20: final JPY220.66M / V12 WR57.69% / V12 PF2.785 / DD-22.08%.

30bps:
- Trail0.40: final JPY18.33M / V12 WR41.82% / V12 PF1.340 / DD-27.73%.
- Trail0.20: final JPY66.77M / V12 WR51.29% / V12 PF2.080 / DD-23.12%.

## Final research decision
Primary V12 redesign candidate: change trailing distance from 0.40 ATR to 0.20 ATR.
Do NOT adopt broad Q1-Q4 entry filters as the main redesign.
Do NOT treat LTC removal as the primary win-rate improvement; it remains a separate capacity optimization hypothesis.
Do NOT lower TP merely to manufacture higher win rate; TP3.1995 with Trail0.20 produced the best DEV-return candidate among the tested high-win-rate exit variants and preserved larger wins.
No LIVE or Production code was changed by this research.
