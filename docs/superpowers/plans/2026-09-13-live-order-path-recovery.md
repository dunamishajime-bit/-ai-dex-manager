# Live Order Path Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the shared Aster rate-budget lock/atomic-write race that can incorrectly Fail Closed the order-admission path, preserve Q102 state-file permissions across restarts, and deploy the verified fix without generating orders.

**Architecture:** Keep the existing shared JSON budget and Fail Closed semantics, but make the cross-language directory lock owner-aware. A lock is stale only when its recorded owner is no longer alive (or the owner metadata is absent beyond the bounded recovery window); an active owner is never evicted solely because it is older than five seconds. Both TypeScript and Python implementations use the same owner metadata schema. The Q102 systemd preflight remains the authority for state/cache ownership and is contract-tested rather than manually editing state.

**Tech Stack:** TypeScript/Node test runner, Python unittest, systemd unit contracts, immutable VPS release deployment over SSH.

**Spec:** The read-only VPS audit from 2026-09-13 documenting `ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT`, atomic rename `ENOENT`, and historical Q102 `EACCES` failures.

## Global Constraints

- No synthetic, test, dummy, forced, or natural-order mutation during implementation or deployment.
- Preserve Fail Closed, Kill Switch, account lock, shared-risk, Gross, selector, lot, and strategy conditions.
- Do not delete or rewrite existing Q102 state, pending orders, positions, or failure history.
- Keep the historical `QUALITY102_LIVE_ENABLED=false` guard unchanged; only Causal V4 remains live-capable.
- Keep the immutable current release model and deploy only from a pushed commit.

### Task 1: Add failing lock-race and permission contract tests

**Files:**
- Modify: `tests/aster-global-rate-budget.test.ts`
- Modify: `tests/test_aster_global_rate_budget_python.py`
- Add: `tests/q102-state-permission-contract.test.ts`

**Interfaces:**
- The tests exercise the existing `reserveAsterGlobalRateSlot` and Python `wait_for_aster_global_rate_budget` APIs.
- The lock metadata schema is `disdex-aster-rate-budget-lock/v1` with `pid`, `createdAt`, and a per-acquisition `token`.

- [ ] Step 1: Add a TypeScript test that creates a lock directory with a live owner PID and an old mtime, then asserts a second reservation waits and fails closed without deleting the active owner lock.
- [ ] Step 2: Add a Python equivalent using the current process PID and an old lock mtime, asserting the active owner is not evicted.
- [ ] Step 3: Add a contract test asserting the Q102 live unit contains the `ExecStartPre` ownership repair for `market-history.json`, and that the state directory is deploy-owned and mode `0700` in the current runtime wiring.
- [ ] Step 4: Run the focused tests and confirm the new race tests fail against the current implementation for the expected reason.

### Task 2: Implement owner-aware shared budget locking

**Files:**
- Modify: `lib/disdex-aster-global-rate-budget.ts`
- Modify: `scripts/disdex_v13d_v11eq_stock_live_engine.py`

**Interfaces:**
- Preserve all exported function names and existing error codes.
- Add no retry for order mutations; only the read-only/request-budget admission lock behavior changes.

- [ ] Step 1: Add a bounded owner metadata writer after successful lock-directory creation.
- [ ] Step 2: Change stale-lock recovery to remove a lock only when metadata identifies a dead PID, or when metadata is absent past the bounded recovery window; never evict a live owner based only on age.
- [ ] Step 3: Make release token-aware so a process cannot remove a lock that it no longer owns.
- [ ] Step 4: Preserve canonical JSON, `0660` budget-file mode, request-weight accounting, cooldown propagation, malformed-config Fail Closed, and bounded queue saturation.
- [ ] Step 5: Run focused TypeScript and Python tests; verify the new tests pass and the pre-existing rate-budget tests remain green.

### Task 3: Verify complete order-path contracts without sending orders

**Files:**
- No strategy logic changes expected.
- Test commands cover `scripts/disdex-v12-x1-all-live-runner.ts`, `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`, `scripts/disdex-quality102-causal-v1-live-runner.ts`, and `scripts/disdex_v52_aster_only_live_engine.py`.

- [ ] Step 1: Run TypeScript typecheck and focused Aster/risk/Q102/V12/PENGU tests.
- [ ] Step 2: Run Python compile and Aster/V52 safety tests.
- [ ] Step 3: Run the production build and `git diff --check`.
- [ ] Step 4: Confirm all tests use mocked/local fixtures and report zero orders, cancels, and position changes.

### Task 4: Commit, push, and deploy an immutable VPS release

**Files:**
- Commit only the lock implementation, tests, and the plan/audit record.

- [ ] Step 1: Review the diff and confirm unrelated working-tree changes remain untouched in the original checkout.
- [ ] Step 2: Commit to `codex/live-order-path-fix-20260913` and push the branch.
- [ ] Step 3: Create an immutable release from the exact pushed SHA on the VPS, preserve the current release, and run the release preflight.
- [ ] Step 4: Apply current-runtime wiring so shared budget and Q102 state/cache paths are deploy-owned and group-readable as required.
- [ ] Step 5: Read-only reconcile positions, open orders, pending state, Kill Switch, shared risk, and Margin Guard before restart.
- [ ] Step 6: Restart only the affected shared-risk/Q102/V12/PENGU/V52 services sequentially, with no order or cancel test.
- [ ] Step 7: Verify active/running, current SHA, fresh heartbeats, no restart loop, no lock/permission errors, watchdog PASS, and zero trading mutations.

### Task 5: Final verification

- [ ] Step 1: Query recent logs for `ASTER_GLOBAL_RATE_BUDGET_LOCK_TIMEOUT`, atomic rename `ENOENT`, `EACCES`, 429/418, and restart-loop errors.
- [ ] Step 2: Confirm natural signal states and that no strategy was force-fired.
- [ ] Step 3: Report the deployed SHA, tests, service states, safety gates, account state, and any residual historical errors without claiming a clean history if the persisted audit trail retains old failures.
