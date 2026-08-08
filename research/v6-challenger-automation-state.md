# V6 Challenger Automation State

Updated: 2026-08-08 JST

Purpose: research-only state for finding a robust independent replacement for Frozen V6 after Fresh Forward V9 failure. This file is not production configuration.

## Hard constraints

- Frozen V6 and Fresh Forward V9 remain unchanged.
- 13 Fresh Forward cycles are diagnosis-only and must never be directly optimized against.
- No production code, VPS, .env, live runner, API key, order, account/position access, or realTradingEnabled changes.
- Preserve chronological Development -> Validation -> pristine Holdout separation. Never reuse a seen holdout for iterative tuning.
- Target acceptance: Normal PF >= 1.20, max DD > -20%, Stress PF > 1.0, Holdout PF > 1.0, sufficient trades, no extreme profit concentration.

## Existing research checked

- Cost-Aware Conviction Execution V13: NO_DEVELOPMENT_EXECUTION_IMPROVEMENT; 0 development passes. Reject.
- Persistent Challenger Rotation V16: previously checked; no development survivor. Reject.
- BTC Low-Gross and Independent Logic V22: BTC_INDEPENDENT_LOGIC_NOT_FOUND; selected logic NONE. Reject.
- Dis-Dex Resilient Profit Stack V34: RESILIENT_DEVELOPMENT_ONLY; 2026 H1 is reused confirmation, not pristine holdout; development DD around -34% and severe DD around -54%. Reject under current DD/holdout gates.
- Dis-Dex V35 Core Only V37: NO_RESILIENT_V35_CORE_ONLY; reused 2026 passed 0. Reject.
- BTC Lead-Lag Spread V47: NO_ROBUST_LEAD_LAG_EDGE; 216 variants, development+validation passed 0. Reject.

## Current active research

- Cross-Sectional Dispersion Reversal V48 run 30726425879 is in progress (attempt 2 as of this update). Do not notify until completed and gates can be evaluated.

## Codex Bridge

- Latest enqueue attempt returned connector-side Resource not found / 404. Treat as transient; retry on later runs. Do not stop research solely for this.

## Next actions

1. Check V48 completion and Artifact first.
2. If V48 fails, inspect remaining already-built independent candidates before creating new work.
3. If no existing candidate meets gates and Codex Bridge is restored, ask Codex to evaluate at most five truly independent hypothesis families with pristine holdout discipline.
4. Notify only on robust success or evidence-backed NO_ROBUST_IMPROVEMENT after reasonable search space is exhausted.
