# Q102 profit protection and initial-adverse losses (2026-10-22)

Research only; V4 4 approved rules frozen for ALL tests. No LIVE / Production / venue order changes.

Sample: 2025-08-10 through 2026-08-10, initial JPY 10,000, no deposits, eight-logic native chronological allocator, 10bps real-like and 30bps stress.

| V4 fixed baseline | 10bps | 30bps |
|---|---:|---:|
| Final equity JPY | 191,750,055 | 74,740,268 |
| MTM max DD | -14.6033% | -15.7782% |
| PF | 3.1750 | 2.5811 |

## Existing Q102 exit reasons in the accepted 10bps ledger

| Reason | trades | winners | losers | Loss sum JPY |
|---|---:|---:|---:|---:|
| Q102_TIME_EXIT | 87 | 57 | 30 | -9,903,667 |
| 5M_PROTECTIVE_STOP | 70 | 70 | 0 | 0 |
| Q102_HARD_STOP | 10 | 0 | 10 | -4,956,407 |
| TIME_EXIT | 9 | 7 | 2 | -231,202 |
| Q102_TRAIL_5_AFTER_12 | 3 | 3 | 0 | 0 |
| FLOOR_combined_no_residual | 2 | 2 | 0 | 0 |
| STOP | 1 | 0 | 1 | -795,707 |

Existing +2% CONFIRMED M5 close -> +0.5% entry-relative protective STOP already appeared in the research baseline and 70 accepted 5M_PROTECTIVE_STOP exits, all wins. Re-applying it as a new overlay is not an incremental improvement.

Q102_TIME_EXIT includes 30 losing trades totaling about -9.90m JPY (10bps) and 57 winners. HIGH_VOL_TRAIL72 large 72h adverse excursions warrant pre-profit-arm risk caps; live venue stop behavior remains unverified.

## Q102 loss path by Family/Side (10bps, no data gaps across 182 accepted Q102 5m paths)

| Family / Side | Trades | Losses | Total loser JPY | median loser MFE | median loser MAE |
|---|---:|---:|---:|---:|---:|
| MR/SHORT | 49 | 14 | -5,164,587 | 1.22% | 4.57% |
| HIGH_VOL/LONG | 6 | 1 | -2,322,300 | 1.38% | 10.05% |
| REV/SHORT | 57 | 14 | -2,168,184 | 1.01% | 2.68% |
| REV/LONG | 8 | 4 | -1,731,959 | 0.88% | 5.18% |
| HIGH_VOL/SHORT | 26 | 1 | -1,500,405 | 1.26% | 6.65% |
| PB/LONG | 12 | 4 | -1,430,911 | 0.83% | 3.72% |
| PB/SHORT | 11 | 2 | -1,033,070 | 1.19% | 4.52% |
| BRK/LONG | 9 | 2 | -533,701 | 0.66% | 6.21% |
| BRK/SHORT | 4 | 1 | -1,866 | 1.09% | 8.63% |

## Full 8-logic economics with frozen V4 (original accepted Short 12h cooldown recalculated to fixed point)

| Candidate | Final JPY 10bps | DD 10bps | Final JPY 30bps | DD 30bps | New Q102 exits (10/30bps) |
|---|---:|---:|---:|---:|---:|
| Q102_PB_LONG_INIT1P5_3H_MFE0P5 | 194,790,628 | -14.6033% | 82,651,843 | -15.7782% | 2/2 |
| Q102_PROFIT_ARM3_FLOOR1 | 192,313,629 | -14.3599% | 72,039,764 | -15.8230% | 33/33 |
| Q102_PROFIT_ARM5_FLOOR2 | 190,597,242 | -14.6033% | 71,191,774 | -15.7782% | 12/12 |
| Q102_FAMILY_PREARM3H_CAPPED6 | 185,410,042 | -15.3188% | 64,300,481 | -16.1509% | 21/21 |
| Q102_MR_SHORT_PREARM4P0_H3 | 188,287,997 | -15.3188% | 67,459,706 | -16.1509% | 10/10 |
| Q102_HV_LONG_PREARM3P0_H3 | 190,396,120 | -14.6033% | 73,745,954 | -15.7782% | 2/2 |
| Q102_MR_SHORT_PROFIT3_FLOOR1 | 189,309,687 | -14.3684% | 72,031,171 | -15.8001% | 8/8 |
| Q102_HIGH_VOL_SHORT_PROFIT3_FLOOR1 | 192,412,075 | -14.6033% | 75,063,858 | -15.7538% | 7/7 |
| Q102_PB3H_LOSS_PLUS_Q102_PROFIT3_TO1 | 195,323,811 | -14.3599% | 79,716,312 | -15.8230% | 35/35 |

## Most promising two-axis candidate, not yet formally adopted

- Keep existing Q102 confirmed M5 close +2% -> resident-like entry +0.5% profit protection.
- Research addition 1: PB LONG ONLY, after 3h and prior peak favorable movement below +0.5%, adverse movement reaches -1.5% => early reduce-only exit candidate.
- Research addition 2: after a confirmed M5 close reaches +3% favorable gain, upgrade desired resident-like protection from entry +0.5% to entry +1% for Q102, with safe readback before retiring the prior stop.
- Combined historical 10bps JPY 195,323,811 / DD -14.3599% versus V4 fixed baseline JPY 191,750,055 / DD -14.6033%.
- Combined historical 30bps JPY 79,716,312 / DD -15.8230% versus V4 fixed baseline JPY 74,740,268 / DD -15.7782%.
- Both costs compound ending equity increases; 10bps DD improves +0.2434pp. Stress 30bps DD worsens -0.0449pp, so this FAILS strict dual-cost DD improvement. Do not quietly authorize LIVE.
- Family-scoped HIGH_VOL SHORT +3% -> +1% profit upgrade is a conservative alternate: both costs equity increase and 30bps DD improves slightly, while 10bps DD is unchanged.
- PB-only -1.5% after3h is also a worthwhile small-sample candidate: original 2 losses early, no original winners caught, but portfolio DD unchanged. Requires unused holdout/forward validation.
- MR SHORT -4% after3h, HIGH_VOL LONG -3% after3h, and the whole six-family prearm bundle do NOT improve the integrated DD; reject regardless of isolated losers rescued.

## Interpretation and safety

- Per-accepted-trade loser/winner selection alone is misleading: early exits free gross, trigger different downstream trade admissions and may WORSEN whole-portfolio MTM DD.
- Q102 current +2% close arm / +0.5% stop is a resident-like 5m price-model condition, not proof the feature is enabled or authenticated on the real Production venue.
- Supplemental +3% close -> +1% and +5% close -> +2% are staged upgrades to the existing +0.5% floor, not replacements of the resident initial protection. Actual fill can slip below floor.
- MR SHORT, HIGH_VOL LONG and PB LONG initial early-stop gates are family- and side-specific research choices. Single-trade samples, especially six annual HIGH_VOL LONG positions, are too small for a production rule without independent untouched holdout/forward shadow.
- The current model records upgraded Q102 stepped exits with a generic ARM2_FLOOR0P5 research label; use the case policy metadata to identify real stage. Rename and recertify venue/exit ledgers before actual implementation.
- No new Q102 option is adopted from these tests. V4 adopted four conditions remain immutable. Independent current Task9 TypeScript economic parity and signed-exchange STOP lifecycle still unproved.

Reproducible scripts in scripts/dd-reduction (source hashes in JSON). Local PC contains full decisions, trades, events and MTM ledgers. GitHub stores compact reproducible source and summaries.
