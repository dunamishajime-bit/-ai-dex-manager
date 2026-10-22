# FET Scoped Operator Activation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Activate the already-tested FET BRK48 trailing-stop release for the FET runner only, without rebinding or restarting the other production runners.

**Architecture:** Add a runner-scoped operator activation path for `FET_BRK48_RESIDUAL`; keep Shared Risk, Margin Guard, Kill Switch, account lock, pending exposure, and Aster rate budget on their existing shared paths. Bind the FET systemd unit and its health/watchdog checks to the scoped artifact and exact FET release SHA.

**Tech Stack:** TypeScript/Node, systemd unit templates, root-owned JSON activation artifact, existing FET state migration and signed read-only audit tooling.

**Spec:** Existing FET trailing-stop production plan plus the operator-gate contract in `scripts/ops/root/disdex-live-operator-activation-gate.mjs`.

## Global Constraints

- Do not modify the common operator artifact or the common `current` symlink.
- Do not change PENGU, Q102, V52, HYPE, Idle, V12, Shared Risk, Margin Guard, Kill Switch, account lock, pending registry, or rate-budget semantics.
- FET remains `FET_BRK48_RESIDUAL`, Gross `1.0x`, 5x Cross, and uses the existing state path.
- No test order, manual close, protection deletion, or forced position change.
- A scoped artifact must be root-owned, non-writable by non-root, exact-SHA bound, and approved only for FET.

## Review Focus

- A FET-only artifact must not enable another runner: test the approved-runner list and exact SHA.
- FET must still use shared risk controls: test that the service environment keeps the shared paths.
- A mixed release must not create a global SHA mismatch: test health/coherence scope and leave common current unchanged.
- FET state migration must preserve flat/position/pending state: test the existing migration contract before activation.
- STOP protection must remain untouched during activation: verify signed read-only venue state and zero mutation counts.

### Task 1: Scoped gate contract

**Files:**
- Modify: `scripts/ops/root/disdex-live-operator-activation-gate.mjs`
- Test: `tests/operator_activation_hardening.test.ts`

- [x] Confirm the existing gate is already path-aware: it validates the supplied activation path, exact SHA, target, root-owned metadata, and `approvedRunners`.
- [x] Add a regression test proving a scoped artifact with `approvedRunners=["FET_BRK48_RESIDUAL"]` is accepted for FET and rejected for Q102.
- [x] Keep the common gate unchanged; the scoped path is enforced by the FET unit and runtime wiring.
- [ ] Run the focused test and the existing operator gate tests after the final commit.

### Task 2: FET systemd and runtime wiring

**Files:**
- Modify: `ops/systemd/disdex-fet-brk48@.service`
- Modify: `scripts/ops/root/disdex-current-runtime-wiring`
- Test: `tests/fet-brk48-trailing-contract.test.ts`, `tests/test_runtime_wiring_script.py`

- [x] Add contract assertions for the FET-specific activation path and unchanged shared risk/account paths.
- [x] Add the scoped activation environment/path and make FET preflight use it while preserving all shared safety paths.
- [x] Add mixed-SHA coherence coverage and a FET-scoped wiring self-test.
- [ ] Run focused systemd/wiring tests and TypeScript checks after the final commit.
- [ ] Commit the wiring change.

### Task 3: Scoped artifact and deployment evidence

**Files:**
- Create: `docs/implementation/FET_SCOPED_OPERATOR_ACTIVATION_20261022.md`
- Modify: `docs/research/results/fet-trailing-stop-production-20261022/manifest.json`

- [ ] Record exact release SHA, rollback SHA, artifact path/schema, and explicit non-target runners.
- [ ] Add an immutable release/staging verification command and zero-mutation read-only audit checklist.
- [ ] Run manifest/hash checks and commit the evidence.

### Task 4: CI, VPS stage, and FET-only activation

- [ ] Run the complete focused and regression checks, then push and verify CI.
- [ ] Stage the new immutable release on VPS without changing `current`.
- [ ] Perform signed read-only venue/state/risk/lock/rate audits.
- [ ] Create the FET-only root-owned activation artifact through the approved path.
- [ ] Migrate FET state if needed, start only the FET unit, and verify no other service/PID/SHA changed.
- [ ] Re-run signed read-only audit, health, watchdog, and rollback checks.

## Completion Criteria

- FET unit is active on the exact new SHA and its scoped artifact is valid.
- Common artifact, common current symlink, and all non-FET runner states remain unchanged.
- Shared Risk, Margin Guard, Kill Switch, account lock, pending exposure, and rate budget remain active and shared.
- Aster positions/orders/protective STOPs reconcile and mutation counters are zero during deployment.
- Only after fresh verification may the result be reported as FET-scoped LIVE; otherwise report the exact blocker.
