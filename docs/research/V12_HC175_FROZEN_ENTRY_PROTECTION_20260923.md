# V12 HC 1.75x frozen research contract & entry protection audit (2026-09-23)

Status: RESEARCH_ONLY. NOT a Production configuration change, deployment, integrated BT, or authorization to trade.

## Frozen baseline
- Research branch: research/v12-winrate-gates-20260923
- Frozen HC criteria, directional returns relative to proposed LONG/SHORT: symbol 24h >= +1.8%; previous closed 2h candle volume ratio <=0.80; BTC 24h >= +2.0%. Priority HC ahead of nonHC when otherwise equally eligible.
- HC sizing multiplier: **1.75x**, nonHC multiplier: 1.00x. Keep rank3's existing small cap and maximum 3 V12 positions. Hard study V12 aggregate gross ceiling: **2.0x**; multiplier may be truncated by available gross. Do NOT treat HC 1.75x as venue leverage, and do not increase shared Gross or risk limits from this study.
- Same V12 standalone simulation baseline (2025-08-10 to 2026-08-10; 13万円 total deposits; NORMAL 5 bps fees, SEVERE 10 bps fees +5 bps execution slippage): HC175 NORMAL end 1,043,268.88 JPY, WR55.16055%, PF4.01396, DD6.42123%, 872 trades, HC112 trades/75% WR; SEVERE end427,217.41 JPY, WR45.75688%, PF2.25144, DD8.67822%.
- This study is NOT parity with past formally integrated multi-strategy BT; the standalone DD is NOT live shared portfolio DD.

## Isolated gate research under this frozen baseline
| Candidate | NORMAL end JPY | NORMAL PF | NORMAL DD % | SEVERE end JPY | SEVERE DD % |
| --- | ---: | ---: | ---: | ---: | ---: |
| HC175 locked | 1,043,269 | 4.014 | 6.42 | 427,217 | 8.68 |
| Same-symbol loss-only cooldown 6h | 1,031,271 | 4.217 | 5.50 | 407,157 | 8.62 |
| BTC soft veto iff both 12h and 24h against trade direction | 953,118 | 4.134 | 6.42 | 412,913 | 8.59 |
| BTC soft veto + loss-only 6h | 949,363 | 4.365 | 5.50 | 407,440 | 7.97 |
| NonHC Rank2 score >=0.35 | 748,123 | 3.992 | 5.73 | 348,206 | 10.55 |
| NonHC weak Rank2 requires soft breakout/reclaim | 923,922 | 4.135 | 5.73 | 403,795 | 7.98 |
| Soft breakout/reclaim for ALL nonHC | 461,710 | 5.350 | 6.30 | 299,478 | 7.93 |
| DD moderate guard with isolated V12 equity DD proxy | 1,044,504 | 4.015 | 6.42 | 390,661 | 8.24 |
| All gates combined | 669,574 | 4.469 | 4.97 | 332,604 | 7.91 |

The above candidate results reflect separate strategy simulations, NOT just post-hoc filtered fills; all keep HC multiplier at 1.75 and nonHC multiplier 1.0, before aggregate Gross cap. Do not imply all gates improve PnL: they generally decrease total return.

## Risk-first engineering items before any LIVE activation
1. BTC slow regime (53x2h SMA, 52x2h momentum) is regime context, not sufficient short-term entry confirmation. Obtain same-timestamp finalized 12h/24h BTC returns in the actual V12 runner, distinguish feed/rate source from PENGU. Do not silently turn slow LONG into fast LONG during short-term reversal.
2. Do NOT impose blanket Rank1/2 0.70 score, unconditional >=0.35 floor, or existing strict breakoutBars18/buffer2.33%. Historical research shows severe lost opportunities. If testing conditional blocking, constrain to nonHC lower-score rank2 plus demonstrable short-term adverse BTC and/or failure of causal pullback/reclaim.
3. Separate route labels: NORMAL_SCORE, STRONG_REGIME_ALT, RELAXED_MOMENTUM_ALT, HC overlay flag. Preserve attribution in HP, order, fills, and closure history; HC is a quality label almost always on alternate route, not a standalone strategy or broad filter.
4. Real order-fill-timestamp-based same-symbol cooldown: under investigation, loss-only 6h; use read-back/actual exchange fills, not strategy candle index. Existing risk controls and protect-only orders must continue.
5. DD must be read from authoritative fresh shared risk equity+positions, not V12-only local NAV. Compare stage policy at >=4% and >=5% only after integrated BT; no live protection should be weakened by stale DD. In research, DD guard lowered severe portfolio-style return; weigh return/DD explicitly.
6. Existing breakout config is not evidence of an effective LIVE gate. Confirm actual candidateEligibility wiring and report gate used, causal candle, and reason; either route-test a softer breakout/reclaim condition or remove misleading implied protection from the UI.
7. At candidate, pre-submit, exchange read-back, monitor/order protective creation: require same locked HC criteria and bounds, no double-counting pending/existing Gross. Operator activation artifact and fail-closed gate mandatory after exact Source SHA match and read-only reconciliation.
8. Replay September 21-23 event with exact trade fill timestamps, H2 candle close identities, BTC 12h/24h historical bars and original entry route. Do not claim the previous 2025-08 to 2026-08 BT proves the September 23 loss would have been blocked.
9. Formal integrated BT across V12+PENGU+Q102+V52+FET and actual shared Gross/risk limits, plus independent time-split/out-of-sample before deployment.

## Research sources
- scripts/research_v12_hc175_safety_gates_20260923.ts (19-case measured version commit e3b0791699663a4a225140a265c2bf746916f979; newer targeted scenarios under development MUST NOT be treated as verified absent new run)
- scripts/research_v12_winrate_gates_20260923.ts (fixed HC 1.75 baseline commit eab902a8a06bcdfd8b79d5d8466290302b88b75a)
