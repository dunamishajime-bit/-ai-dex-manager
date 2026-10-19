# 2026-10-19 ATR2.5% Fixed Idle SHORT Continued Backtest — Research Only

DO NOT DEPLOY. No LIVE, shared-risk latch, orders, stops, production SHA or operator approval modified.

## Adopted research assumptions

- ATR <= 2.5% is fixed as preferred entry filter; ATR2.7% is retained as a comparison only.
- No blanket Gross1.5x restriction.
- Compare SHORT initial STOP-loss wallet risk of 15% versus 20%, adverse price gap 0%, 1% or 2%.
- Evaluate ex-ante H1 priority via previous completed-route results, finalized bar feature score, ATR risk.
- Evaluate add-on to existing SHORT only when signed full-size reduceOnly STOP protects positive after-fee PnL.
- Evaluate 5 / 10 / 15 / 30 minute age only when venue-matched 5m quotes/fills/STOP path are available.

## Reproduced historical frozen 61 accepted intents, 10bps

ATR2.5: 58 trades / 47 wins / WR 81.034% / PF 10.7619 / weighted sum +82.9454%.
ATR2.7 comparator: 60 trades / 48 wins / PF 9.9529 / weighted sum +82.6271%.
ATR2.5 blocks two losers (RENDER and JUP) and one winner (TAO) in historical accepted events. Most uplift is removal of one large JUP loss. No ATR-blocked accepted events are observed in the 16 events after May 1, 2026.

## ATR2.5% + six STOP risk / gap permutations (historical frozen-intent STATIC PROXY)

| Budget | Gap | Trades | Wins | PF | 10bps contribution | 20bps | 30bps | Extra lost wins from budget |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 15% | 0% | 54 | 44 | 11.5833 | +76.6163% | +73.3163% | +70.0163% | 3 |
| 20% | 0% | 57 | 46 | 10.6261 | +81.7916% | +78.1916% | +74.5916% | 1 |
| 15% | 1% | 54 | 44 | 11.5833 | +76.6163% | +73.3163% | +70.0163% | 3 |
| 20% | 1% | 54 | 44 | 11.5833 | +76.6163% | +73.3163% | +70.0163% | 3 |
| 15% | 2% | 54 | 44 | 11.5833 | +76.6163% | +73.3163% | +70.0163% | 3 |
| 20% | 2% | 54 | 44 | 11.5833 | +76.6163% | +73.3163% | +70.0163% | 3 |

Risk proxy = gross of simultaneously accepted Idle positions x (assumed fixed 10% initial STOP + adverse gap). No actual venue STOP readbacks, cross-runner SHORT exposures, pending reservations, 5m prices, actual fills or margin accounting are available. Return contribution is a weighted sum, not compounded portfolio JPY or max H1 MTM DD.

20% cap and 0% extra gap preserves 57 historical trades and +81.7916% contribution, but excludes one historical TAO winner (+1.15378%).
15% cap (or 20% with 1%/2% gap) preserves 54 trades and +76.6163%. It excludes three more winners and one additional losing JUP compared with ATR alone. This may be too restrictive, but this is NOT a formal recommendation for a 20% LIVE cap.

## Same-H1 ex-ante prioritization

In 61 frozen historical accepted entries there is exactly one simultaneous H1 conflict: 2026-04-18 19:00 UTC, TAO vs RENDER. Both had positive outcomes. The ex-ante rule ranks TAO first using only PRIOR COMPLETED same-route outcome average (where count >=5), signal momentum/relative-strength/volume score, divided by ATR risk. This is heuristic, not a calibrated estimated value.

| Budget | Gap | Highest-ranked one-per-H1 trades | Contribution | Added opportunity cost |
|---|---:|---:|---:|---:|
| 15% | 0% | 53 | +76.1962% | -0.4201 pp |
| 20% | 0% | 56 | +81.3714% | -0.4202 pp |
| 15% | 1% | 53 | +76.1962% | -0.4201 pp |
| 20% | 1% | 53 | +76.1962% | -0.4201 pp |
| 15% | 2% | 53 | +76.1962% | -0.4201 pp |
| 20% | 2% | 53 | +76.1962% | -0.4201 pp |

The one-per-H1 restriction loses RENDER, a winner worth +0.42019% gross-weighted. Do NOT adopt one-per-H1 unconditionally. Priority ordering itself remains useful when signed actual STOP-risk reservation can admit only one candidate.

## Protected existing SHORT add-on

Require signed reduceOnly STOP readback matching full qty, correct mark/entry/funding/fee accounting and strictly positive executable NET gain if STOP is hit. SHORT entry100 mark95 STOP101 is floating positive but STOP floor negative; adding is rejected. STOP98 may secure gross +2 per unit, but fees/readback must be verified. This control has ONLY synthetic regression tests because no historical signed STOP snapshots exist.

## Delay sensitivity 5, 10, 15, 30 minutes

All four options are UNMEASURABLE from this frozen H1/24h dataset: actual venue-matched 5m bars, quotes/spreads, entry clocks, signal age validity and STOP fill path are missing. Do not fake delayed fill using original hourly entry price.

## Formal integrated backtest requirements

Need actual historical signed resident STOP revisions, orders, partial fills, shared SHORT exposure and pending reservations; 5m venue-matched market data; and current V12 V4 + Q102 + HYPE + PENGU + V52 + FET + Idle causal integration including re-admission of non-Idle candidates, actual risk/margin gates.
Report 10/20/30bps compounded final JPY, portfolio max H1 mark-to-market DD, PF, win rates, missed winners and holdout after 2026-08-10. Current static numbers establish NONE of those.

## Validation

19 tests PASS (new 10 and previous 9); original 25-file canonical LF legacy manifest independently PASS. Legacy 1,390-trade combined 10bps ledger is unchanged and NOT evidence for new variants.

Reproduce:
python research/idle_short_atr25_priority_matrix_20261019.py --output docs/research/results/idle-short-cluster-20261019/ATR25_STOP_BUDGET_MATRIX.json
python -m unittest tests/test_idle_short_atr25_matrix_20261019.py tests/test_idle_stop_budget_and_utc_daily_20261019.py -v
python research/verify_lf_legacy_idle_anchor_20261019.py

Source input hashes:
research/idle_priority_61_intents.json 2262cc6b2433fb25c200eee399ad4135e76a40ecf654bf1b7b0eb7655aa8865d
research/idle_priority_61_target_net.json 19a700170010d0c392fde05bc8c6a861cb59eb3e64eed596c1686556a7c711a0
research/idle_priority_393_generic_candidate_features.csv 8dc3a7d2b532bec1007e6fa7447c09d43427693cfd4b4e7462907dd90eb312e7
