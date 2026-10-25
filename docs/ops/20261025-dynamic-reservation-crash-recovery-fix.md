# Dynamic entry reservation crash-window repair (2026-10-25)

## Scope and baseline
- Parent commit: 7f595fe679be88f616bf084116df4507dbba27c8.
- Isolated source worktree only. No production, VPS, orders, stops or runner state were modified.
- Critical finding: the account lock could durably reserve while the journal still lacked its reservation ID. Reconciliation could then mark that journal RELEASED without releasing the actual reserved exposure.

## Repair
1. A shared deterministic reservation-ID derivation is used at the registry/account-lock boundary.
2. Each dynamic reservation request supplies a unique reservationKey derived from cycle and intent. Legacy account-lock calls without that key retain their existing reservation semantics.
3. The journal records every planned ID and is atomically written BEFORE the first reserve call.
4. Account-lock reservations with a journal key cannot overwrite or revive the same ID.
5. Registry validates account-lock reservation identity, status and amount before publishing a decision.
6. Exception cleanup releases every pre-journaled ID, even if reserve persisted before throwing. Cleanup uncertainty leads to REQUIRES_REVIEW.
7. Reconciliation fails closed for unknown-ID legacy journals and mismatched account-lock reservation identities; unresolved cycles cannot be overwritten.

## Verification
- Single-worker regression: 71/71 PASS across 9 related test files after final compatibility refinement.
- npm run typecheck: PASS.
- git diff --check: PASS.
- Tests include post-persist exception, reconstruction with a new registry instance, unknown-ID pending journal, duplicate-key replay prevention, unresolved-cycle overwrite prevention.

## Release gates / limitations
- Simulated process interruption is NOT certified as a real daemon kill-and-restart on production VPS. A crashed/stale account lease remains intentionally fail-closed until operator recovery.
- Formal baseline and DYNAMIC_SCORE BT, and the complete V52/Python runtime bridge, remain unverified.
- Before merge/LIVE, confirm full-gate parity, actual current release SHA, lock/pending consistency, owner/lease restoration, order/protection lifecycle and V52/Python compatibility.
- XServer VPS was inspected by read-only SSH. LIVE was not changed.
