# FET VOL10 RET15 LIVE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the researched FET `VOL10_RET15` anti-overheat entry guard to the current Production FET BRK48 runner, verify it with regression tests and runtime checks, and deploy it as an immutable VPS release without changing exits, protection, risk, or other runners.

**Architecture:** Keep the existing FET BRK48 signal, sizing, shared-risk, resident STOP, profit-floor, exit, cooldown, and ownership paths unchanged. Add two inclusive upper-bound checks to the canonical FET signal builder (`volumeRatio <= 10` and `return72h <= 0.15`), expose the same contract in production target/health observability, then release from a clean commit based on the current Production SHA.

**Tech Stack:** TypeScript, Node test runner/tsx, JSON runtime contract, shell/systemd on the XServer VPS, GitHub Actions.

**Spec:** `reports/fet-brk48-bt-20261012/comparison.md` and the current FET runtime contract in `config/fetBrk48Runtime.ts`.

## Global Constraints

- Preserve FET LONG / BRK48 / 48h breakout / 72h volume median / 24h hold / 24h cooldown.
- Preserve maximum Gross `1.0x`, 5x Cross, shared risk, account lock, quantity gates, idempotency, and resident protection.
- Add only the researched entry upper bounds: `volumeRatio <= 10` and `return72h <= 15%`.
- Do not alter the hard stop, profit-floor, exit, preemption, or any other runner.
- Existing positions and protective orders must not be canceled, recreated, flattened, or resized for this deployment.
- Production release must use an exact Git commit SHA; no dirty-worktree deployment or VPS hotfix.
- If the operator activation artifact is missing, stale, or SHA-inconsistent, keep the runner fail-closed and report the exact blocker.

## Review Focus

- Boundary values: exactly `volumeRatio=10` and `return72h=0.15` remain eligible; values above reject. Test in Task 1.
- No look-ahead: the cap uses only the completed signal bar and completed 72h boundary. Test in Task 1.
- Existing protection/exit behavior: the filter only affects new entry admission. Preserve existing runner tests in Task 3.
- Contract drift: target JSON, health snapshot, and runtime config expose the same two thresholds. Test in Task 2.
- Runtime lineage and state safety: current symlink, release marker, operator artifact, Aster positions/orders, and other runners remain coherent. Verify in Task 4.

---

### Task 1: Add failing VOL10/RET15 signal regression tests

**Files:**
- Modify: `tests/fet-brk48-signal.test.ts`
- Test: `tests/fet-brk48-signal.test.ts`

**Interfaces:**
- Consumes: `buildFetBrk48Signal`, `FetBrk48Bar`, and the existing FET signal fixture.
- Produces: regression coverage for upper-bound admission and exact-boundary behavior.

- [ ] **Step 1: Write tests for an over-volume candidate, an over-return candidate, and both exact boundaries.**
- [ ] **Step 2: Run `npx tsx --test tests/fet-brk48-signal.test.ts` and confirm the new tests fail because the current signal builder has no upper bounds.**

### Task 2: Implement the canonical VOL10_RET15 contract and observability

**Files:**
- Modify: `config/fetBrk48Runtime.ts`
- Modify: `lib/fet-brk48-signal.ts`
- Modify: `docs/production/current-live-target.json`
- Modify: `scripts/ops/root/disdex-runner-health-snapshot-current.mjs`
- Test: existing FET contract/observability tests plus Task 1 tests

**Interfaces:**
- Consumes: Task 1’s failing boundary tests.
- Produces: `FET_BRK48_RESIDUAL.maximumVolumeRatio = 10` and `maximumReturn72h = 0.15`, enforced by the canonical signal builder and exposed in runtime telemetry.

- [ ] **Step 1: Add the two exact upper-bound fields to the runtime contract and current-live target.**
- [ ] **Step 2: Add minimal fail-closed checks after the existing minimum gates and before signal return.**
- [ ] **Step 3: Expose the same values in FET health telemetry without changing order or position behavior.**
- [ ] **Step 4: Run the targeted tests and confirm they pass.**

### Task 3: Full local verification and release preparation

**Files:**
- Modify only files from Tasks 1–2 unless a test reveals a direct contract defect.
- Create: `docs/implementation/FET_VOL10_RET15_PRODUCTION_AMENDMENT_20261013.md`

- [ ] **Step 1: Run FET signal, runner, preemption, target/readiness, and observability tests.**
- [ ] **Step 2: Run TypeScript typecheck and the relevant production build.**
- [ ] **Step 3: Run `git diff --check` and inspect the diff to confirm no other strategy changed.**
- [ ] **Step 4: Record the BT limitations: Aster data begins 2026-01-09, funding is not included, and the BT is not L2 fill parity.**
- [ ] **Step 5: Commit the implementation and push the dedicated branch to GitHub.**

### Task 4: VPS preflight, immutable deployment, and LIVE verification

**Files:**
- No VPS hotfixes; use the exact GitHub commit archive/object.

- [ ] **Step 1: Read-only preflight current release, marker, operator artifact, FET state, Aster positions/open orders/protection, Shared Risk, Margin Guard, Kill Switch, rate budget, lock, disk, and all runner SHAs.**
- [ ] **Step 2: Build a new immutable release from the pushed SHA and verify marker/source SHA.**
- [ ] **Step 3: Verify the operator activation artifact matches the new SHA; if not, stop fail-closed with `BLOCKED_OPERATOR_LIVE_ACTIVATION_REQUIRED`.**
- [ ] **Step 4: Switch/restart only the FET service through the existing systemd wiring, preserving existing positions and protective orders; do not send a test order.**
- [ ] **Step 5: Verify runtime config, FET state heartbeat, service status/NRestarts, Aster read-back, and no unexpected order/cancel/position mutation.**
- [ ] **Step 6: Report exact Production SHA, rollback SHA, effective `VOL10_RET15`, FET status, and any remaining blocker.**
