# STABLE4 Monitor-Only Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the approved `ordersEnabled=false` STABLE4 safety-repair cutover start genuinely non-order-capable V52 and Q102 monitor processes, then promote the immutable release through the formal GitHub Actions → Root path.

**Architecture:** Keep the existing order-capable systemd unit names and runner pins, but install transactionally managed, root-owned monitor-only drop-ins for the candidate generation. V52 uses its existing read-only monitor daemon; Q102 receives a read-only preflight monitor daemon that writes only signed-style heartbeat evidence. The cutover validates monitor identity, fresh cycles, zero mutations, GLOBAL HOLD immutability, and rolls back both drop-ins and runtime state on any failure. Order-enable remains a separate exact-SHA permit path.

**Tech Stack:** Python root cutover helper, TypeScript Q102 monitor entrypoint, systemd drop-ins, Python/Node contract tests, GitHub Actions.

**Spec:** `docs/implementation/STABLE4_SAFETY_REPAIR_PLAN_20261120.json`

## Global Constraints

- `ordersEnabled=false` throughout monitor-only cutover.
- GLOBAL `HOLD_PROTECTED/GLOBAL/active:true` bytes and SHA-256 remain unchanged.
- No order, cancel, position, leverage, margin, or STOP mutation.
- V52/Q102 target SHA and plan SHA are exact and immutable.
- Root changes are transactional and rollback-safe; old Runner generation is restored on failure.
- A later runner-scoped order-enable permit is required before any natural orders.

## Review Focus

- A monitor heartbeat must not be mistaken for order authority.
- A failed read-only preflight must not count as a healthy cycle.
- Existing systemd drop-ins must be preserved or restored exactly on rollback.
- Q102 state and V52 runtime state must remain read-only during monitor cycles.
- The standard Runner pin/service identity must remain exact while monitor mode is active.

---

### Task 1: Q102 read-only monitor runtime

**Files:**
- Create: `scripts/disdex-quality102-causal-v1-monitor.ts`
- Create: `tests/quality102-monitor-only.test.ts`
- Modify: `scripts/disdex-quality102-causal-v1-live-runner.ts` only if shared exports are needed

**Interfaces:**
- Consumes: `runQuality102CausalV1ReadOnlyPreflight` and the exact runtime SHA from the environment.
- Produces: a daemon entrypoint with `--once`/`--daemon` that writes only Q102 heartbeat/tick JSON with `newOrdersAllowed:false` and all mutation counters zero.

- [ ] Write a failing contract test proving the monitor entrypoint requires `QUALITY102_CAUSAL_V1_MONITOR_ONLY=true`, disables all live execution flags, uses the standard Q102 service identity, and contains no order/cancel/STOP call path.
- [ ] Run the test and observe the expected failure because the entrypoint does not exist.
- [ ] Implement the monitor loop around the existing read-only preflight; atomically write standard Q102 heartbeat and tick paths, including SHA, PID, service unit, timestamps, `MONITOR_ONLY`, `newOrdersAllowed:false`, and zero mutation counters. On read failure write a blocked heartbeat and keep the process fail-closed.
- [ ] Run the focused test and existing Q102 preflight/runner contract tests.

### Task 2: Transactional monitor-only systemd cutover

**Files:**
- Modify: `scripts/ops/deploy/disdex_stable4_safety_repair_cutover.py`
- Modify: `scripts/ops/test_disdex_stable4_safety_repair_cutover.py`
- Create: `tests/stable4-monitor-dropin-contract.test.mjs`

**Interfaces:**
- Consumes: Task 1 Q102 monitor entrypoint and the existing V52 `--monitor-only-daemon` implementation.
- Produces: candidate-bound monitor drop-ins for the existing V52/Q102 unit names, with exact rollback snapshots.

- [ ] Add failing tests for monitor drop-in content, zero-order environment flags, exact service identity, heartbeat validation, and restoration/removal on rollback.
- [ ] Run the tests and observe the expected failure.
- [ ] Implement root-owned drop-in creation before candidate start, resetting order-capable `ExecStartPre`/`ExecStart` and installing only read-only monitor commands. Snapshot any prior drop-in bytes/metadata and restore/remove them during rollback. Validate heartbeat SHA/unit/status/permission and require three observing cycles.
- [ ] Run the focused helper test, workflow contract test, Python compilation, and diff checks.

### Task 3: Candidate release and formal workflow binding

**Files:**
- Modify: `docs/implementation/STABLE4_SAFETY_REPAIR_PLAN_20261120.json` only if the monitor evidence contract needs a new pinned field
- Modify: `.github/workflows/disdex-stable4-safety-repair-candidate-ci.yml` as required for the new candidate
- Modify: `.github/workflows/disdex-stable4-safety-repair-cutover.yml` to bind the new exact candidate SHA and plan SHA

- [ ] Run all candidate CI checks and the full relevant local suite.
- [ ] Commit/push the candidate source and record its immutable SHA.
- [ ] Update the formal master workflow to accept only that exact candidate SHA and plan SHA; run CI and merge through the existing PR path.

### Task 4: Production monitor-only migration and evidence

- [ ] Reuse the existing `ALL_RUNNERS_MONITOR_REFRESH` approval only if its exact SHA/plan still match; otherwise issue one new exact request through the formal HP path.
- [ ] Dispatch the formal workflow on `master`, approve the protected `disdex-production` environment, and do not clear GLOBAL HOLD.
- [ ] Verify target PID/SHA/systemd identity, three observing heartbeat cycles, Q102 freshness via monitor heartbeat, V52 restart stability, signed GETs before/after, zero mutation counters, and unchanged HOLD digest.
- [ ] Keep order-enable disabled; report the separate runner-scoped permit requirement.

