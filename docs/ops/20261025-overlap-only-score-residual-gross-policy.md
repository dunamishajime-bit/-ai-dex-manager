# 2026-10-25 Overlap-only score-based residual gross policy

## Exact user decision

Only use Score-ranked residual GROSS allocation for a new entry if an
already-held, nonzero venue/account position belonging to a DIFFERENT
strategy is present in the candidate's current strict approved portfolio
snapshot. If no such position exists, retain native approved order and
native gross decision, without Score sorting, BT prior re-ranking, or
new signals.

This changes when the scoring optimizer may act, not any strategy's
entry / exit / strategy ownership / cooldown / resident STOP rules.

| Prior holdings when candidate arrives | Action |
| --- | --- |
| No real open positions | Native strict planner approval and original size (bounded by remaining hard caps) |
| Only same strategy holding | Same native strict planner path |
| Only pending orders, open orders, reserved margin, or new same-cycle signals | Same native strict planner path; pending STILL consumes residual capacity |
| Real open holding from a different strategy, fresh strict snapshot, plan corroboration, comparable Score | Score-ranked residual gross sharing among eligible candidates |
| Snapshot stale, absent, inconsistent, position quantity zero, invalid score | Native strict planner path, never infer another holder |

## Implementation

- lib/disdex-overlap-residual-allocation.ts: segregates native-size candidates
  from other-strategy-overlap score candidates. Uses strict approval
  snapshot.positions, validated by validateStrictEntryApproval, and
  cross-checks the same held ID/strategy/symbol/side/positive quantity
  in plan.activePositions. Old opening timestamps do NOT invalidate a
  current confirmed position; the snapshot must be fresh.
- lib/disdex-dynamic-entry-intent-registry.ts: invoked only after strict
  planner approval checks and before the durable reservation journal.
  Native approved candidates consume their bounded gross first in native
  planner approval order. Only overlap-qualified candidates enter weighted
  score allocation of leftover crypto/stock/total/strategy/position capacity.\n  Multiple same-symbol allocations share one position cap during weighted\n  redistribution, so the remainder can flow to another eligible symbol.
- Other-strategy status is never inferred from pendingReservationIds,
  lock reservations, pending order proposals or freshly entered same cycle.
- Normal strict approved size may only shrink if strategy, position or global
  gross cap is lower. The helper NEVER exceeds strict planner's accepted
  gross; score does not manufacture capacity or override failing entry gates.
- Source score not calibrated 0-100 => native planner fallback; no comparison
  against unrelated raw units.
- Registry crash-safe deterministic reservation IDs, strict tokens, shared
  locks, protected STOP requirement, pending exposure, release and restart
  reconciliation retain their original protection.

## Test evidence

48/48 TypeScript allocation/registry/strict-producer tests PASS;
production and research TypeScript typecheck PASS.
Test cases explicitly cover normal without holdings, same-strategy
holder, different-strategy holder, stale/zero-size/uncorroborated holder,
long-held position with newly fresh snapshot, mixed native+score candidates,
uncomparable archived V12 scores, strict gross caps and authentic
strict-approval reservation with another strategy already held.

## Release and BT boundaries

RESEARCH BRANCH ONLY. No change to VPS production, systemd,
existing live orders, positions or risk limits.

The October 23 archived native eight-strategy baseline has been
cashflow-reconciled precisely, but latest-SHA 8-strategy BT with
counterfactual dynamic allocation and native postgate reselection is
still BLOCKED because the original integrated event-loop / postgate
allocator cannot yet be reproduced with all current native exits and
venue capacity decisions. This code change is NOT a claim of a
complete/latest economic BT or approval for LIVE.

The strict planner approval itself remains the upper ceiling:
a candidate denied by native entry or strict safety gating cannot
be resurrected just because residual capital exists. A certified
native event-loop must re-run the original gates to model such
previously capacity-blocked signals; do not fabricate them.

For the future economic test: compare native 10bps/30bps against
this overlap-only policy on the SAME native signal/exit/market tape,
and with the SAME contributions, hard limits, real-position ownership,
funding and pending-exposure controls.
