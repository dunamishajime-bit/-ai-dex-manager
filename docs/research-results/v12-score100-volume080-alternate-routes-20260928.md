# V12 Score1.00 / Volume0.80 selected contract and alternate-route review (2026-09-28)

## User-selected normal gate (research candidate, not LIVE)
- Source: production frozen commit `a09ea45ca3cbd72100f9eb0eaae499039c40b6a0`.
- Change only `config/v12X1AllRuntime.ts`: `neutralScoreThreshold: 1.4649 -> 1.00` (also used in the aligned normal LONG/SHORT path); `minimumVolumeRatio: 0.9845 -> 0.80`.
- Current-bar volume ratio `>=0.80` is **not** the same observable as the existing HC overlay's **previous**-bar volume ratio `<=0.80`. Keep HC multipliers and all win-rate entry blocks frozen at this stage.
- Keep 2h closed-candle causality, BTC Regime, 45-bar Momentum, edge-to-cost, Top3 rank3 minimum Score0.70/0.10x, position/gross reservations, stop/TP/trailing, shared risk, margin guard, and operator deployment gate unchanged.
- The new Score and volume source diff and dedicated route-boundary unit test have passed on the isolated research branch. No LIVE runtime/service or production order has been modified.

## Existing alternate paths, requiring separate evidence
1. **Strong-Regime low-score route**: matching BTC LONG/SHORT direction, `0.15 <= Score <= 0.70`, ATR/price `>=1.40%`. Under normal Score1.00, interval `(0.70,1.00)` stays blocked even in strong Regime. Prior 365d Aster independent-proxy study found weak incremental outcomes when that gap was simply opened. Do not assume that more entries reduce no-signal periods *without increasing DD*.
2. **Non-strong directional Momentum/ATR route**: aligned 45-bar momentum `>=5.4%` and ATR/price `>=1.40%`; importantly the current source has **no separate minimum Score** for this fallback. This can admit e.g. Score0.01 despite normal floor1.00 when momentum and ATR pass. Proposed one-factor tests: Score floor0.15/0.35/0.50 or matching 12h BTC-direction filter.
3. **Strong route quality tests**: increase minimum Score to0.35 or0.50, or require 12h BTC directional agreement. Do not widen the currently blocked score gap unless downside evidence supports it.
4. **Win-rate overlays**: keep HC1.75, False Burst and Rank1 fast BTC filters in place; measure candidate loss and displacements *after* applying them, separately from raw pre-WR candidates.

## Historical Aster data already verified (before changed-score full PnL)
Exact 2025-08-10..2026-08-10 production scan and read-only parameter audit:
- Source Score1.4649/Volume0.9845: pre-WR Top3 slots1488; pre-WR zero-signal days159; longest streak9 days.
- Chosen Score1.00/Volume0.80: pre-WR Top3 slots2020; pre-WR zero-signal days121; longest streak6 days.
- During 2026-08-28..2026-09-26 inclusive: original Top3 slots150/zero-signal days14, versus chosen176/zero-signal days12. Longest no-candidate period remains5 days.
- These slots are repeated 2-hour observations, NOT fresh independent executable orders. Existing 2025-26 combined 10bps baseline with BRK/MR0.75 FET1 and dual FET gates: JPY130,287,867 final, PF2.4176, DD -22.94496%, V12 actual allocations754; those metrics **do not describe this newly selected Score/Volume candidate**.
- Prior last92d 46h-isolated forced-24h direction-return proxy after 0.3% round-trip cost: original +0.796%, chosen +0.295%. These are **NOT portfolio or actual stop/TP results**. Selection decisions here prioritize the user's direction but require full risk validation.

## Independent alternative-route audit
A second research branch `research/v12-alternate-route-review-20260928` replays the frozen Aster annual and recent 30d decision rows, applies Score1.00/Volume0.80 to **every route**, recomputes Top3 and compares route cuts with a 46h per-symbol isolation and next-day price-only proxy. These provisional diagnostics alone are not evidence of portfolio maximum drawdown.

## Deployment acceptance (pending)
Use **the original five-logic shared allocator** with immutable original BTC/FET/PENGU/Q102 and V52 data, verified provenance and no synthetic candles. Baseline original simulation must reconcile exactly before research variants can be trusted. Run 8/10bps paired scenarios plus stressed costs, actual slot displacement, V12 route loss tails, annual monthly trade distribution, worst no-signal streak, and maximum MTM DD. Preserve Q102 BRK/MR0.75, FET1.0 with agreed FET dual rejection gates, and PENGU unchanged. No production deployment, forced fills, stop changes, or kill-switch bypass before the counterfactual risk evidence is complete.
