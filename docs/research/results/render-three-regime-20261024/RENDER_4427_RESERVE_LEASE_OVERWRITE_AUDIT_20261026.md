# RENDER #4427 — reserve() lease replacement / rollback boundary audit (2026-10-26)

## Scope and disposition
Research-only audit. **NEED_NATIVE_ALLOCATOR; order_authorized=false.** No LIVE, Production, VPS, HP, order, current-eight-logic, legacy `_overlay_block`, or dirty-worktree modifications. Only a new isolated GitHub research branch was written. Owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`, Route `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`, requested Gross `0.25x`.

## Primary code pinned by actual bytes
- Immutable source commit: `939b59da49ce7960485a2004b0068dc63417ae82`
- `lib/disdex-account-order-lock.ts` raw SHA256: `169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b`
- Audit script: `scripts/dd-reduction/audit_render4427_reserve_lease_overwrite_20261026.py`
- Script SHA256 fetched on authorized PC: `b130b3443f52f883d39a2394c688cdaf08babf5ce1944ac68a3e8a6927bed033`
- Canonical independent audit SHA256: `27a00af76e1d6e8e1a19c7707bfd6884c176a918dc6b08abb3a9958bb7fdf7ea`

## New finding
The original TypeScript `assertOwner()` and `reserve()` expressions were extracted by source delimiters, stripped with Node `stripTypeScriptTypes`, and executed in a VM with an in-memory lock and pending registry. `reserve()` calls `assertOwner()` to read the owner/lease/expiry, then calls `atomicWrite(this.path, ...)` which renames a temporary file onto the lock path. There is **no owner/lease compare-and-swap at the write boundary**. The per-handle `enqueue` only serializes that handle's tasks.

A deterministic interleaving after the owner read but before the atomic write was injected. When the lock path was replaced by a new Owner B lease, a new same-owner lease, or temporarily absent, the stale Owner A handle overwrote/recreated the lock with its old lease and accepted a `0.25x` reservation. Pre-existing Owner/lease mismatch or expired lease was correctly rejected before the read. A pending-upsert failure caused rollback writes; with a replacement Owner B in the interval, the rollback also left Owner A's old lease in the lock path. The in-memory test distinguishes a safe *atomic file replacement* from an unsafe *conditional identity-preserving update*.

This is a **synthetic interleaving at the original code boundary**, not evidence of a race in Production, a real Windows/Linux filesystem, or a venue order. No independent process-wide locking/owner coverage or Native8 allocation has been certified. The lock must not be force-cleared or safety gates relaxed on this basis.

## PC independent reproducibility
The audit script and pinned source were downloaded as raw bytes by the authorized owner PC without saving research files locally. Two independently launched Python child processes per mode, for normal/`-O`/`-OO`, each ran nine explicit scenarios. All six exited 0; **54/54 expected case outcomes matched** and all six canonical JSON SHA256 values were identical. The Node VM and all filesystem state in the test were in memory; `C:/tmp` was not accessed by the research script.

## Follow-up proof requirements
Trace real `reserve()` and `releaseReservation()` callers, interprocess lease ownership and file identity guarantees, all Pending writers and durable cross-file reconciliation, and an operator-independent trust root. Native8 preallocation/owner priority, formal Owner/Route registration, 13 authentic GateProof sources, sequence/freshness, and frozen actual consumed bytes remain unproven. Preserve same-symbol exclusion, cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock, and dedup Fail Closed. No economic Native8 10/30bps replay or LIVE approval without genuine evidence.
