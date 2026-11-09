# DisDex direction research snapshot — V4 / PENGU / Q102

Snapshot date: 2026-11-10 JST  
Research source period: 2025-10-01 00:00 UTC to 2026-10-01 00:00 UTC (end exclusive), plus pre/forward validation datasets where applicable.

## Scope and safety
- Research-only snapshot. No production runner, order, STOP, gross cap, or LIVE setting is changed by this branch.
- Goal: reduce portfolio max drawdown to <=20% without simply lowering Gross, by correcting wrong trade direction or using causal early rescue where entry-time separation is not reliable.
- Preserve native lifecycle/exits when evaluating a direction change.
- Prefer zero/near-zero false-positive direction changes over high recall.

## Current portfolio checkpoints
- Strict causal direction candidate previously reached roughly 10bps DD -27.38% / 30bps DD -28.64%.
- Research ORACLE upper-bound using the selected high-impact routes reached 10bps DD -18.59% / 30bps DD -19.85%.
- The ORACLE numbers are not implementable rules; they prove that direction correction alone can theoretically reach the <=20% DD target.

## V4
### High-precision candidates found
- REC_X05_TIME_36H: native SHORT -> candidate LONG when 72h volatility <= 0.00658.
- REC_X07_TIME_6H: native SHORT -> candidate LONG when symbol 3h return > -1.401% AND BTC 3h return > -0.588%.
- REC_X11_TIME_48H: native SHORT -> candidate LONG when 72h relative return versus BTC > 0.

### Still unresolved
- REC_Y06_REV_D0_T72 and REC_Y03_REV_D0_T36 remain major DD contributors.
- Many training/validation rules looked perfect but produced false positives on final unseen test. Those are rejected, not production candidates.
- The repository snapshot includes full opposite-direction native lifecycle replay and expanded entry-feature searches so the rejection can be reproduced.

## PENGU
### Entry-time status
- LONG V64: keep native direction for now.
- Recovery V8: keep native direction at entry for now.
- SHORT V20: keep native direction for now.
- Counterfactual opposite direction was better in a material subset, but no entry-time rule separated wrong-direction events with sufficiently stable zero-FP behavior.

### Strongest causal rescue candidate
- Recovery V8: two-hour post-entry causal re-evaluation.
- In the research split reported in this work: train 3/3, validation 2/2, test 2/2 with zero false reversals.
- This is an early rescue / re-direction candidate, not an entry-time gate and not production-adopted yet.

### Additional exploratory candidates
- SHORT V20 exhaustion and Recovery low-volatility reversal appear in the V10 research flip map.
- They remain research candidates until route-level walk-forward/OOS validation is complete.

## Q102
### High-priority findings
- FET PB168: candidate LONG -> SHORT when ret14 > +9.8337%; unseen test previously produced 2/2 correct flips with zero false flips.
- FET BRK24 is a high-impact route for portfolio DD. In the ORACLE study, adding this route moved the 30bps DD from about -21.54% to -19.85%.
- FET BRK24's causal rule evidence is still small-sample and therefore not final.

### Still unresolved / under active validation
- UNI MR72
- RENDER BRK168
- AVAX MR24
- FET REV24
- FET REV12
- DOGE MR48
- broader MR family confirmation rules

The included Q102 MR post-signal confirmation audit shows why broad confirmation rules are not accepted yet: some thresholds look strong in PRE or FORWARD but create false positives in TARGET.

## Rule for continuing this research
Do not move to the next strategy family until V4, PENGU, and Q102 are each classified route-by-route as one of:
1. accepted causal candidate,
2. rejected with documented false-positive/OOS reason,
3. unresolved with the exact missing separation test documented.

No result in this snapshot should be described as production-adopted unless a later production change explicitly does so.

## Included reproducibility material
- V4 full flipped/native lifecycle scripts and strict direction replay.
- PENGU full flipped lifecycle, feature dump, and Recovery V8 2h replay.
- Q102 preperiod/forward native replay scripts.
- V4+Q102 ORACLE and causal integrated portfolio backtests.
- Greedy route ORACLE + FET BRK24 portfolio summaries.
- V10 direction flip map and causal route screening JSON.
- V4 internal-feature rejection evidence.
- Q102 MR post-signal confirmation audit.

Large raw market datasets, full fill CSV ledgers, and venue data are intentionally not committed here; the scripts/results preserve the research logic and compact evidence without bloating the production repository.

## 2026-11-10 PENGU route reclassification addendum
Rechecked the saved PENGU searches using the same rule: a candidate cannot be called confirmed if the final unseen split creates a false reversal.

