# RENDER #4427 — normal Account Lock release path-identity race (research only)

Date: 2026-10-26 JST, 14:xx. New isolated branch: `research/render4427-normal-release-unlink-race-20261026-1414`.

## New conclusion

The fixed TypeScript `FileAccountOrderLock.acquire()` return handle's **normal `release()`** implementation reads the current lock, compares `ownerId` and `leaseId`, then asynchronously invokes `unlink(this.path)`. There is no atomic identity guard binding the read document to the subsequently unlinked filesystem object.

Using the **original `release: () => enqueue(async () => {...})` source expression** extracted from the byte-pinned TypeScript, the in-memory filesystem adapter schedules a different owner's valid lock (or a new lease of the same owner) after the old read but before unlink. The old handle removes the replacement lock and returns successfully. Both pre-existing owner/lease mismatches are rejected without deletion, demonstrating that the defect is specifically the check-to-unlink race. This is distinct from the already-notified **expired-lock archive rename** race.

This is a synthetic deterministic interleaving of a real source expression. It does **not** prove an actual Windows/Linux filesystem race, production occurrence, Native8 path, actual order, or venue impact. A subsequent account lock acquisition is not automatically authorized; never weaken same-symbol, Shared Risk, Gross, Pending, Margin Guard, Kill Switch, cooldown, or dedup protections.

## Source identity and reproducibility

- Fixed source commit: `939b59da49ce7960485a2004b0068dc63417ae82`.
- Source: `lib/disdex-account-order-lock.ts`.
- PC-fetched raw source SHA256: `169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b`.
- Audit script: `scripts/dd-reduction/audit_render4427_normal_release_unlink_race_20261026.py`.
- PC-fetched raw audit script SHA256: `d87c46606941c1b08b9dc2572445748753fe3cd3c543a53ebdfde6ca4e36aedd`.
- Original TS release expression executed in Node `vm` with `stripTypeScriptTypes`; mocked `read` and `unlink` only. No production imports or filesystem writes.
- Two independent PC Python launchers, each with three independent child processes: normal, `-O`, `-OO`; eight cases per child; **48/48** case checks, all six child processes exit 0.
- Canonical audit payload SHA256 in all six processes: `3699c6db65139f1ed811a24d2dd0f11b5fa9c0232209950aef1ce39bae61bf1a`.
- Tested normal release, pre-read owner mismatch, pre-read lease mismatch, post-read owner replacement, post-read lease replacement, disappearance, missing initial path, and unlink permission error.
- The two post-read replacement cases both delete the **new** lock while reporting success. The pre-read mismatch controls preserve the new lock.
- PC permitted research working directory: `C:/Users/dis/render4427-research-only/`; in-memory execution; no research files written to PC; `C:/tmp` not used.

## Safety and follow-up

This audit does not certify a candidate-independent trust root, full dynamic import/patch closure, actual Native8 preallocation/owner-priority, formally registered research Owner/Route, 13 genuine GateProofs, inventory freshness, or venue/account evidence. **NEED_NATIVE_ALLOCATOR / order_authorized=false**. No economic BT, no live activation.

Next: inspect normal `release()` callers and actual OS path identity / unlink interleavings; verify cross-process lock/recovery exclusion and lock/pending/venue reconciliation. A robust fix must prove ownership of the *same object* at deletion time; a second read followed by unlink alone does not make the operation atomic. No changes to VPS/LIVE/Production/HP/current 8 strategies/legacy IDLE Core/dirty worktrees.
