# STABLE4 H48 HYPE-only order-enable design

## Status

Design proposal for the second stage of the two-stage Production operation.
The current Owner approval scope is `HYPE_TREND_LONG` only.

## Confirmed first-stage boundary

The first stage is already evidenced by the formal H48 cutover receipt:

- candidate SHA: `e0e4f1d8f22b62e9410188ef6e590a20e31f760f`
- plan SHA-256: `82d9eb3f4ff4c9787f59c1843a69249e66df6d95696e426b4ee984719ad152ce`
- GLOBAL `HOLD_PROTECTED` remained active
- HYPE candidate was live and produced three real decision-cycle ticks
- orders, cancels, and position changes were all zero
- signed account reads were flat and Shared Risk/Margin Guard were healthy

No new research backtest or test order is part of this design.

## Goal

Allow a natural HYPE H48 signal to place a real order only after a fresh,
Owner-signed approval and a Root-owned preflight. Keep every other Runner
blocked from new orders, preserve protective exits and shared risk controls,
and make the transition reversible without a manual Kill Switch edit.

## Recommended approach: scoped permit under the GLOBAL HOLD

Keep the canonical GLOBAL Kill Switch in `active:true`,
`action:HOLD_PROTECTED`, `scope:GLOBAL`. Add a Root-issued,
source/plan/scope-bound HYPE order permit that the HYPE entry path may consume
only when all of the following are true:

1. The exact `HYPE_TREND_LONG` Owner approval is redeemed through the official
   HP/GitHub Actions bridge. The existing operation is
   `HYPE_STABLE4_H48_TIME_ONLY_LIVE`; no `FULL_PROJECT` approval is accepted.
2. The immutable H48 certificate already installed for the candidate is valid
   and unexpired.
3. The HYPE candidate pin, immutable release, systemd PID, heartbeat, and
   activation artifact all match the approved source SHA.
4. A fresh signed exchange GET proves the account, pending-exposure registry,
   HYPE state, protective STOP ownership, Shared Risk, Margin Guard, gross
   caps, account lock, and writer exclusivity are healthy. The preflight is
   read-only and sends no order, cancel, or position mutation.
5. The permit contains the GLOBAL Kill Switch digest observed at issuance,
   exact source/plan/scope, `ordersEnabled:true`, an expiry, and a unique
   approval nonce digest. It is Root-owned, immutable, and written atomically.
6. The HYPE entry path accepts the permit only for `HYPE_TREND_LONG` and only
   for the exact H48/STABLE4 source. Other Runners continue to see the active
   GLOBAL HOLD and remain blocked.

This is a scoped order permission, not a clearing of the GLOBAL Kill Switch.
The HYPE runtime will read both the canonical GLOBAL HOLD and the permit on
each entry attempt. If the GLOBAL HOLD changes, the permit becomes invalid
because its Kill Switch digest no longer matches. A Root rollback can revoke
the permit without touching the GLOBAL HOLD.

## Explicitly rejected alternatives

### Clear GLOBAL HOLD and rely only on startup activation gates

Rejected. Several long-running peer processes cache their live configuration
and some entry paths do not re-read the operator artifact on every tick. A
global clear could therefore authorize a non-approved Runner after a restart
or stale process state.

### Reuse `ALL_RUNNERS_ORDER_ENABLE`

Rejected. Its scope is `FULL_PROJECT`, its plan covers seven Runners, and it
would exceed the current Owner approval. It must not be used for HYPE-only
activation.

### Manual JSON/systemd/Kill Switch editing or a test order

Rejected. These bypass the formal approval and Root audit trail. No test order
is needed; the first real order may occur only from a valid natural signal.

## Proposed implementation surface

- Add a narrowly scoped HYPE H48 permit schema and validator to the immutable
  HYPE runtime. The check must read the canonical GLOBAL HOLD on every entry;
  an environment-only path override is explicitly not sufficient.
- Add a Root-only HYPE order-enable helper and formal GitHub Actions workflow.
- Redeem the existing HYPE operation through the official bridge, but require
  the certificate to be present and valid rather than re-issuing it.
- Add a HYPE entry-path check that requires the permit while GLOBAL HOLD is
  active. The check is fail-closed and read-only.
- Add tests for exact source/plan/scope binding, Kill Switch digest binding,
  expiry, nonce replay, wrong-runner rejection, stale heartbeat, bad risk or
  margin state, and rollback. Tests must assert zero trading mutations.
- Keep current H48 certificate issuance, Root cutover, STOP policy, Shared
  Risk, Gross limits, Margin Guard, and Kill Switch semantics unchanged.

The production candidate is already immutable and certified as `e0e4f1d8...`.
The implementation therefore follows the existing reviewed overlay pattern:
Root creates a read-only HYPE source view plus the permit module, bind-mounts
that view into only the HYPE unit, and records the overlay, module, environment
and drop-in hashes in the Root receipt. The immutable release itself is not
edited and the old SHA remains the rollback target. A fresh short-lived HP
redemption is still required for the exact `HYPE_TREND_LONG`/`H48_TIME_ONLY`
order-enable operation; the permit is rejected if its source, plan,
certificate or GLOBAL HOLD provenance does not match.

## Commit/rollback transaction

1. Preflight and stage the permit in a private Root directory.
2. Validate the staged permit and candidate entry gate without restarting the
   Runner or touching the exchange.
3. Atomically publish the permit and a receipt containing all evidence hashes.
4. Re-read the permit, Kill Switch, HYPE heartbeat, and writer state.
5. On any failure, remove only the newly-created permit and write a blocked
   receipt. Leave GLOBAL HOLD and all existing safety artifacts unchanged.

## Post-enable verification

The formal workflow must verify at least three subsequent HYPE decision ticks,
that the permit remains exact and unexpired, and that no non-HYPE Runner has a
valid permit. It must report order/cancel/position mutation counters but must
not manufacture a signal or submit a test order.
