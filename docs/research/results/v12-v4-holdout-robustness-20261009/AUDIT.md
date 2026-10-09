# V12 V4 — forward robustness / route-risk audit (2026-10-09)

**RESEARCH ONLY; production deployment BLOCKED. No runner, HP, Gross or LIVE changes.**

Input: Aug 11–Oct 4, 2026 H1 route-only external replay, frozen V4 rules.
**Parity PASS**: 274 trades, 10/20/30bps, total plus 23 per-route results agree with source manifest.
Costs are modeled round-trip basis points off entry notional; not exchange-fills or a full-portfolio replay.

## Development training vs separate external route study
| Route | Train n | Train PF (30bps) | External n | 10bps WR | 10bps PF | 30bps PF | Flag |
|---|---:|---:|---:|---:|---:|---:|---|
| REC_Y06_REV_D0_T72 | 148 | 2.43 | 102 | 37.3% | 0.30 | 0.27 | NEGATIVE_EXTERNAL |
| REC_X09_TIME_48H | 8 | 0.43 | 32 | 50.0% | 3.09 | 2.78 | INSUFFICIENT_TRAIN |
| REC_X14_TIME_48H | 2 | 999.00 | 29 | 65.5% | 3.66 | 3.34 | INSUFFICIENT_TRAIN |
| REC_Y01_REV_D0_T72 | 12 | 999.00 | 16 | 12.5% | 0.04 | 0.03 | NEGATIVE_EXTERNAL |
| REC_Y03_REV_D0_T36 | 14 | 7.97 | 16 | 43.8% | 0.30 | 0.26 | NEGATIVE_EXTERNAL |
| REC_X10_TIME_48H | 11 | 7.36 | 14 | 50.0% | 1.80 | 1.64 | INSUFFICIENT_TRAIN |
| REC_Y09_REV_D2_T24 | 10 | 4803.30 | 14 | 28.6% | 0.04 | 0.02 | NEGATIVE_EXTERNAL |
| REC_Y07_REV_D0_T72 | 9 | 999.00 | 12 | 25.0% | 0.25 | 0.23 | NEGATIVE_EXTERNAL |
| REC_X03_TIME_12H | 21 | 2.18 | 8 | 25.0% | 0.16 | 0.05 | NEEDS_UNSEEN_FORWARD |
| FAILED_BREAK_REV_SHORT_6H | 25 | 1.49 | 7 | 71.4% | 1.94 | 1.08 | NEEDS_UNSEEN_FORWARD |
| REC_G2_EARLY_BTC_OPPOSE_VOL | 34 | 1.84 | 4 | 0.0% | 0.00 | 0.00 | NEEDS_UNSEEN_FORWARD |
| REC_G3_LATE_BTC_REL | 27 | 2.25 | 3 | 33.3% | 1.57 | 0.51 | NEEDS_UNSEEN_FORWARD |
| REC_X06_TIME_12H | 30 | 1.97 | 3 | 33.3% | 0.66 | 0.45 | NEEDS_UNSEEN_FORWARD |
| CONT_SHORT_MID_AGE24_48 | 13 | 3.25 | 2 | 50.0% | 0.49 | 0.23 | INSUFFICIENT_TRAIN |
| REC_G5_SLOW_TREND | 23 | 1.94 | 2 | 100.0% | n/a | n/a | NEEDS_UNSEEN_FORWARD |
| REC_X07_TIME_6H | 13 | 0.70 | 2 | 0.0% | 0.00 | 0.00 | INSUFFICIENT_TRAIN |
| REC_Y08_REV_D0_T6 | 12 | 10.61 | 2 | 50.0% | 0.54 | 0.31 | INSUFFICIENT_TRAIN |
| REC_G1_MID_REL_LOWVOL | 7 | 1.84 | 1 | 0.0% | 0.00 | 0.00 | INSUFFICIENT_TRAIN |
| REC_G4_MATURE_REL_RANGE | 9 | 4.37 | 1 | 0.0% | 0.00 | 0.00 | INSUFFICIENT_TRAIN |
| REC_X01_TIME_24H | 14 | 999.00 | 1 | 0.0% | 0.00 | 0.00 | INSUFFICIENT_TRAIN |
| REC_X02_TIME_36H | 25 | 0.65 | 1 | 100.0% | n/a | n/a | WEAK_TRAIN |
| REC_X05_TIME_36H | 25 | 3.00 | 1 | 100.0% | n/a | n/a | NEEDS_UNSEEN_FORWARD |
| REC_Y12_REV_D0_T24 | 9 | 10618.73 | 1 | 100.0% | n/a | 0.00 | INSUFFICIENT_TRAIN |

Flags are diagnostic; they are NOT a newly optimized priority ranking.
X09: train PF30 below 1 despite external PF above 3; X14: only 2 train examples.
X10: 11 train and 14 external samples, insufficient for larger risk.

## Y06 by month — 10bps external, route-only
Total 102 route trades on 19 entry days; longest event-sequence losing streak 28.
| UTC month | Trades | WR | PF | Mean net/notional |
|---|---:|---:|---:|---:|
| 2026-08 | 37 | 45.9% | 0.49 | -2.27% |
| 2026-09 | 60 | 26.7% | 0.14 | -3.92% |
| 2026-10 | 5 | 100.0% | n/a | 2.50% |

Descriptive UTC-day block bootstrap 95% mean interval: -5.74% to -0.26% per notional.
This is NOT a prospective confidence guarantee, trade-day independence is unproven.

## Y06 by symbol — purely descriptive; no hindsight veto
| Symbol | n | 10bps WR | PF | Mean net/notional |
|---|---:|---:|---:|---:|
| SOLUSDT | 13 | 30.8% | 0.22 | -2.86% |
| AAVEUSDT | 12 | 58.3% | 1.52 | 0.52% |
| INJUSDT | 12 | 58.3% | 1.15 | 0.36% |
| ADAUSDT | 11 | 36.4% | 0.16 | -2.69% |
| DOGEUSDT | 9 | 66.7% | 0.89 | -0.35% |
| AVAXUSDT | 8 | 37.5% | 0.10 | -8.29% |
| NEARUSDT | 8 | 0.0% | 0.00 | -8.04% |
| XRPUSDT | 8 | 25.0% | 0.05 | -7.98% |
| ATOMUSDT | 6 | 50.0% | 1.40 | 0.98% |
| LTCUSDT | 6 | 16.7% | 0.12 | -6.31% |
| BNBUSDT | 5 | 0.0% | 0.00 | -1.46% |
| ETHUSDT | 2 | 50.0% | 0.33 | -0.61% |
| LINKUSDT | 2 | 0.0% | 0.00 | -6.37% |

## Decision / next mandatory verification
1. BLOCK Y06 priority and Gross increase: August and September external route-edge are negative.
2. Neither strong-looking external X09 nor X14 is allowed to replace Y06 in LIVE based on this study.
3. Keep current live unchanged. Treat Y06 no-new-entry as a research/shadow hypothesis only.
4. Freeze any new causal rules BEFORE collecting genuinely new forward samples; no posthoc symbol/BTC filters.
5. Build external H1 portfolio replay with PENGU/Q102/FET/V52/HYPE/IDLE, venue quantities, funding, actual ownership, Gross reservations and daily DD governor.
6. Recheck full monthly and 10/20/30bps portfolio MTM DD <=20% under independent time/regime evidence before proposing activation.
7. Preserve original 170 vs 115 Y06 fill-level ledgers, and leave original repo and every LIVE runner alone.

Machine-readable evidence: audit.json
