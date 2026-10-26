# RENDER #4427 — Cross-process IDLE state writer CAS audit (2026-10-26)

## New finding

The original `writeIdleState()` / `FileIdlePriorityShortStateStore.save()` writes a complete state snapshot to a temporary file and renames it over the current state path. The write does **not** verify the on-disk state generation, original digest, expected `updatedAt`, or a cross-process compare-and-swap token. In controlled real-Windows-filesystem execution, two distinct Node processes loaded the same valid state before either saved. Both later saved successfully. The second writer overwrote the first writer's changes without a conflict error.

The consequences were observed for **pending-entry creation (lost), pending-release (resurrected), cooldown creation (lost), cooldown clearing (resurrected), manual-review creation (lost), and manual-review clearing (resurrected)**. Reversing the write order removed the second writer's `lastDecision` update instead. These are source-level stale-writer/last-writer-wins boundaries, not evidence that a natural Production race occurred.

## Source and test

- Fixed primary source commit: `939b59da49ce7960485a2004b0068dc63417ae82`.
- Raw SHA256 `lib/idle-priority-short-state.ts`: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`.
- Raw SHA256 `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`.
- PC audit script raw SHA256: `362d8ea0dfd09f19386c0f15de0c6c51034b2b1be3acbf6cd097b8237b4ff8e9`.
- Original TypeScript was transformed by Node `stripTypeScriptTypes` and executed through `vm`, retaining the original store load/save and actual `fs/promises` I/O.
- Two separate Node OS processes per case read the same snapshot before a deterministic A→B or B→A save. Six cases × two orders = 12 checks per Python launcher.
- Two independent Python launcher processes for each of normal, `-O`, and `-OO`: **72/72 checks PASS**, all six launchers exit 0.
- Canonical JSON SHA256 identical across all six launchers: `c6d786abf61a1b74f1463d02c54aa1aaa4b4c90fd655b3ba5fa8d4e7787b7186`.

## Evidence boundaries and next audit

The original runner `tick()` obtains an account lock before loading state, which may serialize the normal single-owner path. This experiment **does not** prove an ordinary runner bypasses that lock, or that a second real state writer runs concurrently. It establishes the state-store API's missing CAS/monotonic revision protection if concurrent/stale writers reach it. Source-level caller and actual account-lock coverage must be traced before a Production risk claim.

No venue orders, Production/Native8, operator trust root, 13 GateProof, or real pending/venue reconciliation receipt were used. Research writes stayed under `C:/Users/dis/render4427-research-only/`; no `C:/tmp` access. No existing worktree, live logic, HP, VPS, or order was changed.

Next: enumerate all state writers (including exception/heartbeat/restart), bind state to owner/lease/route/strategy/symbol/gross, verify actual cross-process lock coverage and crash recovery, and require a versioned CAS/transaction contract before accepting stale-writer safety. Independently verify native allocator/preallocation and genuine proof provenance.

**Status: `NEED_NATIVE_ALLOCATOR`, `order_authorized=false`; Owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`, Route `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`, Gross `0.25x`.**
