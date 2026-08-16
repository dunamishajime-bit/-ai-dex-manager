# V29 Latency-Aware Internal-Split Evolution — Precommit

Status: frozen after V26 +1H latency failure and before V28 result is read.

## Causal basis

V26 winner bp11-0015 passed Normal historical targets (3Y CAGR 129.46%, annual slice CAGR 106.21/178.75/110.33) but failed a frozen-path +1H execution replay at 30 bps total nominal round-trip friction (3Y CAGR -39.09%). The next search therefore treats execution latency as a first-class Development objective rather than modifying V/E rules.

## Frozen data boundaries

- Train: 2023-07-01 <= t < 2024-03-01.
- Internal Selection: 2024-03-01 <= t < 2024-07-01.
- External Validation: 2024-07-01 <= t < 2025-07-01.
- External Evaluation: 2025-07-01 <= t < 2026-07-01.
- Warmup may precede 2023-07-01 for indicator construction only.
- External V/E are not evaluated until Train evolution and Internal Selection ranking are complete.

## Search space and anti-overfit constraints

- Universe fixed for every genome: BTC, ETH, BNB, SOL, LINK, AVAX, DOGE, INJ, PENGU, XRP, ADA, LTC, ATOM, AAVE, NEAR.
- Existing Research Lab strategy families only.
- Leverage forced to 1.0; maxMarginUsagePct forced to 100.
- Symbol set is not evolved.
- No per-symbol or year-specific parameter.
- 16 generations, population 20, elites 5, Internal Selection pool 12, External finalists 5.
- Seed 290816.

## Normal and latency paths

For every genome on Train and Internal Selection:

1. Run the normal Research Lab backtest with 5 bps fee/side, zero added slippage, actual funding.
2. Freeze that normal trade decision path.
3. Shift each entry and exit fill exactly +1 hour to the corresponding raw 1H open.
4. Apply 10 bps fee/side and 5 bps adverse slippage/side (30 bps total nominal round-trip friction), preserve the normal trade's effective leverage (capped at 1.0), and recompute actual historical funding and hourly mark-to-market drawdown.

## Train eligibility and score

Hard reject if any is true:
- Normal trades <16.
- Normal MaxDD >35%.
- Normal PF <1.15.
- Normal liquidation count >0 or effective leverage >1.0.
- Delayed CAGR <=0%.
- Delayed PF <1.05.
- Delayed PF without best <0.95.
- Delayed MaxDD >35%.

Among eligible candidates, the primary score is the minimum of Normal CAGR and Delayed CAGR. Sharpe/PF and DD are tie-breakers only.

## Internal Selection

Hard reject if:
- Normal trades <8.
- Normal MaxDD >30% or PF <1.10.
- Delayed CAGR <=0%, Delayed PF <1.05, Delayed PFwoBest <0.95, or Delayed MaxDD >35%.

Final external ranking is frozen before V/E using only Train + Internal Selection. Primary criterion is the minimum CAGR across the four paths: Train Normal, Train Delayed, Selection Normal, Selection Delayed. PF and DD are tie-breakers.

## External qualification

Normal historical gate:
- each annual slice >=80% CAGR
- median annual slice >=100%
- combined 3Y CAGR >=100%
- PF >=1.40, PF without best >=1.25
- MaxDD <=40%, >=24 trades
- effective leverage <=1.0, zero liquidations

Delayed execution gate:
- combined 3Y CAGR >=45%
- PF >=1.08, PF without best >=1.0
- MaxDD <=50%
- at least two positive delayed annual slices
- worst delayed annual slice >-25%

No candidate may be mutated after External Validation/Evaluation is read. Fresh OOS remains sealed. Production/VPS/LIVE/order paths are out of scope.
