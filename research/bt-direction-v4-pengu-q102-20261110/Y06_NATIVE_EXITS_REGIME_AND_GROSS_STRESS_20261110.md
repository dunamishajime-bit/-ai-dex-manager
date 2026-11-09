# Y06 structural stress, native-exit fidelity and portfolio A/B — 2026-11-10

**Status: RESEARCH ONLY — no Y06 rule accepted. No Production/LIVE/order/STOP changes.**

## Scope and reproducibility

Primary Y06 sample: 352 current V4 SHORT native lifecycle intentions, 2025-10-01 00:00 UTC to 2026-10-01 00:00 UTC, terminal exclusive. Pinned V4 source `3ad65403013b701db5d9e53e8814e6ab827a28e8`. Every counterfactual must preserve native exit if it occurs before an experimental intervention. This research-only integrated engine is **not** current Production parity (V52 historical executable orderbook absent, additional models approximate).

Full compact [structural checkpoint](./results/v4_y06_structural_deep_audit_checkpoint_20261110.json), [overlap/regime audit](./results/v4_y06_episodes_non_iid_regime_audit_20261110.json). Original full diagnostic JSONs and source H1 tapes remain in `C:\tmp\disdex-bt-20251001-20261001\DIRECTION_RESEARCH_20261109`, with SHA256 of full JSON and source tapes recorded in compact checkpoint.

## Native exit controls: do not conflate time exits with protective fills

| Native exit condition | Count |
|---|---:|
| Time, 72h | 229 |
| SHORT profit protection | 70 |
| Initial adverse/loss protection | 53 |

Price parity: all entries matched the H1 OPEN and all returns matched native entry/exit price calculation; **52 protective exits are not at hourly OPEN** and **53 exit timestamps do not have an H1-open bar**. Those are STOP/guard-style executions, not data corruption to be silently replaced. Research preserved each existing native exit price and time and sampled only an earlier hypothetical next H1 OPEN.

## Structural failure of naïve causal fixes

- 114 first-hit early-exit rules: only two had positive settled train + validation totals; the 12h/two completed -5% adverse rule lost on test; the 24h counterpart had a tiny positive test total and damaged originally correct trades.
- At 6h, 77 training trades were underwater, of which 43 recovered into native wins. Any indiscriminate early loss exit destroys good SHORTs.
- 65 online shadow-settled skip rules: **zero** improved both train and validation under the defined requirements. All labels used for the skip were required to have exited before the next decision. Neither is a deployable gate.
- 66 native-stop-preserving hold-time/conditional variants: 60h unconditional time exit was the sole option showing positive trade-level return sum on all three previously inspected train/validation/test periods, but its results were heavily dependent on the traded episode. It was tested rather than adopted.
- 352 raw signals comprised **31 overlapping-position episodes**, not 352 independent trials. Both train/validation and validation/test boundaries intersect exposure episodes.
- In a descriptive 10,000-draw resampling of the 31 episodes, the total gross raw delta for H60 was +0.34438 but the nominal resampled 95% range included **-0.854 to +1.515**. This is illustrative only: IID episode assumptions are not credible under apparent regime shift.
- Monthly native route performance was strongly positive from 2025-10 through 2026-04, but negative in 2026-07, 08 and 09. This is a time/regime drift signal, not proof of a single retrospectively chosen change point.
- Baseline historical train/validation/test wrong-direction base rates also shifted 18.5% / 47.1% / 67.6%. Pre-existing thresholds and their OOS are not independence-qualified.

## Integrated counterfactual: current-like gross sensitivity

Research engine with the same native V4 (1,394), PENGU (116), Q102 selected-native (205) tapes on both sides. All other modeled logic fixed. Fee/funding and shared admission constraints handled by the existing engine; this **still is not certified full live parity**.

| Model | 10bps final JPY | 10bps max DD | 30bps final JPY | 30bps max DD |
|---|---:|---:|---:|---:|
| Research engine, stock 4x / modeled V52 2x, native Y06 | 1,871,194 | -50.24% | 580,642 | -60.48% |
| Same, Y06 H60 | 1,963,020 | -51.08% | 608,093 | -60.90% |
| Sensitivity: stock 1.5x / modeled V52 1.5x, native Y06 | 1,810,430 | -50.37% | 574,925 | -60.67% |
| Same, Y06 H60 | 1,920,245 | -50.33% | 606,299 | -60.82% |

