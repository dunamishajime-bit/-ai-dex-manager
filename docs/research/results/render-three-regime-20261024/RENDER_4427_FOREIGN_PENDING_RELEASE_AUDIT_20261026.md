# RENDER #4427 — Foreign Pending Reservation Release Boundary (2026-10-26)

**Status:** RESEARCH_ONLY / NEED_NATIVE_ALLOCATOR / order_authorized=false

## Newly verified conclusion

The original TypeScript `FileAccountOrderLock.releaseReservation(reservationId)` changes matching rows in its own lock document to `RELEASED`, but it does **not** require that the requested reservation ID exist in that lock document. It then calls `releasePendingExposure(reservationId, this.pendingPath)` unconditionally. The original pending registry release function locates a row by reservation ID alone, without checking the lock owner, lease, strategy, or source reservation identity.

With a synthetic `V12_V4` peer reservation in the shared pending registry, a valid `IDLE_PRIORITY_SHORT:test` lock handle with **no matching lock reservation** can call `releaseReservation("v4-peer-cid")` and change the peer row from `PENDING`, `SUBMITTED`, or `UNKNOWN` to `RELEASED`. In each of those three synthetic cases, aggregate CRYPTO Gross decreases from **0.25 to 0**. No venue order is sent. A valid own-reservation release behaves normally; an unknown ID leaves the registry unchanged; an empty ID is rejected by the pending registry.

This is a **missing ownership/membership validation at the cross-ledger API boundary**, distinct from the previously reported lease-identity races and non-atomic lock/pending writes. It does **not** establish that any current production caller supplies a foreign ID, that V4 and IDLE actually collide this way, or that any live Gross has been understated.

## Primary source byte pins

Fixed source commit: `939b59da49ce7960485a2004b0068dc63417ae82`

| Original source file | Raw SHA256 |
| --- | --- |
| `lib/disdex-account-order-lock.ts` | `169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b` |
| `lib/disdex-pending-exposure-registry.ts` | `09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100` |
| `lib/v12-v4-shared-reservations.ts` | `76c26cd72af578f93b2c18fc9b81c3327e10dc018925ee1377a677def93d59c8` |

The third source pin establishes the original V4 peer pending row's `strategyId:V4_SHARED_OWNER` and `reservationId:cid` source contract. The synthetic peer row is **not** a replay of `V4SharedReservations` itself.

## Independent validation

- Original TypeScript modules executed via Node `stripTypeScriptTypes({mode:"transform"})` and isolated VM contexts.
- Actual Windows filesystem used only beneath `C:/Users/dis/render4427-research-only/`. All temporary Python/Node paths explicitly redirected into that authorized root; no `C:/tmp` access.
- Independent Python launchers: 2 per mode, for normal, `-O`, and `-OO`.
- Seven cases per launcher; **42/42 checks matched expected observations**, six launcher exit codes 0.
- Canonical per-launch result SHA256: `878a721b2560656372a697ac7c6b16204d848c571023ddd92e820d2734366382`, identical across all six processes.
- Audit script raw SHA256: `331609abc893ab66535dd71b7dfe1fbc2110c71c3c2f5f8a297f9fb399aa62a4`.
- Evidence JSON raw SHA256: `472a9c1d6f16ec92c412c8d4ca0545b73db7ff8fd8835ed8621f8bb4d4335e23`.

## Required next proof

Trace every real `releaseReservation` caller and the provenance of its ID through state persistence, restart recovery, and pending registry updates. Require reservation ID membership in the currently held lease **and** a proof-bound Owner/Route/symbol/side/Gross identity match before release. For independently written peer reservations, require a separate authenticated reconciliation path, not a cross-owner release shortcut. Continue native allocator, atomic cross-process CAS, pending/venue reconciliation receipt, independent operator trust root, and 13 GateProof investigations.

Do not treat synthetic receipts or self-pinned roots as genuine operator authority. Do not change existing 8 logics, old IDLE Core `_overlay_block`, VPS, LIVE, Production, HP, real orders, or dirty worktrees. No Native8 economic BT or live activation is authorized.
