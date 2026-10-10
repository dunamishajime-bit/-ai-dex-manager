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

## Follow-up: broker net-quantity check before normal EXIT STOP retirement

The existing normal EXIT path cancelled the completed virtual leg's STOP
before obtaining the signed post-EXIT net-position and remaining per-leg STOP
inventory. A net-position mismatch therefore could cancel protective STOP
first and only then fail. That ordering is unsafe.

The implementation now performs a fresh venue positions/orders readback
BEFORE cancellation, verifies broker net exposure against all surviving
virtual legs, invokes the audited retired-STOP planner (including durable
trigger, remaining STOP quantity, type, side, status and ownership checks),
and only then cancels the retired STOP. It performs another independent
positions/orders readback AFTER cancellation and rechecks net quantity and
surviving STOPs. If the old STOP is already absent, the same post-EXIT
readback checks must still pass. No additional order type is introduced.

A negative full-runner test deliberately reports a wrong venue net position
after an otherwise signed EXIT fill, confirms ZERO STOP cancellation, then
simulates restored correct signed inventory at a later timestamp and verifies
crash-recovery cancellation without placing a second EXIT. This is mock
fault injection; it is not Aster venue certification.

Latest local validation with this change: V4 suite 120/120 PASS, root
TypeScript typecheck exit 0.

Aster's official V3 order documentation states that reduceOnly is not
permitted in Hedge Mode and that One-way Mode normally uses positionSide
BOTH. The actual deployment mode must be signed/read back independently,
and no mixed-mode assumption grants production authority.

Root SSH from this session was attempted read-only with the user's valid
key target and a local SSH alias. It returned exit 255 with no authenticated
remote readback. No VPS systemd, Aster live account, approval artifact,
runner, position, order or configuration was changed.

The approved TIME37 artifact is still bound to its ORIGINAL source SHA,
not the new research SHA. The new SHA must not be declared LIVE-ready.
