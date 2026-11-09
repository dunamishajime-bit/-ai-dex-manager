# V4 / PENGU deep validation plan — 2026-11-10

Priority is fixed: V4 first, then PENGU. Do not move to the next strategy family until these are classified route-by-route.

## V4 priority
1. REC_Y06_REV_D0_T72 — highest unresolved priority.
2. Recheck saved candidates REC_X05_TIME_36H, REC_X07_TIME_6H, REC_X11_TIME_48H against the exact candidate rules, not later rejected alternate searches.
3. Rejected routes remain rejected unless new independent OOS evidence overturns the rejection.
4. For every surviving candidate:
   - no look-ahead / leakage,
   - exact native feature calculation parity,
   - threshold jitter around each cutoff,
   - walk-forward splits,
   - bull / bear / range / high-vol / low-vol regime splits,
   - false-positive accounting on originally correct native trades,
   - synthetic price-path stress from raw prices through feature calculation to gate output,
   - integrated 10bps and 30bps portfolio BT.

## PENGU priority
1. LONG V64 — unresolved at entry; delayed candidate had no test triggers, so do not promote.
2. Recovery V8 entry — keep native entry direction; prior frozen entry gate failed holdout.
3. Recovery V8 2h rescue — strongest research candidate; retest threshold stability and synthetic raw-price paths.
4. SHORT V20 entry — keep native until independent evidence supports a gate.
5. SHORT V20 2h rescue — rejected unless new independent evidence overturns the final-test false positive.
6. Exploratory V20 exhaustion and V64 overheat stay exploratory until walk-forward/OOS support exists.

## Acceptance gate
A rule is not "solved" merely because precision is 100% on a small sample.

To become an accepted causal candidate it must:
- use only information available at the decision time,
- have zero or near-zero false flips on final unseen data,
- remain stable under threshold perturbation,
- remain directionally consistent across multiple time splits and regimes,
- pass raw-price synthetic path tests without contradictory triggering,
- improve or at minimum not worsen integrated portfolio DD at both 10bps and 30bps,
- preserve an inspectable reproduction script and compact evidence.

Every route must end as exactly one of:
- ACCEPTED_CAUSAL_CANDIDATE
- REJECTED
- UNRESOLVED_DATA_OR_SEPARATION

## Independent validation
Use the Data validation workflow as a second-pass review of methodology, sample size, leakage risk, calculation independence, boundary behavior, and conclusion support. The validation pass must not reuse a claimed correct answer as proof.

## Stop condition
Do not proceed to the next strategy family until V4 and PENGU are each fully enumerated and every route has one of the three statuses above, with the missing evidence explicitly documented for any unresolved route.
