# V12 Multi-Logic V4 Shadow Implementation Contract - 2026-10-09

Status: SHADOW ONLY / REAL ORDER MUTATION DISABLED

## Canonical sources

- Research SHA: be61b258c862a180dc3385d9caabb4d99be1e942
- Route catalog: docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json
- BT ledger: docs/research/V12_MULTILOGIC_V4_BT_LEDGER_20261009.csv
- Preferred case: REF_G5_TIME48

## Hard safety boundary

- V4 orderEnabled must remain false.
- V4 shadow code must not call venue create/amend/cancel/close methods.
- Existing production V12/PENGU/Q102/V52/FET/HYPE order paths are not modified by this shadow contract.
- Every V4 state row must explicitly include shadow=true and orderEnabled=false.

## Frozen architecture

- Same symbol + same direction may hold multiple internal Virtual Legs.
- Opposite direction is exclusive.
- A new REC_Y reversal may preempt opposite REC_X / REC_G recovery virtual legs only.
- Core FAILED_BREAK_REV_SHORT_6H and Robust CONT_SHORT_MID_AGE24_48 are protected.
- Existing REC_Y and REC_Z are protected from the recovery preemption rule.
- Recovery route-local slot cap: 16.
- Recovery family gross cap: 1.00x.
- Normal recovery requested gross: 0.10x.
- Robust complement maximum gross: 0.25x.
- Venue Min-Lift may lift only to the minimum valid venue quantity, only when post-lift gross <= 0.30x and gross room remains.
- V12 total gross cap: 2.00x.
- Crypto gross cap: 3.00x.
- Total portfolio gross cap: 4.25x.
- REC_G5_SLOW_TREND uses fixed 48h exit.

## Required shadow decision flow

1. Compute all causal H1 features used by the route catalog.
2. Evaluate all 41 routes independently.
3. Preserve source side, effective side transform, entry delay and exit policy exactly.
4. Build Virtual Legs before portfolio admission.
5. Apply same-side stacking and opposite-side exclusivity.
6. Apply REC_Y preemption only to opposite REC_X / REC_G legs.
7. Apply route slots, recovery-family cap, V12 cap, crypto cap and total cap.
8. Normalize venue quantity and apply Min-Lift only under the frozen rule.
9. Persist every candidate and every rejection with an exact reason.
10. Calculate shadow exit and modeled PnL without venue mutation.

## Required state fields

- strategyId / architecture / shadow / orderEnabled
- route / family / symbol
- sourceSide / effectiveSide
- sourceSignalTs / eligibleEntryTs / entryDelayHours
- rank
- requestedGross / postMinLiftGross
- recoveryFamilyGrossBefore / v12GrossBefore / cryptoGrossBefore / totalGrossBefore
- virtualLegId / sameSymbolSameSideLegCount
- oppositeSideConflict
- preemptionEligible / preemptedVirtualLegIds
- entryRuleTokens and all feature values consumed by those tokens
- decision: CANDIDATE / ACCEPTED_SHADOW / REJECTED_SHADOW
- exact reason
- plannedExitPolicy / plannedExitTs / plannedTp / plannedStop when deterministic
- shadowEntryPrice / shadowExitPrice / modeledPnl when closed

## Reconciliation gates

- candidate identity parity on frozen historical timestamps
- route identity parity
- side transform parity
- entry delay parity
- exit policy parity
- Virtual Leg ownership parity
- Min-Lift and gross reservation parity
- rejection reason parity
- zero V4 real-order mutations

Any future real-order review must be a separate process and is outside this shadow contract.
