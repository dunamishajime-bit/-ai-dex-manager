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
