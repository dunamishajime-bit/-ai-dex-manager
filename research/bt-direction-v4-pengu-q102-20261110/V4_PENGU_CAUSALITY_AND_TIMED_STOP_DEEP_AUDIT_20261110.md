# V4/PENGU source-causality and risk-logic recheck — 2026-11-10

**Decision status:** RESEARCH ONLY; no new V4/PENGU gate or timed stop adopted for LIVE. No order, position, STOP, systemd, Production, or Kill Switch changes. This report augments [Y06 structural stress](./Y06_NATIVE_EXITS_REGIME_AND_GROSS_STRESS_20261110.md) and [V4/PENGU classification](./V4_PENGU_DIRECTION_CLASSIFICATION_20261110.md).

## A. V4: independent source-provenance audit of the pinned 41-route priority

The pinned V4 `lib/v12-v4-v2-shadow.ts` explicitly documents a **full-development-year hindsight-ranked priority table** and `BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06`. Its 41-route rank JSON contains realized `n30`, `wr30`, `pf30`, `mean_return30`, `net30_jpy` metrics, then applies `priority_order` and tier Gross to model entry selection. The source documents policy construction on **2026-10-09**, and separate static size adjustments on **2026-10-26**; these dates are source-comment provenance, not independently authenticated deployment dates.

An independent file-by-file replay-tape SHA audit confirms **all 2,119 natural entry candidates** can be exactly read and matched to their saved output hashes, and none has entry timestamp preceding decision timestamp. **That does not establish causal strategy selection**:

| Source window | Candidates | Before documented V2 date | Before subsequent size change |
|---|---:|---:|---:|
| 2025-03-22 to 2025-10-01 | 598 | 598 | 598 |
| 2025-10-01 to 2026-10-01 | 1,394 | 1,394 | 1,394 |
| 2026-10-01 to 2026-11-08 20:00 UTC | 127 | 15 | 49 |

Thus both the preperiod and historical target are **retrospective shadow reconstruction using later-fit ranks**, not out-of-sample demonstrations of that V2 allocation policy. Forward after the documented policy date still replays later amended sizes across the entire window, and these observations have already been opened during research. Historical source `SHADOW_ONLY` must never be described as native LIVE fills.

The forward source has 10 unresolved V4 counterfactual exit-pairs **solely due to deadlines after available source endpoint**. Two fixed X05 composite triggers fall in this right-censored group. They cannot be classified as beneficial, harmful, or missing due to algorithm failure.

**Reproducibility:** [temporal source audit script](./scripts/v4_pin_temporal_priority_leakage_audit_20261110.py) and [SHA/source/count evidence](./results/v4_pin_temporal_priority_leakage_audit_20261110.json).

## B. PENGU: 2-hour exits and direction changes

[Recovery V8](./results/pengu_v8_2h_native_vs_flat_vs_flip_episode_audit_20261110.json): 51 native Recovery LONG cases, of which **50 still exist at the proposed 2h decision**. Compared to pinned native LONG, 2h flatten harms 31 and improves 19; 2h SHORT re-entry harms 29 and improves 21. 10bps modeled native-relative unit-return sums: flat **-0.75726**, fresh flip **-0.95815**. The case split is non-stationary: later 10-case test positive but earlier 31-case train strongly negative. No blanket 2h exit or flip.

[V64 and V20](./results/pengu_v64_v20_native_flat_flip_episode_recheck_20261110.json): V64 25 cases, unconditional two-hour flip 10 improve / 15 harm, gross incremental 10bps delta sum **-1.11963**; V20 40 cases, 12 improve / 28 harm, sum **-1.90248**. These are research-only gross comparisons, not integrated portfolio.

Independently recomputed V64 pre-entry **BTC 72h hourly-log-return volatility >0.003308885226898718 AND PENGU-vs-BTC 12h log-relative return >0.07355376317477447** from fully closed Aster H1 bars. Exactly 7/7 previously saved candidate IDs fire and are beneficial in the inspected historical ledger. However the 7 outcomes are only **5 nonoverlapping trading episodes**, include a shared August test episode, and there is a synthetic bull-continuation adverse scenario. Status remains **RESEARCH_CANDIDATE, no LIVE promotion**.

## C. Critical PENGU SHORT V20 3h/8h implementation/economics discrepancy

