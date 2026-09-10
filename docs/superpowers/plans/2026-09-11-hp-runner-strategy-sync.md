# HP / Runner Strategy Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align DISTerminal runtime/UI with `V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_1.0_1SLOT`, including reliable V12 Top2 ranking telemetry.

**Architecture:** Port only the proven V12 Top2 runtime/state pieces from historical commits into the current lineage, add an atomic read-only decision snapshot emitted by the Runner, then consume that snapshot through existing observability APIs. Centralize display policy in `disterminal-live-config.ts` and keep all trading safety gates unchanged.

**Tech Stack:** Next.js 14, TypeScript/Node 24, node:test/tsx, systemd env templates, Aster read-only observability.

**Spec:** `docs/superpowers/specs/2026-09-11-hp-runner-strategy-sync-design.md`

## Global Constraints
- V12: max 2 positions, each <=1.00x, aggregate <=1.50x.
- Q102: max 1.00x, exactly one concurrent slot.
- Shared Crypto Gross <=2.00x; Total Gross <=2.50x; daily loss 5%.
- Keep PENGU V20 + Recovery V8 and V52 Top2 signal logic unchanged.
- Keep Fail Closed, Kill Switch, ownership, reconciliation, and account lock unchanged or stricter.
- No synthetic/test orders, no forced flatten, no Kill Switch release.

---

### Task 1: Baseline preservation and failing contracts
**Files:** `tests/v12-top2-runtime-state.test.ts`, `tests/v12-decision-snapshot.test.ts`, `tests/hp-strategy-copy-contract.test.ts`
- [ ] Add tests proving max2 state, decision snapshot candidate/empty distinction, Q102 1.0/1-slot copy, and absence of obsolete 0.5 display copy.
- [ ] Run only these tests and confirm RED on the current lineage.
- [ ] Preserve the existing dirty HP patch as reference only; do not mutate the original worktree.

### Task 2: V12 Top2 runtime/state port
**Files:** `lib/v12-x1-all.ts`, `lib/v12-x1-all-runner-state.ts`, `lib/v12-live-execution-engine.ts`, `lib/v12-top2-residual.ts`, focused selftests.
- [ ] Port `buildV12Signals`, `activePositions`, residual-gross admission and later fail-closed fixes from `053828ce`, `c2bb41f6`, `ed243cd7` without merging unrelated files.
- [ ] Enforce activePositions length <=2, per-position <=1.00x, aggregate <=1.50x and retain legacy `active` compatibility.
- [ ] Run V12 selftests and the new state test to GREEN.

### Task 3: Runner decision snapshot
**Files:** `lib/v12-decision-snapshot.ts`, `scripts/disdex-v12-x1-all-live-runner.ts`, `ops/env/disdex-v12-x1-all*.env.example`, systemd writable-path config as needed.
- [ ] Implement atomic `v12-decision-snapshot/v1` persistence from the same ranked signals used by the runner.
- [ ] Persist an empty candidate array on valid no-signal bars and never use the snapshot as a trading input.
- [ ] Add `V12_DECISION_SNAPSHOT_PATH=/var/lib/disdex/v12-x1-all/decision-snapshot.json` to deployment/UI wiring.
- [ ] Run snapshot tests to GREEN.

### Task 4: Observability and HP full-page sync
**Files:** `lib/disterminal-live-config.ts`, `lib/server/v12-decision-observability.ts`, `lib/server/disdex-decision-status.ts`, `lib/server/quality102-runtime-observability.ts`, `components/features/DecisionStatusPanel.tsx`, `components/layout/LiveProductionBanner.tsx`, affected app pages.
- [ ] Set strategy label to `V12 X1.00 ALL Top2 + PENGU Dual LS V2 / Short V20 + Recovery V8 + V52 Top2 + Quality102 Causal V4 1.0x / 1-slot`.
- [ ] Set Q102 config/observability cap to 1.00x and expose one-slot semantics without altering selector fail-closed state.
- [ ] Render V12 Rank1/Rank2 from the runner snapshot, render valid empty candidates as “この確定2時間足では候補なし”, and reserve “未取得” for wiring/error/stale cases.
- [ ] Render all V12 active positions, not only `active`.
- [ ] Apply only relevant parts of the preserved HP patch and update page copy consistently.
- [ ] Run HP/observability tests to GREEN.

### Task 5: Static audit and build verification
**Files:** tests/scripts only where necessary.
- [ ] Scan all `app/**/page.tsx`, shared layout/components, config and observability for obsolete `Q102 0.5`, `Quality102 <=0.5`, misleading PENGU replacement wording, and V12 one-slot copy.
- [ ] Run focused V12, Q102, shared-risk, PENGU Recovery V8, V52 Top2, HP copy, readonly surface tests.
- [ ] Run typecheck and production build.
- [ ] Inspect `git diff --check`, `git status`, and staged diff for unrelated changes.

### Task 6: Commit, push, and safe deployment verification
**Files:** no new trading behavior beyond reviewed implementation.
- [ ] Commit only reviewed files to `codex/hp-runner-strategy-sync-20260911` and push.
- [ ] Verify local HEAD equals remote branch SHA.
- [ ] Use the immutable pushed SHA for VPS deployment preparation.
- [ ] Perform Aster read-only checks for positions, open/protective orders, account balance, shared-risk lock/state, Q102 ownership, active runner SHAs, duplicate daemons, and service health.
- [ ] If all activation gates are safe, update HP/runtime release using the immutable SHA; otherwise leave trading write/restart blocked and report the exact blocker.
- [ ] Re-check HP decision API/runtime state and confirm V12 ranking telemetry is wired after deployment.

## Verification commands
- `npx tsx --test tests/v12-top2-runtime-state.test.ts tests/v12-decision-snapshot.test.ts tests/hp-strategy-copy-contract.test.ts`
- existing V12/PENGU/Q102/V52/selftest commands discovered from `package.json`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

## Completion contract
Completion requires evidence for code, tests, build, remote SHA, and read-only VPS state. A UI-only `0.5 -> 1.0` change, a ranking table fed by fabricated/static data, or an unsafe service restart does not count as completion.