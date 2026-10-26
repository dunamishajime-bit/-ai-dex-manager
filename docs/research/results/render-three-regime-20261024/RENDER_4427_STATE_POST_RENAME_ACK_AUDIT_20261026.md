# RENDER #4427 — IDLE state save post-rename acknowledgement boundary (research only)

## New, reproducible finding
Pinned original TypeScript `writeIdleState()` calls `writeFile(tmp)`, `rename(tmp, statePath)`, and only then `chmod(statePath, 0o600)`. If `chmod` fails after a successful rename, the new state **is present on the actual Windows filesystem** but `save()` rejects. Thus caller-level error does **not** prove the state mutation was rolled back. This is a commit-versus-acknowledgement ambiguity relevant to recovery/reconciliation, not proof of a LIVE incident.

Two independent payloads were tested: a new `manualReview` flag and a new `lastAcceptedBySymbol.RENDERUSDT` cooldown. In both, injected `chmod EACCES` yielded `committed=true` with `reportedError=true`. Injected pre-rename `writeFile EIO` and `rename EACCES` left the old state intact. Success controls committed and returned normally. The temporary file was absent after all cases.

## Pinned primary code
- Source commit: `939b59da49ce7960485a2004b0068dc63417ae82`
- `lib/idle-priority-short-state.ts`: SHA256 `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
- `config/idlePriorityShortPolicy.ts`: SHA256 `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`
- Audit script SHA256: `0a4be46c35d177cfe0d76acdb2e4e3df5b249fe97902d19b64992cfd0d5fc182`
- GitHub raw bytes were independently fetched on the owner PC and matched both pins.

## Independent reproducibility
- Independent Python launchers: 2 for each of normal, `-O`, `-OO` (6 processes, all exit 0).
- 8 cases per launcher; **48/48 PASS**.
- Identical canonical JSON SHA256: `f56e69f1943f7e0a1a015128d89fc11c7b40e14e7d1c7ec192370ff7147937ec`.
- Original TypeScript was transformed in memory using Node `stripTypeScriptTypes` and VM; actual Windows filesystem was used for `writeFile`, `rename`, `readFile`, and cleanup. Only the selected failing operation was injected.
- All research file writes were restricted to `C:/Users/dis/render4427-research-only/`; no `C:/tmp` access.

## Interpretation and next steps
This is a **synthetic fault-injection proof of the storage contract**, not evidence that native Windows `chmod` failed, that a Runner encountered the fault, or that any real order was sent. Before treating a failed save as an uncommitted mutation, the caller must reconcile the actual persisted state identity/generation and the pending/lock/venue receipts. Continue tracing all real state writers, crash/restart provenance, cross-process CAS and native allocator integration.

Owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`; Route `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`; Gross `0.25x`. **NEED_NATIVE_ALLOCATOR; order_authorized=false.** No changes to VPS/LIVE/Production/HP/orders, existing eight strategies, old IDLE Core `_overlay_block`, or dirty worktrees.
