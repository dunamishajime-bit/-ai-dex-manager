# V12 V4 approved Recovery Gross 0.25x (2026-10-26)

STATUS: RESEARCH_BRANCH_IMPLEMENTED_AND_UNIT_TESTED; PRODUCTION_NOT_CHANGED; V4 LIVE SERVICE CURRENTLY FAILED.

## Exact approved scope

- The operator approved raising nine existing 0.18x V12 V4 Recovery Gross routes to 0.25x for future entries. No existing AAVE/NEAR positions or STOPs are to be modified.
- Only nine C tier RECOVERY_* V4 routes receive the change, the same 217 historical candidates previously tested. Not all recovery routes. No dynamic redistribution or V12 routing priority change.
- 41 route priority/rank and entry/exit policies unchanged. Caps: Recovery Family 2.50x, V12 3.00x, Crypto 3.50x, Total 4.75x.
- Code: lib/v12-v4-v2-shadow.ts exports resolveV12V4V2RequestedGross() and V12_V4_RECOVERY_C_APPROVED_REQUESTED_GROSS=0.25.
- Tests: tests/v12-v4-v2-shadow.test.ts validates all 41 tiers, unchanged native core Gross, S/A/B/D preserved and nine exact C route IDs.

## Complete route-tier map

| Group | Routes | Original Gross | New Gross |
|---|---:|---:|---:|
| S Recovery | 9 | 0.60x | 0.60x |
| A Recovery | 5 | 0.45x | 0.45x |
| B Recovery | 10 | 0.30x | 0.30x |
| C Recovery | 9 | 0.18x | 0.25x |
| Native core | 1 | inherited V12 source Gross | unchanged |
| D Recovery and Robust | 7 | 0.05x | 0.05x |

Impacted nine route IDs:
1. REC_G1_MID_REL_LOWVOL
2. REC_G2_EARLY_BTC_OPPOSE_VOL
3. REC_X02_TIME_36H
4. REC_X04_TIME_24H
5. REC_X06_TIME_12H
6. REC_X09_TIME_48H
7. REC_Y08_REV_D0_T6
8. REC_Y17_REV_D1_T3
9. REC_Y19_REV_D1_TP2_SL1_H36

D tier contains six Recovery routes and one ROBUST_COMPLEMENT. It was not included in the approved 0.18x -> 0.25x BT. Do not change it without separate BT and authorization.

## Research economic evidence

2025-08-10 through 2026-08-10 frozen October 9 H1 integrated eight-sleeve wallet, 10bps/30bps:
- 0.18x original final JPY 291,326,103 / 174,749,524, DD -20.420% / -18.389%, 1,222 / 1,218 trades.
- 0.25x candidate final JPY 298,359,667 / 185,858,225, DD -20.482% / -18.395%, 1,220 / 1,217 trades.
- Gains JPY 7,033,565 (10bps), JPY 11,108,700 (30bps), similar DD.
- 217 affected signals: actual shared wallet accepted 182 (10bps) and 181 (30bps); accepted model Gross averaged 0.233x/0.237x owing to venue lot/capacity constraints.
- 0.275x returned more profit in this in-sample period but is not approved; 0.30x gave 30bps max DD -21.62%.
- The source is frozen 2026-10-09 integrated H1 model, NOT latest exact 2026-10-26 production/venue parity. Static old V12_V4_V2_BT constant intentionally remains the original baseline and is not a prediction.

Research files:
docs/implementation/V12_V4_RECOVERY_GROSS_025_BT_RECOMMENDATION_20261026.md
docs/research/results/v12-v4-recovery-gross-20261026/V12_V4_RECOVERY_018_TO_025_INTEGRATED_10_30_BPS_20261026.json

## VPS incident discovered during this audit

Read-only check 2026-10-26 ~17:20 JST: disdex-v12-v4@23ddd4b01fcff38cd10d4d4614221f93dc6b44e5.service had ActiveState=failed, MainPID=0, ExecMainStatus=2. It failed 2026-10-26 12:17:09 JST with fatal V4_EVIDENCE_STALE:routeSourceParity. Preceding rate-budget issue ASTER_GLOBAL_RATE_BUDGET_SATURATED was logged. IDLE @7688ed7c was active; Production current remained 7688ed7c. The new Gross patch was NOT deployed and did not cause this incident.

## Final Codex / operator LIVE checklist

1. Investigate stale routeSourceParity evidence and rate-budget state, preserve fail-closed and existing venue STOP orders. Do not bypass evidence or manually clear shared loss/kill switches.
2. Reconcile candidate branch SHA with deployed V4 23ddd4 and shared Production 7688ed7. Exact source and CI verification plus immutable staging and rollback must include only the nine C route Gross changes; peer and all other V4 routes untouched.
3. Run latest current-source eight-strategy integrated 10/30bps and real venue sizing/lot feasibility, plus new RENDER and latest exit overlays. Frozen 2026-10-09 economic proof alone is not sufficient for current LIVE parity.
4. Verify actual Aster signed account, current AAVE/NEAR positions, reduce-only STOP protection, margin, pending exposure, shared risk and locks, lifecycle retry/partial-fill/idempotent restart, all runner PIDs.
5. Only with all evidence PASS and specific operator final cutover approval, promote stage and enable new route sizing for future orders. Do not top up current open positions, change old STOPs, or forge certificates. Otherwise report precise BLOCKED reason.

Validation: TypeScript noEmit PASS, 39 focused V4 tests PASS. No production/order changes were made during patch preparation.