Saved PENGU source pin `1657e173d250ad58f53e62f7bb0a3428fb405496`, `lib/pengu-dual-ls-v2.ts`, defines timed-stop state and reason fields, but no invocation to the separate research module `pinned-source/PENGU_TIMED_AUDIT_1657/lib/pengu-short-v20-timed-stop.ts` was found in the saved pinned executable implementation. **This does not prove current VPS LIVE wiring**; an independent current VPS/GitHub-as-deployed audit remains required before calling it a confirmed Production omission.

The existing research overlay `pengu-timed-stop-overlay-replay-20261109.mjs` calculates SHORT timed-stop `rawReturn=entryPrice/exitPrice-1`, whereas the base pinned native ledger uses `(entryPrice-exitPrice)/entryPrice`. **This is a demonstrated research PnL consistency defect**. Time and price matched all five saved overlay events; repaired PnL formula changed the combined summed delta from **-0.18470605** to **-0.19190930**.

Using 107,136 contiguous Aster M5 bars and **existing native STOP-first**, independently evaluated:

| Current-pin SHORT V20 overlay | Triggers | Improved / harmed | Gross unit-return delta sum |
|---|---:|---:|---:|
| 3h after -2.5%, only | 4 | 2 / 2 | -0.208579 |
| 8h after -4%, only | 2 | 2 / 0 | +0.033865 |
| 3h then 8h | 5 | 3 / 2 | -0.191909 |

Both 3h false exits truncated shorts that later earned around +12% in the native model. **Reject 3h blanket rule as a research proposal**. The 8h-only proposal has merely two favorable raw candidates, not statistical validation.

[Sourcing and corrected PnL M5 replay](./scripts/pengu_short_v20_timed3h_vs_8h_independent_m5_20261110.py), [results incl. original-vs-corrected discrepancy](./results/pengu_short_v20_timed3h_vs_8h_independent_m5_20261110.json).

## D. Integration exposes why 8h-only does not help existing portfolio

Constructed `PENGU_V20_RESEARCH_8H_ONLY_NATIVE_20261110` by changing just two SHORT_V20 native exit rows (`PENGU_00014`, `PENGU_00035`), leaving **114/116 PENGU rows** unchanged and every V4/Q102 route unchanged.

Ran both **10bps and 30bps** integrated research model using stock gross 1.5x and modeled V52 size 1.5x, fee/funding/rebooking and shared admission constraints from the inherited research engine. **Both changed PENGU intention IDs were BLOCKED by `SYMBOL_BUSY`**. Therefore the modeled portfolio admitted zero changed trades:

| Integration | Current PENGU baseline | PENGU 8h-only |
|---|---:|---:|
| 10bps final JPY | 1,810,430 | 1,810,430 |
| 10bps maximum DD | -50.37% | -50.37% |
| 30bps final JPY | 574,925 | 574,925 |
| 30bps maximum DD | -60.67% | -60.67% |

The **decisions, fills, equity and funding CSV file hashes match exactly** in each cost case. Thus there is no economic evidence for promoting 8h-only based on the original raw-candidate 2/2 success. This model inherits incomplete V52 executable evidence and other approximate fills, so it is not certified full Production parity.

[Integrated replay wrapper](./scripts/pengu_short_v20_8h_only_integrated_stock15_20261110.py) and [exact A/B decision, DD and file-hash attestation](./results/pengu_v20_h8_only_stock15_integrated_no_effect_audit_20261110.json).

## E. Mandatory next work

1. Validate actual current deployed code's 3h/8h call sites, pin SHA and owner approval state **read-only**, without assuming historical overlay equals current LIVE.
2. Repair research SHORT return denominator in any reused exit-overlay BT scripts, add assertable parity fixtures (entry/exit math, M5 timing, STOP priority). If the same defect appears in LIVE PnL accounting, handle via separately reviewed code change, not a blind patch.
3. Rebuild V4 priorities **as-of** each historical decision using only already-matured earlier label outcomes. Explicitly separate rank-signal study from fixed current-pin retrospective reconstructions, preserve snapshots/SHA, disjoint episode train/validation.
4. V4 X05/X07/X11 and Y06 direction gates remain unresolved; do not interpret right-censored forward exits as successes. Keep PENGU V64 research-only pending fresh, nonoverlapping genuinely future episodes and raw-price stress tests.
5. Before any rule adoption, run model-current gross and funding, shared risk, native exit controls, 10/30bps integrated DD and admission/reallocation, target DD<=20%. The current research portfolio remains far worse.

**No Production or LIVE change was requested or carried out in this audit.**
