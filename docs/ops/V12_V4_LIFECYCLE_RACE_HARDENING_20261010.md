# V12 V4 lifecycle race hardening — 2026-10-10

STATUS: CODE_TESTED / INDEPENDENT_VENUE_LIFECYCLE_NOT_CERTIFIED / LIVE_UNCHANGED

## Provenance

- Isolated research worktree from GitHub remote e87d7924a21b174d4b98b43b916eab1880f1dfbc
- Branch: research/v4-independent-venue-lifecycle-20261010
- No strategy entry, rank, exit, gross, sizing, or TIME37 parameters changed
- No live VPS orders, cancellations, positions or configuration changed

## Finding and remediation

The STOP-retirement planner previously verified surviving same-symbol legs'
venue STOP type, side, reduceOnly and quantity without verifying that the
venue trigger matched each persisted STOP command. A misplaced trigger could
therefore masquerade as continued protection during retirement of a closed leg.

The updated planner attests the retired STOP and each surviving STOP against
the durable normalized trigger, rejects missing/invalid/mismatched trigger
evidence, and refuses retirement if a surviving STOP has partial executions,
is not NEW, has wrong symbol or quantity. The existing signed net-position
and ownership checks remain in force.

Regression tests now reject:
- Altered STOP triggers for either retired or surviving virtual legs
- Missing persisted STOP command trigger
- Surviving STOP already PARTIALLY_FILLED

## Actual checks

- V4 test suite: 120/120 PASS (tsx --test tests/v12-v4-*.test.ts)
- TypeScript tsc --noEmit: exit 0
- First isolated-worktree attempt suffered only missing dependencies;
  after referencing the existing test installation, 120/120 PASS
- Aster official Testnet public GET /fapi/v3/ping: HTTP 200, body length 2
- Public Testnet connectivity is NOT signed order-lifecycle evidence

## Remaining independent venue blockers

1. Aster venue-signed testnet or authentic existing execution records for
   STOP_MARKET partial fill concurrent with scheduled EXIT with multiple
   same-symbol virtual legs in one-way net positioning
2. Durable protection rearm and restart recovery between the first ENTRY
   partial fill and confirmed STOP, including additional cumulative ENTRY fills
3. Verified protection from venue-trigger/EXIT races that could consume
   quantity belonging to another virtual leg
4. Signed trade/order IDs, normalized STOP prices, remaining quantity,
   reduceOnly semantics, positionSide, and unknown-result recovery proof
5. Exact-SHA independent Production certification, integrated all-runner
   proof, and separate final Operator LIVE authorization

The earlier root TIME37 approval is bound to SHA
cb945768dc2903b4c4c7373a5e8688fde2fe0031 and cannot be reused for a
changed release SHA without a legitimate re-approval process.

No real-money TEST orders were used. Production signing keys must not be
reused for Testnet. Do not call this venue lifecycle certification PASS.
Keep existing LIVE Production unchanged until all gates are proven.
