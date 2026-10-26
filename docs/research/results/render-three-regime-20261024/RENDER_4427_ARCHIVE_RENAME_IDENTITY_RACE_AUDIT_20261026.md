# RENDER #4427 — Expired Account Lock Archive Rename Identity Race (research-only)

Date: 2026-10-26 JST. Status: **RESEARCH_ONLY / FAIL_CLOSED / NEED_NATIVE_ALLOCATOR**.

## Newly verified boundary

The fixed-source `archiveExpiredAccountOrderLock()` reads and validates bytes from the lock path, then calls `rename(lockPath, archivePath)`, then reads the archive and checks equality with the *previously inspected bytes*. The post-rename comparison detects a mismatch **after the path has already been moved**.

In an in-memory, fault-injected virtual filesystem executing the **original TypeScript function** (Node `stripTypeScriptTypes`, no target import or production side effects), replace the expired lock at the source path with a newly acquired, unexpired lock between the initial `readFile()` and `rename()`. The function moves the **new lock** to the archive, removes it from the lock path, then throws `ACCOUNT_LOCK_ARCHIVE_BYTES_MISMATCH`. The same outcome occurs when an intervening unlink is followed by reacquisition. This is a distinct *post-inspection path identity / destructive TOCTOU* boundary, not the already known RELEASED-only row rejection.

The mismatch guard is therefore **detection, not prevention**, in this synthetic schedule. The scenario requires an intervening replacement/reacquisition; no evidence establishes that the production recovery caller or Windows filesystem permits this exact interleaving under current operational conditions. No real lock or order was touched.

## Source and independent reproduction

- Fixed source commit: `939b59da49ce7960485a2004b0068dc63417ae82`.
- Primary source: `lib/disdex-expired-account-lock-recovery.ts`.
- Source raw SHA256: `a16dd16a0aeaaf7cd8c1873ad0c9dbe994560ebbf87f7933d29a9f7cf4a65395`.
- Research audit: `scripts/dd-reduction/audit_render4427_archive_rename_identity_race_20261026.py`.
- PC-fetched audit raw SHA256: `cce833548ccf517f3cdc76a3542e1f6becfa1aa56640dacdcbe92f6d2e452c1a`.
- PC permitted working directory: `C:/Users/dis/render4427-research-only/`. In-memory virtual filesystem only; no PC research file write or `C:/tmp` use.
- Two independent Python launchers, each spawning normal, `-O`, `-OO`: **6 child processes, 8 cases each, 48/48 checks PASS**, all exit 0.
- Canonical result JSON SHA256 in all six runs: `ffbaaf1b41fe012c33a9c441994528e5548e7d08bbd0bf117f56184188e9929b`.
- Evidence: `RENDER_4427_ARCHIVE_RENAME_IDENTITY_RACE_AUDIT_20261026.json`.

## Key outcomes

| Synthetic schedule | Function outcome | Lock path afterward | Archive |
|---|---|---|---|
| Expired, owner absent, zero reservations | EXPIRED_ACCOUNT_LOCK_ARCHIVED | Absent | Expired lock |
| New active owner replaces path just before rename | ACCOUNT_LOCK_ARCHIVE_BYTES_MISMATCH | **Absent** | **New active lock** |
| Unlink then new owner reacquires before rename | ACCOUNT_LOCK_ARCHIVE_BYTES_MISMATCH | **Absent** | **New active lock** |
| Unlink with no reacquisition | ENOENT | Absent | None |
| RESERVED old row | ACCOUNT_LOCK_RESERVATIONS_PRESENT | Present | None |
| Not expired / wrong owner / owner alive | Rejected | Present | None |

## Follow-up evidence required

Trace **all real callers** of `archiveExpiredAccountOrderLock()` and their external owner-absence, pending, venue, and lock identity proofs. Before any archival operation, require an independently anchored lock identity and cross-process coordination covering the *entire* read/inspect/move sequence, not merely a second path read or post-move digest check. Verify actual Windows/Linux filesystem semantics in a **permitted research-only sandbox**, without altering operational locks. Do not weaken Fail Closed behavior or bypass same-symbol, cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock, or dedup.

This audit **does not certify** Native8 preallocation/owner-priority, official Owner/Route, 13 GateProof, operator trust root, actual runtime closure, or any 10/30bps economic backtest. No LIVE, Production, VPS, HP, existing eight strategies, orders, dirty worktrees, or legacy IDLE Core `_overlay_block` changes were made. No economic acceptance; `order_authorized=false`.
