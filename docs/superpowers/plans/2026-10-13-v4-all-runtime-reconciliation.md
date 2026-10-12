# V4 and All-Runner Runtime Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the V4 repeated fail-closed stops, unify all active production and safety runtime references, and carry the approved FET `VOL10_RET15` filter into the unified LIVE release without creating an unprotected or duplicate order path.

**Architecture:** Use the V4 release as the integration base, merge the already tested FET filter into it, and make generated runtime wiring the single source for runner, health, watchdog, and coherence SHA pins. State migration is backup-first and read-only reconciliation precedes each service start.

**Tech Stack:** TypeScript/tsx runners, Node test runner, shell/systemd runtime wiring, Python read-only safety checks, GitHub Actions, XServer VPS over SSH.

**Spec:** `docs/superpowers/specs/2026-10-13-v4-all-runtime-reconciliation.md`

## Global Constraints

- Preserve the dirty root worktree; all code changes stay in this dedicated worktree.
- Do not change V12/PENGU/Q102/V52/HYPE/Idle signals, sizing, Gross, or risk limits.
- The only strategy behavior change is FET `volumeRatio <= 10` and `return72h <= 15%`, with exact boundaries accepted.
- Do not send synthetic, test, manual, or forced market orders.
- Preserve existing positions and protective orders; do not force-flat a non-flat account.
- Fail closed on runtime SHA, state ownership, peer attestation, lock, rate-budget, margin, or protection uncertainty.
- Deploy only a GitHub-pushed exact SHA as an immutable release.

## Review Focus

- Peer SHA drift: V4 must not oscillate or restart when a peer uses a different release; the preflight must reject before order mutation.
- State ownership: deploy-owned `0600` state and `0700` parent directories must be readable by every intended runner and never by an unrelated user.
- Shared lock contention: transient lock contention must remain a bounded observation/NOOP, not a crash loop or order mutation.
- Safety-daemon pins: health, watchdog, notifier, and coherence must inspect the same runtime SHA as the trading units.
- Recovery state: a stopped/failed unit must be migrated from a backup and verified against Aster before restart; a stale state must never be deleted.

### Task 1: Capture and reproduce the V4/runtime failures

**Files:**
- Test: `tests/v4-all-runtime-reconciliation.test.ts`
- Test: `tests/ops-v4-runtime-wiring-contract.test.mjs`

**Interfaces:**
- Consumes the V4 peer attestation, state ownership, and generated runtime-wiring contracts.
- Produces deterministic assertions for peer SHA mismatch, state access preflight, and all-daemon SHA coherence.

- [ ] Write failing tests for the observed failure classes: stale FET peer SHA, unreadable FET state, and health/watchdog pin drift.
- [ ] Run the focused tests and record the expected RED results.
- [ ] Do not change production code in this task.
- [ ] Re-run the tests after only test setup to confirm the failure is real.

### Task 2: Integrate FET `VOL10_RET15` into the V4 release

**Files:**
- Modify: `config/fetBrk48Runtime.ts`
- Modify: `lib/fet-brk48-signal.ts`
- Modify: `docs/production/current-live-target.json`
- Modify: `scripts/ops/root/disdex-runner-health-snapshot-current.mjs`
- Test: `tests/fet-brk48-signal.test.ts`
- Test: `tests/fet-vol10-ret15-contract.test.ts`

**Interfaces:**
- Consumes the V4 base release and the previously verified FET contract from commit `acedffdad52bc6a4b7bb5992122be2ef6b9a2cda`.
- Produces one combined release in which the FET signal, readiness target, and health telemetry all report `10` and `0.15`.

- [ ] Apply the FET change to the V4 base without changing other strategy contracts.
- [ ] Run FET tests RED before the implementation change when the boundary assertions are absent.
- [ ] Implement the minimal canonical config/signal/telemetry change.
- [ ] Run FET tests GREEN and verify exact-boundary behavior.

### Task 3: Repair runtime wiring and peer/state ownership contracts

**Files:**
- Modify: `scripts/ops/root/disdex-current-runtime-wiring`
- Modify: `deploy/systemd/disdex-v12-v4@.service`
- Modify: `deploy/systemd/disdex-fet-brk48@.service`
- Test: `tests/ops-v4-runtime-wiring-contract.test.mjs`
- Test: `tests/v4-all-runtime-reconciliation.test.ts`

**Interfaces:**
- Consumes the combined release SHA from Task 2.
- Produces generated environment/drop-in contracts that pin all runner, health, watchdog, notifier, and coherence references to that SHA and prepare deploy-owned FET/Q102 state paths before reads.

- [ ] Add regression assertions for one SHA across peer unit names, expected SHA pins, state path ownership preparation, and safety-daemon release roots.
- [ ] Run the wiring tests RED against the stale/mixed contract.
- [ ] Implement the smallest wiring correction; do not weaken the peer or operator gate.
- [ ] Run wiring and V4 lifecycle tests GREEN.

### Task 4: Validate all runner state and recovery without orders

**Files:**
- Use official migration/reconciliation scripts; no ad-hoc state deletion.
- Add/modify only recovery tests if a reproducible code defect is found.

**Interfaces:**
- Consumes the combined release and all current state files.
- Produces timestamped backups, exact runtime SHA migration evidence, and a read-only Aster reconciliation report.

- [ ] Read-only recheck Aster positions, open orders, protective orders, Shared Risk, Margin Guard, Kill Switch, account lock, and rate budget.
- [ ] If non-flat, preserve positions and protections; do not proceed to a full start until ownership/readback is proven.
- [ ] Back up V12/V4, PENGU, Q102, V52, FET, HYPE, and Idle state before mutation.
- [ ] Migrate only states that are flat or proven to reconcile; verify owner/mode and runtime SHA.
- [ ] Verify every runner's signal→gate→reservation→execution adapter path in no-order/self-test mode.

### Task 5: Run local and GitHub verification

- [ ] Run focused V4/FET/state/wiring tests and read every result.
- [ ] Run critical TypeScript compilation and production order-path tests.
- [ ] Run relevant Python safety/watchdog tests.
- [ ] Run build/typecheck; classify unrelated pre-existing failures explicitly.
- [ ] Commit and push the combined release branch.
- [ ] Confirm GitHub remote SHA exact match and Actions has real successful jobs, not `jobs=0`.

### Task 6: Immutable VPS release and controlled cutover

- [ ] Build and checksum a release archive from the exact pushed SHA.
- [ ] Create an immutable release and marker; do not overwrite existing releases.
- [ ] Generate current-runtime wiring/drop-ins for the one release SHA.
- [ ] Keep rollback release recorded and untouched.
- [ ] Stop/restart only through the official systemd order and only after state/protection preflight.
- [ ] Start V4, FET, Q102, PENGU, V52, HYPE, Idle/Residual, Shared Risk, Margin Guard, and required safety daemons only after all gates pass.

### Task 7: Post-deploy verification

- [ ] Confirm all required units are active/running, exact SHA, expected PID, and `NRestarts=0`.
- [ ] Confirm no old SHA active process, duplicate runner, stale pending, or manual review remains.
- [ ] Confirm Aster positions/open orders/protective orders and zero deployment mutations.
- [ ] Observe multiple normal cycles for V4/FET/Q102 and confirm bounded lock/rate-budget behavior.
- [ ] Confirm health snapshot is HEALTHY, `newOrdersAllowed=true` only when all gates are actually healthy, and HP/runtime observability matches.
- [ ] Report any remaining pre-existing failures separately; do not claim full LIVE verification if any required gate remains unresolved.
