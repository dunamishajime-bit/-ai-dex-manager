# V12 V4 D-tier Gross: individual & integrated Native8 validation, 2026-10-26

Status: RESEARCH_COMPLETE / LIVE_UNCHANGED / NOT_AN_ADOPTED_D_TIER_GROSS_POLICY.

## Comparability and reproduction
Source: 2026-10-08/09 V12 V4 V2_M150_D05_CORE_NATIVE archived H1 same-wallet 8-sleeve BT, 2025-08-10--2026-08-10. Shared Gross and admission/ownership limits and risk constraints retained. Current approved C tier 0.25x patch applied to all nine original C-tier Recovery routes (217 eligible inputs). For D-tier ONLY, 7 route IDs each swept independently from 0.05 to 0.10/0.15/0.20/0.25, with the 10bps/30bps economic studies separately re-run. Plus eight integrated portfolio combinations. 1 baseline + 28 route/gross + 8 combos = 37 cases / 74 integrated cost scenarios. All accounting PASS. 0.25x C-tier baseline reproduces exactly: 298,359,667.4222071 JPY @10bps and 185,858,224.75952727 JPY @30bps.

## Complete individual case changes in final portfolio equity
Numbers below are JPY 10,000 units above/below approved C0.25 D0.05 integrated baseline. Positive does NOT prove the D route itself is profitable.
| D route | Gross 0.10 (10bps/30bps) | Gross 0.15 (10bps/30bps) | Gross 0.20 (10bps/30bps) | Gross 0.25 (10bps/30bps) |
|---|---:|---:|---:|---:|
| CONT (CONT_SHORT_MID_AGE24_48) | +28.7/+23.2 | +55.6/+53.1 | +88.7/+69.5 | +130.8/+74.1 |
| G3 (REC_G3_LATE_BTC_REL) | +168.1/+72.5 | +252.2/+120.4 | +310.5/+162.9 | +223.7/+212.4 |
| X07 (REC_X07_TIME_6H) | -73.5/+9.0 | -139.8/-2.6 | -228.1/+7.8 | -236.2/-3.2 |
| X13 (REC_X13_TP1.5_SL1_H24) | +94.4/+96.2 | +190.9/+170.8 | +289.4/+232.8 | +390.2/+289.9 |
| X14 (REC_X14_TIME_48H) | -39.8/+92.1 | +637.2/+260.8 | +775.5/+812.1 | +1052.4/+466.2 |
| Y15 (REC_Y15_REV_D0_T3) | +41.8/+69.5 | +94.8/+130.6 | +81.7/+146.1 | +101.2/+166.3 |
| Y18 (REC_Y18_REV_D2_T18) | -189.9/-961.1 | -155.6/-976.1 | -216.0/-944.4 | -186.1/-1008.0 |

REC_X14 was loss-making as a sleeve at BOTH 10bps and 30bps, and increasing size enlarged its OWN loss. Apparent whole-portfolio improvement arose from changed execution sequence/capital competition/compounding and is not robust evidence of route alpha; 0.25x caused 30bps max DD -21.376%. REC_Y18, REC_X07 worsened the 10bps model at every tested larger Gross.

## Integrated combination results

| Gross combination | 10bps final asset JPY | 10bps DD | 10bps trades | 30bps final asset JPY | 30bps DD | 30bps trades |
|---|---:|---:|---:|---:|---:|---:|
| BASE_C025 | 298,359,667 | -20.482% | 1220 | 185,858,225 | -18.395% | 1217 |
| COMBO_G3_15_X13_15_CONT_15 | 303,244,151 | -20.378% | 1217 | 188,463,107 | -18.395% | 1214 |
| COMBO_G3_15_X13_15_CONT_15_X14_15 | 309,744,459 | -20.315% | 1221 | 189,449,798 | -21.339% | 1218 |
| COMBO_G3_20_X13_15_CONT_15 | 302,156,260 | -20.423% | 1219 | 193,186,961 | -18.349% | 1215 |
| COMBO_G3_20_X13_20_CONT_20 | 303,336,653 | -20.395% | 1219 | 188,258,310 | -21.296% | 1216 |
| COMBO_G3_20_X13_20_CONT_20_X14_15 | 309,737,709 | -20.335% | 1223 | 190,858,188 | -21.419% | 1218 |
| COMBO_G3_20_X13_25_CONT_20 | 306,384,779 | -20.307% | 1219 | 188,767,671 | -21.319% | 1216 |
| COMBO_G3_25_X13_15_CONT_15 | 304,799,546 | -20.340% | 1218 | 193,683,203 | -18.349% | 1217 |
| COMBO_G3_25_X13_25_CONT_25 | 307,285,598 | -20.285% | 1219 | 189,839,145 | -21.395% | 1217 |

## Research recommendation (NOT final LIVE authorization)

Keep previous S 0.60x, A 0.45x, B 0.30x, C Recovery 0.25x, native Core inherited, and all D routes at baseline 0.05x **except candidate research values**:
- REC_G3_LATE_BTC_REL: 0.25x
- REC_X13_TP1.5_SL1_H24: 0.15x
- CONT_SHORT_MID_AGE24_48: 0.15x

Above combined candidate: 10bps JPY 304,799,546 vs 298,359,667 (+JPY 6,439,878), max DD -20.340% vs -20.482%, closed trades 1,218 vs 1,220. 30bps JPY 193,683,203 vs 185,858,225 (+JPY 7,824,978), max DD -18.349% vs -18.395%, closed trades 1,217 both.

An independent second replay matched final equity, max DD, PF, WR, counts, and ledger SHA256 exactly for both cost settings, all model accounting PASS.

Do not raise remaining D routes without a new design and independent held-out/recent period proof. Specifically, REC_X14’s portfolio uplift is misleading because the route itself loses money. Larger synchronized sizes (three lanes at .20+ or adding X14) often cause 30bps drawdown to jump to ~21.3%-21.4%.

The full-year rank/size research has in-sample selection and same-period optimizations, which can substantially overestimate deployable performance. This study is not the current exact 2026-10-26 execution/margin/protection / broker signed fill simulation and does not include all latest exit modifications. Minimum-order and lot rounding must be rechecked against live Aster equity; no current position topup allowed by this study.

The V4 service was observed failed earlier today with V4_EVIDENCE_STALE:routeSourceParity. Its service recovery requires separate evidence and fail-closed compliance, not manual bypass. This D-tier research did not change live VPS, order sizing, pending exposure, STOPs, risk policy, or production SHA. No D Gross production code change was made.

## Reproducible sources

- scripts/research/v12_v4_d_tier_gross_sweep_20261026.py: 29 single-case reruns; set V12_V4_RESEARCH_SOURCE_ROOT, V12_V4_GROSS_POLICY_REPO, V12_V4_D_GROSS_OUTPUT_ROOT to the existing authorized research inputs and output destination.
- scripts/research/v12_v4_d_tier_gross_combinations_20261026.py: eight integrated combinations; requires same research input and case output.
- docs/research/results/v12-v4-d-tier-gross-20261026/V12_V4_D_TIER_GROSS_37_CASES_10_30BPS_20261026.json: per-case numeric metrics, detailed D route trade breakdown and SHA256 of 74 trade ledgers.

No automatic deploy. This is an economic research artifact for review / further live-parity certification.
