# RENDER #4427 — benign recovery / state-writer identity boundary audit (2026-10-27)

## New result
At the pinned primary TypeScript source, `recoverIdlePriorityShortBenignState()` checks only the *previously read* IDLE state for flatness and a narrow allowed manual-review reason. It neither acquires the shared account-order lock nor obtains venue/pending-ledger readback. After its backup is made, a second Node OS process running the **original** `writeIdleState()` can save a valid new pending entry, protected position, new manual-review flag, or cooldown. The recovery process then unconditionally renames its earlier flat snapshot over the peer's newer state, reads back its own snapshot, and returns `IDLE_BENIGN_STATE_RECOVERY_PASS`.

This is an operator recovery *caller* and a cross-process write-identity boundary: its post-rename readback proves only that its own stale snapshot won, not that the precondition (flat and settled) remained true when it committed. It can erase a newly persisted pending/position/manual-review/cooldown state under the controlled interleaving. No venue requests or real orders were made.

## Evidence and controls
- Primary fixed GitHub source commit: `939b59da49ce7960485a2004b0068dc63417ae82`.
- Source raw SHA256 pins (fetched through GitHub API to owner-PC allowed research directory):
  - `scripts/disdex-idle-priority-short-benign-state-recovery.ts`: `da57b0a8f4439ca3a0faeef166ffdc1c91fb29f428cd96fffa1f4d43e4a2d865`
  - `lib/idle-priority-short-state.ts`: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
  - `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`
- Original TypeScript function bodies are run using Node `stripTypeScriptTypes` and `vm`, real Windows filesystem `copyFile/rename/writeIdleState`, and a separate Node process for peer updates. No replacement algorithm for the audited functions.
- Independent Python launcher processes: 2 per mode × normal / `-O` / `-OO`; **60/60 case runs PASS**, 6 exits 0; identical canonical JSON SHA256 `9d1c6f60dbb68a6e108bcd47e1aa007b756200563f54eaffc60c9218557cfc3d`. Python checks use explicit exceptions, not `assert`.
- Ten cases: three valid flat benign-recovery reasons; four post-backup peer writes (pending, position, manual review, cooldown); unknown manual-review, existing pending, existing position rejection controls.
- An already-present pending or position at *initial read* is correctly rejected; this result concerns a later peer write and lack of a commit-time identity check.

## Strict interpretation
This is a deliberately orchestrated race on the owner PC, not evidence of an organically overlapping Production runner/recovery invocation, actual venue position, shared-lock bypass, Native8 allocation, or live financial loss. The benign recovery CLI requires explicit `--apply`, so the test does **not** imply automatic execution. Venue/order safety is **not** certified. No existing production worktree, VPS, LIVE, HP, 8 strategies, orders, or old IDLE Core overlay were modified.

## Required next proof
Trace whether any authorized operational recovery invocation can overlap a live runner, its account-lock acquisition, and all state writers. Require a lock-fenced compare-and-swap or equivalent commit-time source identity, owner/lease/route/symbol/gross and venue/pending receipt binding, then separately prove Native8 allocator and all 13 GateProof inputs from independent sources. Never promote previously explored BT to OOS.

Research-only owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`, route `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`, Gross `0.25x`. **NEED_NATIVE_ALLOCATOR; order_authorized=false.**
