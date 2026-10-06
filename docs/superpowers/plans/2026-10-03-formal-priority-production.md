# Formal Priority / Cooldown Production Integration Plan

> **For agentic workers:** Use superpowers:executing-plans to execute and verify each task.

**Goal:** Deploy the fixed c7280876 formal contract with existing Overlay and safety controls preserved, then verify live runtime and HP.

**Architecture:** Keep the research strategy fixed. Add only missing execution-boundary checks, observability, and deployment metadata; deploy immutable exact-SHA releases after CI and venue reconciliation.

**Tech Stack:** TypeScript/tsx, Python, Next.js, systemd, SSH.

**Spec:** docs/implementation/CHATGPT_CODEX_FORMAL_PRIORITY_COOLDOWN_LIVE_HANDOFF_20261003.md

## Global Constraints

- Rank1/2 1.00; DOGE/LTC Rank1/2 0.50; residual Rank3 0.50.
- Q102 PB/REV/HIGH_VOL only; whole-position handoff Rank3 -> Rank2 -> Rank1; refresh and replan after every realized exit.
- Same-symbol cooldown = actual venue exit + 2h; missing evidence fails closed.
- Preserve Overlay, all other strategy signals, operator gates, 5x Cross, account locks, protective orders, state and rollback.
- No test orders or deployment-induced flattening.

## Review Focus

- Multiple victims must not be closed using the pre-exit equity snapshot.
- Unknown/partial fills must retain pending/protection and block subsequent victims.
- Venue/state quantity or runtime-SHA mismatch must prevent handoff mutations.
- Missing/non-finite/future fill timestamps must not enable immediate re-entry.
- UI lineage must preserve the deployed Overlay and use current runtime contracts.

## Task 1: Source and evidence

- [x] Verify GitHub c7280876 and exact 1275/2588 ledger sizes/hashes.
- [x] Read all five required source documents.
- [x] Confirm existing GitHub contract/offline safety jobs actually succeeded.
- [x] Record VPS release, states, ownership, safety, positions and protection with authenticated reads.

## Task 2: Execution integration

Files: lib/v12-q102-priority-preemption.ts, lib/v12-formal-priority-policy.ts, lib/v12-x1-all-runner-state.ts, tests/v12-q102-priority-preemption.test.ts.

- [x] Add executor regression tests and confirm RED against the handoff.
- [x] Return after one reconciled victim, so the caller refreshes equity/positions/quote before selecting another.
- [x] Validate venue ownership, SHA and actual fill evidence before clearing pending or canceling protection.
- [x] Persist handoff and actual-exit observability without changing signal logic.
- [x] Run affected V12/Q102/protection/reservation/safety tests and compile.

## Task 3: Production metadata and HP

Files: docs/production/current-live-target.json, docs/production/current-implementation-readiness.json, current deployed UI observability/decision/history surfaces in an isolated UI checkout.

- [x] Align current metadata to the new formal reference while preserving historical artifacts and Overlay configuration.
- [x] Verify HP source lineage; add gross/rank/cooldown/handoff fields and formal H1 BT labels.
- [x] Test, typecheck and build the final HP source.

Safety prerequisite: retained Overlay exact-SHA combined parity is not established by the five-logic formal artifact. See FORMAL_PRIORITY_INTEGRATION_AUDIT_20261003.md. Do not mutate current/operator/state or relabel old certificates to bypass this prerequisite.

## Task 4: CI and deploy

- [ ] Commit/Push exact final source and verify GitHub jobs, not just a run status.
- [ ] Read and use the deployment helpers only after verifying their prerequisites and side effects.
- [ ] Preflight, backups, formal state migrations, immutable release, exact-SHA operator approval, sequential startup and support wiring.
- [ ] Keep old/new trading instances mutually exclusive and preserve existing protection.

## Task 5: Post-deploy

- [ ] Observe multiple decision cycles, fresh heartbeat/state, unified SHA, NRestarts and shared safety.
- [ ] Reconcile venue positions/protection before/after and audit unintended mutations.
- [ ] Verify HP/API and Overlay with deployed source/runtime.
- [ ] Report FULLY_VERIFIED only when every required measurement is confirmed.
