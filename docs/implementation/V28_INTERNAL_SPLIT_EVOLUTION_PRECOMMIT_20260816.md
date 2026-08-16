# V28 Internal-Split Evolution — Precommit

Status: preregistered before V26/V27 results are read.

## Purpose

If V26 does not pass the historical robustness gate, do not tune its finalists from Validation/Evaluation. Instead increase separation inside the existing Development year.

## Frozen data boundaries

- Warmup data may precede 2023-07-01 only for indicator construction.
- Evolution/Train: 2023-07-01 <= t < 2024-03-01.
- Internal Selection: 2024-03-01 <= t < 2024-07-01.
- External Validation: 2024-07-01 <= t < 2025-07-01.
- External Evaluation: 2025-07-01 <= t < 2026-07-01.
- Validation/Evaluation must not be evaluated until all evolution generations and Internal Selection ranking are complete.

## Frozen search policy

- Universe: BTC, ETH, BNB, SOL, LINK, AVAX, DOGE, INJ, PENGU, XRP, ADA, LTC, ATOM, AAVE, NEAR.
- Existing Research Lab families only: regime_momentum, breakout, relative_strength, dual_direction.
- All genomes force leverage=1.0 and maxMarginUsagePct=100.
- Symbol sets are not evolved; all genomes use the same 15-symbol universe.
- 16 generations, population 20, elite count 5, Internal Selection finalist pool 12, final external candidates 5.
- Fixed seed: 280816.
- Train hard reject: >=16 trades, MaxDD <=35%, PF >=1.15, zero liquidations, effective leverage <=1.0.
- Internal Selection hard reject: >=8 trades, MaxDD <=30%, PF >=1.10, zero liquidations, effective leverage <=1.0.
- External candidates are ranked before External Validation/Evaluation by a fixed composite of Train and Internal Selection only: minimum of their CAGR is primary; PF and DD are tie-breakers.
- No Validation/Evaluation-driven mutation, no per-symbol parameters, no year-specific parameters, no leverage escalation.

## Execution

- Normal execution: 5 bps fee per side, zero added slippage.
- Stress execution: 10 bps fee + 5 bps slippage per side.
- Actual historical funding remains handled by the Research Lab engine; no artificial favorable funding is added.

## Qualification

Use the same historical gate as V26:
- every annual >=80%
- median annual >=100%
- combined 3Y CAGR >=100%
- PF >=1.40
- PF without best >=1.25
- MaxDD <=40%
- >=24 trades
- effective leverage <=1.0 and zero liquidations
- Stress CAGR >=45%, Stress PF >=1.08, Stress PFwoBest >=1.0, Stress DD <=50%
- >=2 positive Stress years and worst Stress year >-25%.

Production/VPS/LIVE/order paths remain explicitly out of scope.
