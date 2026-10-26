# RENDER #4427 — Account lock / pending exposure cross-file crash-window audit (2026-10-26, 09 JST)

**STATUS: RESEARCH_ONLY / CROSS_FILE_ATOMICITY_NOT_CERTIFIED / FAIL_CLOSED**

## New primary-code finding

At immutable source commit `939b59da49ce7960485a2004b0068dc63417ae82`, the real TypeScript `FileAccountOrderLock` uses **two separate file updates** to represent one reservation. `reserve()` first atomically renames the account-lock document containing `RESERVED`, then calls `upsertPendingExposure()`. `releaseReservation()` first renames the lock document containing `RELEASED`, then calls `releasePendingExposure()`. Neither is one cross-file transaction. This is a **new code-path boundary**, distinct from prior synthetic SQLite local WAL/receipt experiments; it does not establish any LIVE failure.

The original `release()` method unlinks the lock file but does **not** release entries in the pending-exposure registry. In the pinned IDLE runner, `lock.reserve()` is followed by `state.pending = pending; await stateStore.save(state)` **before the entry's inner `try`**, while the enclosing tick uses `finally { await lock.release(); }`. Consequently, if a failure occurs in that state-save interval, the code contains a path to lock release without corresponding `releaseReservation()`; the registry's active `PENDING` entry can remain. This is a potential **false capacity block / reconciliation obligation**, **not evidence of an actual duplicate order**. The pending registry intentionally counts `PENDING`, `SUBMITTED` and `UNKNOWN` as active.

## Independent owner-PC execution

Owner PC fetched **raw primary bytes** over HTTPS at the fixed source SHA, verified SHA256 and executed the **original TypeScript account-lock class** via Node 24 `stripTypeScriptTypes(mode='transform')` inside a sandbox with an **in-memory virtual filesystem and mocked pending-registry operations**. It never imported the actual application modules, used the venue, wrote any real file or executed an order. Runner and registry call ordering was separately checked against pinned raw source.

| Pinned primary file | Raw SHA256 |
| --- | --- |
| `lib/disdex-account-order-lock.ts` | `169f9b9a7091da9467317435a331b97033383158d8d050008e60b2b52d16a10b` |
| `lib/disdex-pending-exposure-registry.ts` | `09aafb62fe408600452c1fbcbba2158c02b8b99eedaef70c187e4f8677df4100` |
| `lib/idle-priority-short-runner.ts` | `0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33` |

Nine cases: normal reserve/release (pending becomes RELEASED); release without reservation cleanup (pending remains PENDING); injected pending-release failure after lock is marked RELEASED (pending remains PENDING); injected upsert failure (exception rollback works but an intermediate RESERVED lock state is observable); new lease after an orphan pending entry (new lock can be acquired while old pending remains); runner finally release; runner pre-try state save; active pending aggregation; non-atomic cross-file call order.

Two **independent Python processes** per normal/`-O`/`-OO` mode each fetched and pinned the original sources and invoked a fresh Node virtual-FS execution. **9 × 2 × 3 = 54/54 PASS**, all six Python exits 0. All canonical audit digests equal `01dd2ab9f6f971cf01be3ba1f75de499fb762f86c6305e58c702b1ff571e01c2`. GitHub audit script raw SHA256 on the owner PC: `5b59796ee50f49c69ecb3c4b79de8f7a86cba78f5044602c13b6bb48f9945f4f`.

Artifacts: `scripts/dd-reduction/audit_render4427_lock_pending_crash_window_20261026.py`, this report, and `RENDER_4427_LOCK_PENDING_CRASH_WINDOW_AUDIT_20261026.json`. The owner-PC command ran only under `C:/Users/dis/render4427-research-only`; no writes there or to `C:/tmp`.

## Interpretation and remaining proof

The mocked registry is not a substitute for executing the actual pending registry against a real filesystem; this audit does **not** demonstrate actual disk crash durability, real concurrency, production parity, or an order being placed or bypassed. The observed intermediate states show that the source code does not implement a single atomic transaction spanning the lock and pending files. A killed process between those operations would not execute the catch rollback, but **no process-kill or power-loss experiment was performed**. A new lease in the synthetic case does not bypass the independent pending/Gross checks.

Next: inspect the **genuine** Native8 allocator/owner-priority, pending and lock recovery path, and whether a durable cross-file reconciliation receipt with independent source/root identity, sequence, freshness and idempotency is required before any Owner/Route admission. Do not release stale pending blindly: reconcile actual venue orders/positions and lock ownership first. The research-only Gross proof adapter remains unconnected. No self-pinned receipt counts as an operator trust root.

No genuine 13 GateProofs, independent operator root, full dynamic import closure, authenticated Aster M5 fills/funding or formal Owner/Route registration were obtained. **Native8 economic BT and LIVE adoption remain forbidden.** Same-symbol, 12h cooldown, Shared Risk, Gross, Margin Guard, Kill Switch, Pending, account lock and dedup were not bypassed. No VPS, Production, HP, LIVE, order, current eight-strategy code, old IDLE Core overlay or dirty worktree was changed.
