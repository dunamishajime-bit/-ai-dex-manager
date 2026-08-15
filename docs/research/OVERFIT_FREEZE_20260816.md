# 3Y Research Overfit Freeze — 2026-08-16

## Scope

This document closes iterative strategy design against the already-inspected historical window:

- 2023-07-01 08:00 JST through 2026-07-01 08:00 JST
- BTC is reference-only; tradable research universe is ETH/BNB/SOL/LINK/AVAX
- Normal research execution: 10bps, delay 0
- Stress research execution: 30bps, delay 1 hour
- No VPS/LIVE/order/deployment/production mutation

The window above is **DESIGN / INSPECTED evidence only**. It must never again be described as untouched holdout, Fresh OOS, or new confirmation evidence.

## Why the freeze is required

V12–V15 and their instrumentation diagnoses repeatedly inspected the same three years. Pair-specific threshold grids were avoided, but repeated architecture selection can still create meta-overfitting. Therefore the next architecture is allowed exactly one historical sanity run against this 3Y window and must not be redesigned from that result.

## Frozen structural findings

1. **Persistent HOLD is necessary but not sufficient.** V15 combined-3Y HOLD gross was positive, but 2024-25 HOLD gross was negative. Merely lengthening holding time is invalid.
2. **Turnover is a first-order failure mode.** ADD/EXIT/REPLACE transitions consume a large fraction of gross edge, especially under 30bps Stress.
3. **Rank replacement is structurally harmful.** Active positions must not be displaced merely because another pair ranks higher.
4. **Pair/side leadership is not stable by calendar year.** No permanent symbol-specific Long/Short rule is permitted.
5. **Market-wide direction forcing is invalid.** Long and Short opportunities can coexist; BTC may be a reference/factor but cannot force all pairs to one side.
6. **Simple 72h leader/laggard continuation/reversal is insufficient.** The frozen four-motif opportunity map produced no phase × motif × horizon combination with positive Normal mean and PF across all three years after costs.
7. **Phase-to-CASH filtering alone is insufficient.** It can reduce bad exposure while concentrating entry/exit churn and destroying the payoff/cost ratio.
8. **Residualization is useful but too reactive in V15.** Residual gross remained positive in later years before costs, but state switching was too frequent.

## One-shot next architecture constraints

The next and only architecture derived from this frozen 3Y diagnosis is **Residual Episode Onset Lock V16**.

It must satisfy all of the following before its first run:

- one common rule set for ETH/BNB/SOL/LINK/AVAX;
- no pair-specific parameters;
- no continuous or discrete threshold grid;
- common rolling market-factor residualization;
- entry only at a **new residual ownership episode onset**, not whenever a level remains eligible;
- no re-entry into the same episode until a neutral/opposite reset occurs;
- two-observation onset confirmation;
- fixed two-slot lifecycle, maximum total research gross 1.25;
- no periodic resizing;
- no rank replacement of active owners;
- exit controlled by slower structural ownership loss, not short-term score drift;
- both Long and Short allowed only when residual direction and absolute direction agree;
- historical 3Y run is **sanity only** and cannot authorize Fresh OOS/LIVE;
- if V16 misses the annual return standard, there is **no V17 redesign from this same 3Y window**;
- if V16 passes the historical sanity standard, it is frozen before any new evidence is opened.

## Return standard

80% is not a target. It is a minimum annual failure floor.

- each historical year must be >= 80% to clear the return floor;
- median annual return >= 100%;
- combined 3Y CAGR >= 100%;
- strong candidate: every year >= 100% and combined 3Y CAGR >= 120%;
- robustness gates remain required; leverage/gross must not be raised merely to manufacture the target.

## Evidence policy after V16

No further architecture redesign may use the 2023-07 to 2026-07 window. Any subsequent architecture research must introduce genuinely new causal information or a separately frozen evidence set before design. Fresh OOS/Forward evidence is not allowed to be recycled into threshold or architecture tuning.
