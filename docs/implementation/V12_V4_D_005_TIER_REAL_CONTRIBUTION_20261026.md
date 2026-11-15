# D tier 0.05x: realized trading profit and full-wallet contribution

Status: RESEARCH ONLY, NO LIVE CHANGE. Frozen 2026-10-09 eight-sleeve V4 historical H1 source; 2025-08-10 through 2026-08-10; C Recovery 0.25x, D all 0.05x. Costs: 10bps and 30bps.

Two complementary measurements:
- Direct D PnL is the sum of the ledger field modeled_realized_pnl_jpy_at_exit_fx, converted to yen using each trade's FX rate. The raw field total_pnl_jpy contains USD-settlement model numbers: DO NOT report these raw numbers as JPY.
- Portfolio marginal effect is from an 8-sleeve counterfactual in which all D routes are disabled, with all other portfolio routes and capital gates unchanged. This measures the difference of final asset values, including downstream equity compounding and opportunity costs.

## Summary

| Statistic | 10bps | 30bps |
|---|---:|---:|
| Final asset with D | 298,359,667 | 185,858,225 |
| Final asset with all D removed | 291,319,290 | 171,504,728 |
| 8-sleeve final-asset D contribution | 7,040,377 | 14,353,497 |
| Direct D trade net realized PnL JPY | 1,149,890 | 384,807 |
| Total closed trades with D | 1,220 | 1,217 |
| D closed trades | 114 | 116 |

## Direct D route trade profit (JPY converted per exit)

| Route | 10bps trades | 10bps net JPY | 30bps trades | 30bps net JPY |
|---|---:|---:|---:|---:|
| CONT_SHORT_MID_AGE24_48 | 14 | 38,675 | 15 | 46,516 |
| REC_G3_LATE_BTC_REL | 38 | 868,721 | 38 | 373,496 |
| REC_X07_TIME_6H | 14 | 48,839 | 14 | 23,251 |
| REC_X13_TP1.5_SL1_H24 | 22 | 220,601 | 22 | 57,549 |
| REC_X14_TIME_48H | 7 | -61,827 | 7 | -115,227 |
| REC_Y15_REV_D0_T3 | 10 | 16,953 | 10 | -10 |
| REC_Y18_REV_D2_T18 | 9 | 17,929 | 10 | -767 |

## All other strategies re-run with one D route removed

| Removed D route | With-route minus without-route final asset (JPY 10bps) | JPY 30bps |
|---|---:|---:|
| CONT_SHORT_MID_AGE24_48 | +408,733 | +198,869 |
| REC_G3_LATE_BTC_REL | +1,815,226 | +1,048,849 |
| REC_X07_TIME_6H | -588,243 | +832,885 |
| REC_X13_TP1.5_SL1_H24 | +888,209 | +543,592 |
| REC_X14_TIME_48H | +494,623 | +993,137 |
| REC_Y15_REV_D0_T3 | +2,170,465 | +11,208,705 |
| REC_Y18_REV_D2_T18 | +196,626 | +824,662 |

All eight what-if ablations at 10bps and 30bps individually passed accounting reconciliation. One-route marginal effects are NON-ADDITIVE because portfolio gates, capital competition, entries and equity growth change.

Key findings: REC_G3 is D's highest direct profitable route. REC_X14 loses money on its own at both costs; raising its Gross is not justified by apparent portfolio effects. REC_Y15 at 30bps has virtually zero direct profit, while omitting it reduces terminal wallet value by JPY 11.2m: highly sensitive to historic event timing and resource ownership, not stable evidence of route alpha.

This is a fixed historical H1 research model, NOT live 2026-10-26 exact source plus Aster L2 fills/STOP parity or independent out-of-sample performance. Source and machine-readable evidence: scripts/research/v12_v4_d_tier_ablation_20261026.py and docs/research/results/v12-v4-d-tier-gross-20261026/V12_V4_D_005_CONTRIBUTION_AND_ABLATION_20261026.json. No orders were submitted, modified or canceled.
