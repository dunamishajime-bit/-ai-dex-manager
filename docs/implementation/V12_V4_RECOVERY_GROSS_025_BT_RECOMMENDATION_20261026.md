# V12 V4 Recovery Gross: 0.18x versus 0.25x (2026-10-26)

STATUS: RESEARCH_ONLY_NOT_LIVE. No production switch or live position/order change.

## Scope and source

Frozen 2026-10-08/09 V12 V4 V2_M150_D05_CORE_NATIVE integrated H1 research model, eight sleeves (V12, PENGU, Q102, IDLE, RESIDUAL, V52, HYPE_LONG, FET), 2025-08-10 to 2026-08-10, 10/30bps cost. The only variable is static requested Gross for 217 preallocation V12 REC_* entries whose baseline requested Gross is exactly 0.18x. Other V4 routes, entry/exit and other sleeves, family/crypto/total caps, admission and priority unchanged. No new dynamic market-fit allocation.

Original baseline fully reproduced (10bps JPY291,326,102.6203428) and all six cost pairs have accounting PASS. The 0.25x economic run was repeated independently and matched exactly for equity, DD, PF, win rate, trade count and accounting.

## Eight-strategy integrated results

| Gross requested | 10bps final JPY | 10bps max DD | 10bps trades | 30bps final JPY | 30bps max DD | 30bps trades |
|---|---:|---:|---:|---:|---:|---:|
| 0.180x | 291,326,103 | -20.420% | 1222 | 174,749,524 | -18.389% | 1218 |
| 0.200x | 293,792,212 | -20.472% | 1223 | 185,261,450 | -18.390% | 1217 |
| 0.225x | 296,672,975 | -20.463% | 1221 | 175,225,478 | -18.395% | 1213 |
| 0.250x | 298,359,667 | -20.482% | 1220 | 185,858,225 | -18.395% | 1217 |
| 0.275x | 301,513,741 | -20.454% | 1218 | 191,974,346 | -18.352% | 1215 |
| 0.300x | 303,331,440 | -20.464% | 1218 | 190,119,294 | -21.624% | 1215 |

Increase from 0.18x to 0.25x improves 10bps final equity by JPY 7,033,565 and 30bps by JPY 11,108,700; maximum drawdown changes from -20.420% to -20.482% (10bps) and -18.389% to -18.395% (30bps), nearly unchanged. The number of closed trades changes by -2 at 10bps and -1 at 30bps.

For 0.25x, 182 of 217 affected candidates are admitted at 10bps and 181 at 30bps. Actual mean model accepted Gross among accepted affected trades is approx 0.233x (10bps) / 0.237x (30bps) because of quantity normalization and capital competition. Most unaffected entries retain the original Gross.

0.275x performed even better than 0.25x in this historical sample, but higher reported return alone does not certify a forward optimum: 0.30x at 30bps has abruptly higher maximum DD (-21.624%) and fewer trades. DD21 is only a research reference, NOT an active production order-stop switch.

## Execution feasibility in a small wallet

At a roughly 60 USDT account, the Aster MARKET_LOT_SIZE for AAVE is 0.1 coin and NEAR is 1 coin, with a 5 USDT minimum new order. A request of 0.25x does not ensure exactly 0.25x fill: AAVE may still take 0.1 unit rather than 0.2; NEAR may move from 2 to 3 units on a future new entry, depending on price. Old protected positions cannot be silently enlarged. No changes to orders or resident stops were made.

## Qualification and decision

This is a 2026-10-09 archived integrated H1 portfolio model, not complete exact parity against all 2026-10-26 LIVE exits, current RENDER dual routes, current Aster venue/L2 slippage or funding. Full-year V4 route quality was selected in-sample, so do not treat this as untouched forward evidence.

RECOMMENDATION: static 0.25x requested Gross for ONLY the current V4 0.18x Recovery route subset is a sensible cautious first-stage candidate; 0.275x is a further forward-test candidate. Before enabling LIVE, separately reconcile the newest V4 source SHA, Aster minimum quantity/notional, actual gross and margin, all eight-runner capital ownership and STOP lifecycle. Retain all account and risk Gates and require explicit final activation approval.

## Reproducibility

Research runner: scripts/research/v12_v4_recovery_gross_018_025_native8_20261026.py . Requires frozen archival study source (V12_V4_RESEARCH_SOURCE_ROOT) and cached market data on authorized Windows PC. Output root configurable by V12_V4_GROSS_OUTPUT_ROOT.

Machine-readable evidence: docs/research/results/v12-v4-recovery-gross-20261026/V12_V4_RECOVERY_018_TO_025_INTEGRATED_10_30_BPS_20261026.json . Contains per-case real counts, DD/PF, and full ledger SHA256.

Original 2026-10-09 anchor: docs/research/results/v4-production-cert-20261009/bt-baseline/cases/V2_M150_D05_CORE_NATIVE/runs/PRICE_MODEL_10BPS/metrics.json .

NO VPS/PRODUCTION/ORDER CHANGES IN THIS RESEARCH.
