# RENDER #4427 — Expired account lock / RELEASED row recovery boundary (research only)

Date: 2026-10-26 JST. Fixed upstream source: `939b59da49ce7960485a2004b0068dc63417ae82`.

## New primary-code conclusion

`FileAccountOrderLock.releaseReservation()` changes an existing reservation to `status: "RELEASED"` but keeps that row in the lock document. The separate `release()` method later unlinks the lock file. If a process terminates between these operations, an expired lock can contain only RELEASED rows. In `inspectExpiredAccountOrderLock()`, the recovery guard rejects **any** nonempty reservations array, regardless of row status, with `ACCOUNT_LOCK_RESERVATIONS_PRESENT`. Consequently, the ordinary expired-lock archive path cannot recover this specific synthetic state, even when no RESERVED row remains.

This is a **conservative fail-closed/liveness boundary**, not evidence of a live crash, lost funds, a safety bypass, or permission to ignore the guard. A recovery that simply ignores RELEASED rows would be unsafe without independent pending/venue reconciliation, owner-process absence proof, and immutable inventory evidence.

## Primary-source pins (raw SHA256)

- `lib/disdex-expired-account-lock-recovery.ts`: `a16dd16a0aeaaf7cd8c1873ad0c9dbe994560ebbf87f7933d29a9f7cf4a65395`
- `lib/disdex-account-order-lock.ts`: `169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b`
- Research audit script: `scripts/dd-reduction/audit_render4427_expired_lock_released_row_20261026.py`, PC-fetched raw SHA256 `7df4c900e720ec696d7e1984c97fb5c0b3ed17bfbe8bca83dfbfbfa13d2068c4`.

## Reproduction

Owner PC allowed CWD: `C:/Users/dis/render4427-research-only/`. Two independent Python launcher processes each ran fresh Python `-B`, `-B -O`, `-B -OO` child processes. Each fetched and SHA-pinned source and script bytes. The original TypeScript's pure `inspectExpiredAccountOrderLock` function and its helpers were extracted and executed in-memory using Node 24 `stripTypeScriptTypes`. The original module was not imported and no filesystem or venue functions were executed.

15 cases per child × 3 modes × 2 independent launcher processes = **90/90 expected outcomes**; six exit codes 0; all canonical audit JSON SHA256 `410f77c1fab861e48e18f1c639c16a6f0495ca9db31e9e234935431d37cf07a7`. Controls include empty expired lock allowed, RELEASED-only rejected, RESERVED rejected, mixed rejected, owner alive rejected, not expired rejected, owner mismatch rejected, and absent-PID proof handling.

## Constraints / next work

- Fixed historical GitHub code, synthetic in-memory inspection only; not current Production, Native8, actual crash, or order evidence.
- No VPS/LIVE/Production/HP/venue/8-logic changes; no changes to existing dirty worktrees, no PC research file writes, no C:/tmp access.
- Preserve `NEED_NATIVE_ALLOCATOR`, `order_authorized=false`.
- Next: audit owner absence + lock/pending/venue reconciliation receipts and whether actual all-writer lock coverage exists before designing a safe recovery of RELEASED-only rows. Do not weaken fail-closed recovery based on this synthetic result.
