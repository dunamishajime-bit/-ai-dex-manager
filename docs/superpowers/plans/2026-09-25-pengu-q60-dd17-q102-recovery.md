# PENGU Q60/DD17 and Q102 Recovery Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Promote the verified Q102 recovery hotfix and add a restart-safe PENGU COMBINED_FILTERED risk overlay (same-route 60h hard-stop quarantine plus realized DD17%/72h new-entry hold) before safe LIVE runner recovery.

**Architecture:** Keep the existing PENGU V2 signal, sizing, exit, and protective-order paths intact. Add a focused durable risk-state module that records route hard-stop timestamps and realized closed-equity peak/current values, and have the runner consult it only for new-entry eligibility. Q102 uses the already-reviewed hotfix that creates the recovery archive before startup and clears only unsubmitted stale-quote pending state.

**Tech Stack:** TypeScript, Node test runner via `tsx`, systemd templates, GitHub Actions, immutable VPS releases.

**Spec:** `docs/research/PENGU_FLAT1_DD_REDUCTION_FINAL_20260924.md` and the user-provided Q102 recovery requirements.

## Global Constraints

- PENGU signal hierarchy remains `COMBINED_FILTERED`; accepted entry gross remains `1.0` and maximum sleeve gross remains the production contract.
- Same-route hard-stop quarantine is `60h`; realized closed-trade PENGU DD threshold is `17%`; new-entry hold is `72h`.
- Existing positions, reduce-only protective orders, exits, and shared risk gates are never disabled by the overlay.
- Q102 stale quote recovery remains fail-closed with `ordersSent=0`; recovery archive is deploy-owned `0700`.
- No synthetic, test, manual, or probe orders; no forced flatten/cancel; no operator gate bypass.
- Production uses an immutable exact Git SHA release; dirty worktree is never deployed.

## Review Focus

- A hard stop quarantines only its route, not all PENGU routes: route-isolation test.
- Rejected or unfilled intents do not change realized DD: fill/close accounting test.
- Restart preserves quarantine and DD hold state; malformed state fails closed: persistence tests.
- Existing position exits/protective orders remain available during DD hold: runner gate test.
- Q102 stale pending is cleared only for the planned, unsubmitted stale-quote case: recovery wiring test.

### Task 1: Establish isolated implementation branch

**Files:**
- Modify: Git branch metadata only.

- [ ] **Step 1: Create a named branch from the verified Q102 hotfix.**

```powershell
git switch -c codex/q102-pengu-live-recovery-20260925
```

- [ ] **Step 2: Verify the branch starts at `c57494833fb6b9af2e8e5bea46b1757739b4a612` and is clean.**

### Task 2: Add RED tests for durable PENGU risk overlay

**Files:**
- Create: `tests/pengu-route-quarantine-dd-governor.test.ts`
- Modify: `lib/pengu-dual-ls-v2-runner-state.ts` only after RED is observed.

**Interfaces:**
- Produce pure functions for route normalization, hard-stop quarantine, realized-close accounting, and entry blocking that can be consumed by the runner.

- [ ] **Step 1: Write tests for route-only 60h quarantine, realized DD17/H72 blocking, rejection exclusion, and malformed-state fail closed.**

- [ ] **Step 2: Run the focused test and confirm it fails because the module/functions do not exist.**

```powershell
npx tsx --test tests/pengu-route-quarantine-dd-governor.test.ts
```

### Task 3: Implement the minimal durable overlay

**Files:**
- Create: `lib/pengu-route-quarantine-dd-governor.ts`
- Modify: `lib/pengu-dual-ls-v2-runner-state.ts`

**Interfaces:**
- `PENGU_ROUTE_QUARANTINE_HOURS = 60`
- `PENGU_REALIZED_DD_THRESHOLD = 0.17`
- `PENGU_REALIZED_DD_HOLD_HOURS = 72`
- `routeKeyForEntry(positionOrSignal)`
- `recordClosedTrade(state, routeKey, realizedPnl, closedAt)`
- `recordHardStop(state, routeKey, closedAt)`
- `evaluateNewEntryGate(state, routeKey, now)` returning allowed/reason and never affecting exits.

