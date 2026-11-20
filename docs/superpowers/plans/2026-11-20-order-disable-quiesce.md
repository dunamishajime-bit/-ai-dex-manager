# STABLE4 Order-Disable Quiesce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a formally approved, monitor-only quiesce operation that atomically changes the Root-owned unified deployment plan from `ordersEnabled=true` to `ordersEnabled=false` without touching venue orders, positions, STOPs, GLOBAL HOLD, Runner pins, or systemd services.

**Architecture:** A small Root helper will verify an exact `ALL_RUNNERS_MONITOR_REFRESH` Owner token, protected GLOBAL HOLD, flat signed venue evidence, and an unchanged current-plan hash before an atomic metadata-only write. A reviewed GitHub Actions workflow will publish/redeem the exact request, run read-only preflight, execute the helper, and verify the resulting plan; the existing STABLE4 safety-repair workflow will then consume the now-disabled baseline. The helper will preserve a root-owned backup and restore it on any post-write failure.

**Tech Stack:** Python 3 Root helper, GitHub Actions, existing `disdex_owner_approval` verifier, existing signed Aster read-only diagnostic, Node/Python contract tests.

**Spec:** Existing STABLE4 safety-repair plan `docs/implementation/STABLE4_SAFETY_REPAIR_PLAN_20261120.json`, current blocker `CURRENT_PLAN_ORDERS_NOT_DISABLED`, and the formal `ALL_RUNNERS_MONITOR_REFRESH` approval contract.

## Global Constraints

- Orders, cancels, position changes, STOP amendments, leverage, margin, and GLOBAL HOLD clear are forbidden; every result must report zero mutations.
- The exact Owner approval must be `ALL_RUNNERS_MONITOR_REFRESH`, `FULL_PROJECT`, `ordersEnabled=false`, exact target SHA and plan SHA, via GitHub Actions.
- The helper may only change `/var/lib/disdex/unified-deploy/current-plan.json`, and only the single boolean `ordersEnabled` from `true` to `false`.
- GLOBAL HOLD must remain byte-identical, active, `HOLD_PROTECTED`, `GLOBAL`, and match its pinned digest.
- Signed venue GETs must prove zero nonzero positions and zero open orders before and after the metadata write.
- No direct VPS SSH or manual file editing is allowed; deployment is through a reviewed GitHub Actions workflow.

## Review Focus

- A stale or changed current-plan file must fail CAS without overwriting it.
- An Owner token with `ordersEnabled=true`, wrong operation, scope, SHA, or plan must fail before any write.
- Non-flat venue evidence or changed GLOBAL HOLD must fail and leave the plan unchanged.
- A filesystem write or post-write verification failure must restore the exact original bytes and metadata.
- Retrying the same exact monitor approval must not create a second mutation or broaden the scope.

---

### Task 1: Lock the helper contract with failing tests

**Files:**
- Create: `tests/test_disdex_order_disable_quiesce.py`
- Create: `scripts/ops/deploy/disdex_order_disable_quiesce.py`

**Interfaces:**
- Produces `validate_inputs(...)`, `disable_orders_flag(...)`, and CLI modes `--preflight-readonly` / `--execute-approved` for the workflow.

- [ ] **Step 1: Write failing tests**

  Add tests for exact-token contract, single-boolean plan transition, CAS mismatch rejection, and rollback on post-write verification failure. Tests must assert zero mutation counters and that non-`ordersEnabled` fields remain byte-for-byte semantically unchanged.

- [ ] **Step 2: Run tests and verify RED**

  Run `python -m pytest tests/test_disdex_order_disable_quiesce.py -q`; expect failure because the helper does not yet exist.

- [ ] **Step 3: Implement the minimal Root helper**

  Verify the exact token with `orders_enabled=False`; validate root-owned, non-symlink regular files; snapshot current-plan bytes/stat/hash and protected HOLD bytes/hash; perform three signed GETs through the existing read-only diagnostic; atomically write a copy with only `ordersEnabled=false`; fsync, re-read, verify the exact change, and restore the snapshot on any exception. Never call a venue mutation API or systemctl.

