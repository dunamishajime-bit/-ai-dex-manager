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

## Completed alternate route audit (2026-09-28)
Independent same-source read-only audit PASS: https://github.com/dunamishajime-bit/-ai-dex-manager/actions/runs/36353610162 .
Full machine-readable source: https://github.com/dunamishajime-bit/-ai-dex-manager/tree/research/v12-alternate-route-review-20260928/docs/research/results/v12-alternate-route-review-20260928 .
Annual 2025-08-10..2026-08-10 (Aster original source SHA-audited), latest 30 fully closed UTC days 2026-08-28..2026-09-26. Baseline score1/volume0.8 Top3 H2 decisions 2,020/year,176/latest30d (exact parity against saved baseline counters). 46h same-symbol spacing is research de-duplication, NOT actual fills; price proxy is next H2 open to +24h H2 close less assumed round trip0.3% fees/slippage, without STOP/TP/funding/portfolio gross. The latest30d is not independent from all earlier rule discovery.

| Alternate route experiment | Annual H2 selected vs adopted2020 | Latest30d H2 selected vs adopted176 | Latest30d 46h route proxy |
| --- | ---: | ---: | --- |
| Unchanged strong0.15..0.70 and relaxed no-score-min | 2020 | 176 | STRONG n20 +0.617%; RELAXED n13 -1.302% |
| Strong minimum Score0.35 | 1621 (-399) | 147 (-29) | STRONG n15 -0.762% |
| Strong BTC12h alignment only | 1936 (-84) | 156 (-20) | STRONG n18 +0.279% |
| Relaxed minimum Score0.35 | 1566 (-454) | 161 (-15) | RELAXED n7 +1.733% |
| Relaxed BTC12h alignment only | 1767 (-253) | 155 (-21) | RELAXED n11 -2.841% |
| Open strong Score0.85..1.00 gap with BTC12h check | 1937 (+7 new/-90 displaced) | 157 (+3 new/-22 displaced) | GAP n1 +3.846%; annual GAP n2 -4.010% |

Annual relaxed minimum Score0.35 **does not generalize**: the annual RELAXED 46h proxy is -1.408% (120 independent episodes), versus frozen relaxed -1.069% (240 episodes), and annual no-signal days increase 121 -> 148. Recent30d positive subset is only seven independent episodes and increases zero-signal days 12 -> 15. Strong minimum0.35 worsens final92d total proxy +0.356% -> -0.138% and latest30d. Adding short-term BTC alignment to strong also worsens recent independent-route proxy +0.617% -> +0.279%. Gap additions have sample size2 for the annual fixed horizon,1 for recent; **do not open the gap on this evidence**.

**Interim direction:** implement user-chosen normal threshold in research code, leave strong alternate and relaxed alternate as-is until integrated realized-STOP/TP/DD evidence is obtained. The audit cannot establish whether any alternate-route change reduces maximum DD: run original five-logic BTC-repaired formal allocator with V12 Score1.0/Volume0.8 first, compare route-level accepted trades, loss clusters and displaced winners under 8/10bps and stress conditions, then isolate ONE additional alternate change at a time. This prevents optimizing repeated H2 signals instead of real executable trades.
