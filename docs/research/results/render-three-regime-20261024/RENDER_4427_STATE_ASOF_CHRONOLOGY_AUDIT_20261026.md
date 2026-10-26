# RENDER #4427 — Persisted IDLE state as-of / chronology boundary (2026-10-26)

**Research-only finding.** Fixed primary TypeScript bytes from 939b59da49ce7960485a2004b0068dc63417ae82 were executed with Node stripTypeScriptTypes and VM on the owner's Windows PC. All files used by this experiment were inside C:/Users/dis/render4427-research-only/. No VPS, LIVE, Production, HP, real orders, existing 8 strategies, legacy IDLE Core overlay_block, or dirty worktree was modified. C:/tmp was not used.

## New result

readIdleState() / normalizeIdleState() accept a syntactically valid same-runtime-SHA persisted IdleState with zero, negative, or future updatedAt; a year-old pending.createdAt; a future pending.updatedAt or pending.decisionTs; pending.createdAt > pending.updatedAt; or pending.signalTs > pending.decisionTs. No independent state age, sequence, or causal ordering is verified at this boundary. With synthetic ENTRY pending state, the **original** IdlePriorityShortRunner.reconcilePending() calls executor.reconcileOrder(symbol, clientOrderId) even for those states; the test executor returned UNKNOWN and the original runner went to manual review without sending an order. This demonstrates an **as-of / state chronology validation gap**, not an actual order or production incident.

A separate future-dated lastAcceptedBySymbol.RENDERUSDT also passes state validation, and the original candidateLifecycleAllows() returns false at the reference decision timestamp, showing a conservative cooldown/liveness consequence if such a state is persisted. The test does not show that a real writer produces a future timestamp.

Controls: same-runtime fresh state passes; mismatched runtime SHA, invalid route, and zero quantity are rejected; state without pending does not call order reconciliation.

## Reproduction

- Source pin: lib/idle-priority-short-state.ts SHA256 4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07
- Source pin: config/idlePriorityShortPolicy.ts SHA256 6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8
- Source pin: lib/idle-priority-short-runner.ts SHA256 0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33
- Audit script SHA256: ea9a240e6c815e3a2a4115059511c7a8708bf2eda5a0d7a1f912bc5bc8e5b89a
- Python independent launchers: two for each normal / -O / -OO; 6 separate processes, all exit 0.
- Fourteen scenarios per process, **84/84 PASS**.
- Canonical JSON SHA256 identical in all six runs: 1d3cf93ff6630103735a22c91185760af382f97d85f7b7191397ef200d5e5476.
- Script: scripts/dd-reduction/audit_render4427_state_asof_replay_20261026.py
- Structured evidence: docs/research/results/render-three-regime-20261024/RENDER_4427_STATE_ASOF_CHRONOLOGY_AUDIT_20261026.json

## Limits / next audit

The states are deliberately synthetic; reconcileOrder is a mock returning UNKNOWN. No actual stale state writer, restart replay, real Aster venue call, native 8-strategy allocator, signed independent operator root, inventory, 13 GateProof, or LIVE execution has been certified. A future-dated cooldown is not proof of a naturally occurring writer bug. Next, trace every real state writer and its crash/restart provenance; require state source identity, monotonic sequence, as-of freshness, and owner/lease/route/strategy/symbol/gross linkage before any Native8 independent replay.

**Owner** IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH; **Route** IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT; **Gross** 0.25x; **status** NEED_NATIVE_ALLOCATOR; **order_authorized** false.