- LONG_V64 entry direction: KEEP_NATIVE. No stable entry-time zero-FP rule was found. A delayed 6h candidate had train 3/3 and validation 1/1 but zero test triggers, so it remains UNRESOLVED rather than accepted.
- RECOVERY_V8 entry direction: KEEP_NATIVE. Entry-time frozen rule failed holdout (0 TP / 2 FP), so it is rejected as an entry gate.
- RECOVERY_V8 2h rescue: RESEARCH-CANDIDATE CONFIRMED across the nested split. Condition: pre-entry PENGU 12h return > 2.54491018% AND post-entry 2h return <= -0.39952058%. Train 3/3, validation 2/2, test 2/2, zero FP in all three splits. This is a post-entry rescue/re-direction candidate, not an entry gate and not production-adopted.
- SHORT_V20 entry direction: KEEP_NATIVE. The high-volatility rule fired only in train and had zero validation/test triggers, so it is not a generalizable direction gate.
- SHORT_V20 2h rescue: REJECT. Train 6/6 and validation 2/2 were zero-FP, but final test flagged one correct native trade (0 TP / 1 FP).
- SHORT_V20 idiosyncratic-exhaustion (BTC24 >= -1%, PENGU-vs-BTC 12h <= -3.5pp): retain as exploratory only until independent walk-forward/OOS evidence is sufficient.
- LONG_V64 overheat (PENGU 12h >= +12%): retain as exploratory only; it is not promoted by the strict direction audit.

Therefore PENGU is not considered fully solved yet. The only direction-management change currently strong enough to carry forward in research is the Recovery V8 two-hour rescue. LONG_V64 and SHORT_V20 remain native at entry.

## 2026-11-10 synthetic signal stress

A deterministic synthetic feature-space stress harness was added to test whether saved candidate gates fire exactly where their mathematical conditions say they should.

Covered rules:
- V4 REC_X05_TIME_36H
- V4 REC_X07_TIME_6H
- V4 REC_X11_TIME_48H
- PENGU Recovery V8 two-hour rescue
- Q102 FET PB168
- exploratory PENGU SHORT V20 exhaustion
- exploratory PENGU LONG V64 overheat

The harness tests exact-threshold inclusion/exclusion, just-below/just-above behavior, multi-condition AND behavior, monotonic strengthening/weakening, and 20,000 deterministic random synthetic feature vectors per rule.

Current result: 7 rules, 39 explicit boundary cases, 0 boundary failures, 0 metamorphic failures; logic-shape PASS.

Important limitation: synthetic feature-space PASS is not profitability evidence and not OOS evidence. Random activation rates are properties of the artificial sampling ranges, not estimated real-market trigger frequencies. Candidate promotion still requires historical walk-forward/OOS, threshold-jitter stability, regime splits, false-positive accounting, and integrated 10bps/30bps portfolio BT.

FET BRK24 is intentionally excluded from the frozen synthetic-gate set until one final causal rule is selected; the saved snapshot currently proves high DD impact but not a final robust threshold gate.

## 2026-11-10 deep V4/PENGU revalidation

The controlling route-by-route status is now documented in V4_PENGU_DIRECTION_CLASSIFICATION_20261110.md. This later revalidation supersedes earlier optimistic wording for standalone V4 X05/X07/X11 and the selected-subset PENGU V8 2h result where they conflict.

## 2026-11-10 Y06 structural/portfolio continuation (latest)

**Read [Y06_NATIVE_EXITS_REGIME_AND_GROSS_STRESS_20261110.md](./Y06_NATIVE_EXITS_REGIME_AND_GROSS_STRESS_20261110.md) before any further Y06 or integrated direction BT.** It supersedes any earlier inference that the 60h Y06 exit or historic positive standalone signals are robust, adoptable direction rules.

- The complete 352-event Y06 sample preserves 229 timed exits, 70 profit guards, and 53 early adverse exits. Existing STOP/guard fills are not replaced with hourly opens.
- 114 causal early-exit rules, 65 settled-shadow skip rules, 66 time/conditional exit rules, and 10bps/30bps integrated stock cap 4x vs 1.5x sensitivity have been tested. None reaches an acceptable stable <=20% portfolio drawdown.
- Only **31** non-overlapping exposure episodes under the conservative overlap merge, with train/validation/test contamination across two episode boundaries. Trade-level 100% historical precision is not IID confirmation.
- A 60h Y06 time exit gives higher terminal equity in the research A/B but DD is roughly unchanged/worse and remains far outside the 20% target; do **not** adopt.
- Study [source-backed checkpoint JSON](./results/v4_y06_structural_deep_audit_checkpoint_20261110.json) and [episode/regime result](./results/v4_y06_episodes_non_iid_regime_audit_20261110.json); replay scripts are in [scripts](./scripts).
- **Full Production parity is not certified** because the research portfolio engine still uses price/venue approximations for other components, especially V52. No Production, LIVE, order, STOP, or Kill Switch changes were made.
- The next validation must use *fresh source-proven post-2026-10-01 market data* and leave entire overlapping position episodes out of fitting/threshold selection, then full 10/30bps integrated BT.
