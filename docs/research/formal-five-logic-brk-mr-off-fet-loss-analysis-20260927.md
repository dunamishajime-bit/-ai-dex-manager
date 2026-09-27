# Integrated 5-logic research: Q102 BRK/MR ablation and FET loss anatomy

Date: 2026-09-27. Period: 2025-08-10 to 2026-08-10.
Source: retained 10bps annual ECB-reference-FX research price-model ledgers
under `docs/research/results/formal-five-logic-20250810-20260810/latest/`.
This is **in-sample hypothesis analysis**, **not a verified L2-fills BT** and
**not an authorization to modify LIVE runners**.
The integrated summary remains `INCOMPLETE_ALL_FIVE_PRICE_MODEL` for one
missing V52 Yahoo-session reference selection; the other V52 stock funding
provenance is verified. PENGU is unchanged in all user-requested variants.

## 10bps complete modeled sample baseline
Terminal JPY 103,570,059; max H1-MTM DD -37.5211%; PF 1.68836;
1,033 allocated-and-closed modeled trades. Baseline Q102 BRK
8W/4L, +9.749m JPY wins, -31.624m losses, net -21.876m;
MR 17W/16L, +2.136m wins, -17.977m losses, net -15.841m;
HIGH_VOL/REV/PB collectively positive.

## Fully path-dependent integrated allocation replay (PENGU unchanged)
All variants use the same causal upstream signal and modeled candidate-exit
stream; the shared allocator, funding, deposits, cashflows, slot opportunity
cost and compounding replay afresh. They are **not** subtraction of known
losing trades.

| 10bps integrated scenario | final JPY | max DD | PF |
|---|---:|---:|---:|
| Baseline | 103,570,059 | -37.52% | 1.6884 |
| Q102 BRK and MR OFF, all else unchanged | 36,915,076 | -24.86% | 1.8713 |
| BRK capped 1.0, MR OFF | 108,851,393 | -24.85% | 2.0545 |
| BRK capped 1.0, MR capped 0.5 | 122,723,827 | -24.85% | 1.9947 |
| BRK 1.0, MR 0.5, FET 1.25 | 128,202,555 | -22.94% | 2.2024 |
| Both Q102 routes OFF + FET 1.25 | 39,818,966 | -24.86% | 2.0524 |

**Both routes OFF is not an observed integrated profit improvement**; it
forgoes positive timing opportunities and changes future compounding. Risk
reduction alone does not establish superiority. The capped alternatives
preserve some opportunities and merit a separate unseen-period evaluation.

## FET three allocated HARD_STOP trades and strictly pre-entry features

| Candidate ID | FET 24h | ATR 24h | FET relative BTC 24h | BTC 24h | accepted gross | model JPY PnL |
|---|---:|---:|---:|---:|---:|---:|
| C001449 | +23.26% | 2.69% | +20.01% | +3.25% | 0.432 | -309,236 |
| C001493 | +16.63% | 2.32% | +12.93% | +3.70% | 2.25 | -1,521,702 |
| C002051 | +0.19% | 0.293% | -0.971% | +1.16% | 2.25 | -17,921,977 |

The first two follow strong FET acceleration with high ATR. The third
is an entirely different relative-underperformance/low-volatility regime:
a single simplistic BTC-positive filter cannot identify all three.
BTC 24h is positive for all three. No single threshold established a
causal common discriminant against the 15 non-hard-stop accepted FET trades.

Two exploratory **post-hoc** conjunctions tested on the retained allocated
rows: (1) FET 24h >= 15% AND ATR24h >= 2% marked 2 hard stops and
1 other profitable trade (+245,145 JPY); (2) FET relative BTC24h < 0
AND FET24h < 1% marked the catastrophic hard stop and one other
profitable trade (+42,822 JPY). The union marks all 3 hard stops
**and 2 winners**; the static sum of marked trade PnLs is
-19,464,949 JPY. **That figure is NOT counterfactual portfolio profit**.
The gate itself has not been re-run through the path-dependent shared
allocator and has not been evaluated out of sample.

## Independent FET gross-cap integration test
FET-only cap 1.25 (all other unchanged): final 107,922,317 JPY,
DD -32.41%, PF 1.796; FET-only cap 1.0: final 104,810,348 JPY,
DD -31.12%; FET cap 0.75: final 102,868,932 JPY,
DD -29.84%. FET cap 1.25 together with Q102 BRK1/MR0.5:
final 128,202,555 JPY, DD -22.94%, PF 2.202.

## Validation contract
Keep PENGU exactly unchanged. Preserve the original H1 price-model
baseline and raw candidate admission ledger. A subsequent FET gate
test must derive strictly past-only features at signal time, re-run
shared Gross and all downstream compound trades at 8bps/10bps, and
report winners missed, annual/monthly equity, peak-to-trough DD,
opportunity cost, and out-of-sample robustness. Do not select a gate
solely from these 3 observed losing transactions.

Primary data:
`latest/risk-variants/portfolio-price-model-summary.json`;
`latest/fet-entry-audit/fet-preentry-feature-audit.jsonl`;
`latest/fet-entry-audit/fet-preentry-summary.json`;
`latest/10bps/portfolio-trades.jsonl`.