- [ ] **Step 1: Add schema-v2 optional fields with strict finite-number validation.**
- [ ] **Step 2: Implement route-only hard-stop timestamps and realized closed-equity peak/current tracking.**
- [ ] **Step 3: Implement fail-closed behavior for malformed overlay state without mutating exchange state.**
- [ ] **Step 4: Run the focused tests and confirm GREEN.**

### Task 4: Wire overlay into PENGU runner

**Files:**
- Modify: `lib/pengu-dual-ls-v2-portfolio-runner.ts`
- Modify: `lib/pengu-dual-ls-v2.ts`
- Modify: `lib/pengu-dual-ls-v2-runner-state.ts`

- [ ] **Step 1: Add RED integration assertions that entry is blocked during the route/global hold while exits still proceed.**
- [ ] **Step 2: Apply the gate immediately before planning a new entry, after fresh account/quote/state checks.**
- [ ] **Step 3: Record only confirmed filled-and-closed trades and hard-stop exits.**
- [ ] **Step 4: Persist the overlay atomically with the existing runner state and preserve unknown fields.**
- [ ] **Step 5: Run PENGU runner tests/self-test and confirm GREEN.**

### Task 5: Verify Q102 hotfix and all production-critical tests

**Files:**
- Existing Q102 hotfix files from `c57494833fb6b9af2e8e5bea46b1757739b4a612`.

- [ ] **Step 1: Run Q102 pending-recovery wiring tests and self-test.**
- [ ] **Step 2: Run PENGU signal/sizing/protection tests and the new overlay tests.**
- [ ] **Step 3: Run V12, FET, V52, Shared Risk, Margin Guard, watchdog, typecheck, and build checks.**
- [ ] **Step 4: Record any unrelated existing failures without suppressing them.**

### Task 6: Commit, push, and verify CI

**Files:**
- Commit all implementation and tests; do not include research cache/data or secrets.

- [ ] **Step 1: Run `git diff --check` and inspect the staged file list.**
- [ ] **Step 2: Commit with a focused message.**
- [ ] **Step 3: Push the exact branch and verify remote SHA.**
- [ ] **Step 4: Verify GitHub Actions has real jobs and a successful result, not `No jobs were run`.**

### Task 7: Immutable VPS deployment and gated recovery

**Files:**
- VPS immutable release only; no direct edits to a working tree.

- [ ] **Step 1: Capture read-only Aster positions/open orders/protective orders and safety state.**
- [ ] **Step 2: Build release from the exact remote SHA and verify marker/dependency integrity.**
- [ ] **Step 3: Apply runtime wiring and backup/migrate V12/PENGU/Q102/FET/V52 state with ownership/mode checks.**
- [ ] **Step 4: Confirm operator artifact exactly approves the new SHA; otherwise remain fail-closed.**
- [ ] **Step 5: Start safety services first, then runners one at a time, with no order probes.**
- [ ] **Step 6: Reconcile Aster read-only state and verify orders/cancels/position changes stayed zero.**
- [ ] **Step 7: Restore watchdog/position recovery/3h health only after proving the same gate applies.**

### Task 8: Final verification

- [ ] **Step 1: Verify every runner active/running, same SHA, zero unexpected restarts, and fresh heartbeat.**
- [ ] **Step 2: Verify PENGU runtime reports `COMBINED_FILTERED`, Q60, DD17/H72 and Q102 reports stale-pending recovery readiness.**
- [ ] **Step 3: Verify no old-SHA runner, unmanaged order, duplicate protection, or mutation occurred.**
- [ ] **Step 4: Report `LIVE_OPERATOR_ACTIVATION_FULLY_VERIFIED` only if all evidence is present; otherwise report the exact blocker.**