- [ ] **Step 4: Run tests and verify GREEN**

  Run the focused test file, then the repository's existing safety-repair and approval contract tests.

- [ ] **Step 5: Commit the helper and tests**

  Commit as `feat(stable4): add owner-approved order-disable quiesce helper`.

### Task 2: Add the formal workflow and CI contract

**Files:**
- Create: `.github/workflows/disdex-stable4-order-disable-quiesce.yml`
- Create: `tests/test_disdex_stable4_order_disable_workflow.py`
- Modify: `.github/workflows/disdex-hp-deploy-approval-ci.yml` only if the existing workflow contract index requires registration.

**Interfaces:**
- Consumes the helper CLI from Task 1 and the existing HP bridge request/redeem API.
- Produces a workflow-dispatch operation with exact `approval_id`, `target_sha`, and `plan_sha256`, plus `preflight`/`execute` mode.

- [ ] **Step 1: Write failing workflow contract tests**

  Assert the workflow is master-only, uses `disdex-production`, requires `ALL_RUNNERS_MONITOR_REFRESH`/`FULL_PROJECT`/`ordersEnabled=false`, uses the Root SSH secrets, never invokes exchange mutation commands, and cleans temporary token/key material.

- [ ] **Step 2: Run tests and verify RED**

  Run `python -m pytest tests/test_disdex_stable4_order_disable_workflow.py -q`; expect missing-file failure.

- [ ] **Step 3: Implement the workflow**

  Validate exact candidate/plan values, redeem the HP approval, upload the reviewed helper, run read-only preflight, execute only in `execute` mode, and perform a postflight read-only plan/HOLD/venue check. Keep the workflow fail-closed and report all mutation counters as zero.

- [ ] **Step 4: Run CI tests and static checks**

  Run the workflow contract tests, Python compilation, YAML/source assertions, and existing approval tests.

- [ ] **Step 5: Commit and push**

  Commit as `feat(stable4): add formal order-disable quiesce workflow`, push, and wait for CI.

### Task 3: Publish exact approval and execute quiesce

**Files:** No source changes.

- [ ] **Step 1: Publish one exact HP approval request**

  Use the existing protected-request path with the exact workflow target SHA and plan SHA, operation `ALL_RUNNERS_MONITOR_REFRESH`, scope `FULL_PROJECT`, and `ordersEnabled=false`.

- [ ] **Step 2: Confirm the Owner signature**

  Redeem only after the HP approval record is `APPROVED`; do not accept a chat message as a cryptographic substitute.

- [ ] **Step 3: Run preflight, then execute**

  Run the workflow in `preflight` first. If every gate passes, run `execute` with the same exact approval; otherwise leave the VPS unchanged and report the blocker.

- [ ] **Step 4: Verify the quiesced baseline**

  Confirm current-plan `ordersEnabled=false`, unchanged pins/HOLD digest, flat venue, zero mutation counters, and no service/order changes.

### Task 4: Re-run the existing STABLE4 safety repair

**Files:** No source changes unless the preceding workflow exposes a contract defect.

- [ ] **Step 1: Reuse the bounded exact monitor approval if still valid**

  Use the existing bounded retry rule only for the same monitor-only operation, exact target SHA, and exact plan SHA.

- [ ] **Step 2: Run formal safety-repair preflight and execute**

  Run `disdex-stable4-safety-repair-cutover.yml` through GitHub Actions; do not clear GLOBAL HOLD or enable orders.

- [ ] **Step 3: Verify post-cutover evidence**

  Confirm V52/Q102 target SHA, three heartbeat cycles, V52 restart count stable, Q102 freshness, old-generation exclusion, unchanged HOLD digest, three signed GETs, and zero mutation counters.

### Task 5: Final audit and handoff

- [ ] Confirm current release, Runner PID/systemd state, plan/pin hashes, no duplicate Writer, and HP/VPS status convergence through existing read-only audits.
- [ ] Commit/push final evidence only; do not expose credentials or tokens.
- [ ] Report any remaining order-enable authorization separately; this plan only establishes the safe monitor-only baseline and safety repair.