At 1.5x stock cap, H60 improved the 10bps DD by only approximately **0.04 percentage points** and worsened 30bps DD by **0.15 points**. DD<=20% is far away. **No H60 adoption.**

The original 4x-stock engine let **46 actually admitted Y06 positions** exit differently despite 239 altered Y06 hypothetical lifecycle candidates; another **43 entry admission decisions changed**, with 25 new/18 absent fills. This proves why isolated exit deltas cannot predict whole-portfolio DD. At the Sep-28 DD trough, large cumulative closed losses from PENGU SHORT V20, PENGU Recovery V8, V4 Y03, Q102 FET, IDLE JUP were present in that research model; this is attribution context, not proof those live algorithms performed identically.

## Unresolved risks, exact next experiments

1. **V4 Y06**: focus on structural deterioration and the interaction of 72h mean reversion with momentum continuation. Derive a causally measurable *regime state transition* at the decision timestamp; do not search dozens of retrospective thresholds and call it validation.
2. **Fresh event-grouped OOS**: acquire source-proven 2026-10-01 onward Aster hourly/M5 data and current pinned entry/exit replays, define 72h label maturity and grouping by overlapping exposure episodes before looking at test metrics. Hold out entire episodes, not individual rows.
3. Compare on truly unobserved periods: native strategy, skip-only, no-flip rescue, direction changes, and state-dependent hold time **with native STOP/profit-guard first**, plus long/short counterfactual native exits and synthetic raw-price paths.
4. Validate each candidate via synthetic bull/bear/V recovery and threshold jitter, effective independence, bootstrapped regime sensitivity, false-flip counts and Data independent second pass.
5. Re-run whole portfolio with current certified gross/slot constraints and true V52 evidence when available, both 10bps/30bps, max/DD time + causal position contributions + capital freed/reallocation decisions.
6. Keep X05/X07/X11 in unresolved research status and PENGU V8/V20 unresolved, V64 research candidate; **do not move to independent Q102 research until V4 and PENGU have documented route-level disposition**.

**No candidate is Production-adopted.** Previous ORACLE DD below 20% is not an executable result; the causal integrated model remains above 20%.

## Forward shadow falsification, 2026-10-01 through 2026-11-08

The saved Aster H1/M5 forward dataset **exists** in `FORWARD_HOLDOUT_20261001_20261108`. Crucially, its pinned V4 source manifest explicitly declares `BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06` and `SHADOW_ONLY_HINDSIGHT`. It is **not an independently valid causal OOS sample**; use only to search for falsifying counterexamples, not for candidate promotion or threshold tuning.

When replaying the previously specified Y06 60h time exit (always preserving any earlier native guard/STOP), 20 forward Y06 intentions yielded 13 changed exits: **2 beneficial, 11 harmful**, including **9 formerly profitable native shorts worsened**. Total unlevered summed directional-return difference was **-0.177145**, and all four distinct overlapping-position episodes had negative aggregate differences. This is decisive adverse evidence against adopting an unconditional H60 change, **subject to the forward-source leakage caveat**. Outcome for H60 is **REJECTED RESEARCH PROPOSAL**, not an accepted exit rule.

[Forward Y06 replay script](./scripts/v4_y06_forward_tainted_h60_falsification_20261110.py); [results and data-provenance status](./results/v4_y06_forward_tainted_60h_falsification_20261110.json).

The same forward source contained X05 8, X07 4 and X11 3 entry intentions. Independently recomputed completed-H1 features for the pre-registered composite rules: X05 fired twice but both lacked a complete paired native/opposite modeled lifecycle; X07 and X11 did not fire. **No composite rule gains usable OOS support from this shadow.**

[Composite forward diagnostic script](./scripts/v4_x05_x07_x11_forward_tainted_falsification_20261110.py); [results](./results/v4_x05_x07_x11_tainted_forward_falsification_20261110.json).

The next step remains clean untainted causal-intention reconstruction with a genuinely held-out date range (and case-level source/feature/exit provenance), followed by episode-purged tests and integrated current-pin 10/30bps.
