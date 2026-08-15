# Research Performance Charter — 2026-08-16

## Scope

This charter applies to new research candidates after the frozen V1–V7 diagnostic line. It does not rewrite, rescue, or reinterpret the pass/fail gates of already-frozen experiments.

Research boundary is mandatory:

- `researchOnly=true`
- `productionChanged=false`
- `vpsChanged=false`
- `liveChanged=false`
- `realTradingEnabled=false`
- Fresh OOS is never used for architecture selection, threshold choice, pair selection, or retuning.

## Primary objective

The main object being optimized is the **cross-pair portfolio**, not a requirement that every pair make the same return every year.

- **Main candidate target:** 3-year portfolio CAGR >= **100%**, net of declared normal transaction costs.
- **Progress only:** 80% <= 3-year portfolio CAGR < 100%.
- **Insufficient performance:** 3-year portfolio CAGR < 80%.

Reaching the return target alone is not a pass. Robustness gates below must also pass.

## Baseline robustness gates

These are frozen research design constraints, not retroactive user-authored requirements.

- Portfolio profit factor >= 1.30; >= 1.50 preferred.
- Profit factor without the single best trade >= 1.15.
- Normal maximum drawdown <= 35% in absolute magnitude.
- Stress profit factor >= 1.05 and stress maximum drawdown <= 45% in absolute magnitude.
- Combined completed trades >= 24 and each Development / Validation / Evaluation year >= 5 completed trades.
- At least 2 of the 3 annual windows must be profitable.
- No single annual window may lose more than 25% of starting equity.
- The single best trade may contribute at most 35% of gross winning P&L.

A candidate failing a robustness gate remains research evidence even if CAGR exceeds 100%; it is not promoted.

## Anti-cheating return rules

The 100% CAGR target must come from actual opportunity capture and portfolio construction, not arithmetic leverage of a weak edge.

- Baseline gross portfolio exposure is capped at 100% of equity.
- No leverage multiplier may be introduced merely to push CAGR through the target.
- Position expansion/pyramiding, if used, must remain inside the same 100% gross exposure budget and may add only after an existing position has demonstrated favorable ownership/continuation state.
- Transaction costs and stress costs must be declared before the evaluated result is observed.
- No post-result change to a date interval, symbol universe, cost, or missing-data treatment is allowed.
- Large historical data gaps are never forward-filled to manufacture continuity.

## Validation protocol

For the current 3-year research frame:

1. Development: 2023-07-01 <= t < 2024-07-01. Architecture/mechanism selection may use Development only.
2. Validation: 2024-07-01 <= t < 2025-07-01. Frozen rules only.
3. Evaluation: 2025-07-01 <= t < 2026-07-01. Frozen rules only.
4. Combined 3Y is used to compute final net CAGR, PF, PF-without-best, drawdown, concentration, and annual diversification behavior.
5. A historical pass grants, at most, permission for a separate one-shot Fresh OOS evaluation. It never grants LIVE eligibility.
6. Fresh OOS/Forward must be supportive before any production discussion.

## Portfolio architecture direction

New clean-sheet candidates should be evaluated as an integrated **Portfolio Profit Engine**:

`Regime -> Opportunity -> Pair Selection -> Entry -> Position Expansion / Ownership -> Exit`

The intended source of high return is concentration in the strongest valid opportunity, rotation when ownership changes, fast invalidation of failed entries, and extended ownership of exceptional trends. Weak years in one pair may be compensated by other pairs; the portfolio is the primary target.

## Stop condition for this research line

Research does not stop at an 80% CAGR historical result. A serious historical candidate must reach **>=100% 3-year CAGR and pass the robustness gates** above. Even then, research is not considered LIVE-ready until sealed Fresh OOS/Forward evidence is supportive.
