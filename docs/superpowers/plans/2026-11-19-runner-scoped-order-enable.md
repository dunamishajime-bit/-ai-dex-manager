# Runner-scoped order-enable under GLOBAL HOLD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a fail-closed, Runner-specific order-enable path for the non-HYPE STABLE4 runners while keeping the canonical GLOBAL `HOLD_PROTECTED` active and preventing one Runner's permit from authorizing another Runner.

**Architecture:** A Root-owned permit is bound to one Runner, one immutable runtime SHA, one plan hash, one scope, one formal operation, one Owner approval nonce, and the exact GLOBAL HOLD digest. A Root helper creates the permit and a read-only runtime overlay for the common Kill Switch module; the overlay permits a new entry only for that Runner while the GLOBAL HOLD remains active. Existing exits, protective STOPs, Shared Risk, Gross and Margin checks remain unchanged. HYPE continues using its already-installed H48-specific permit path.

**Tech Stack:** TypeScript permit validator, Python Root helper, GitHub Actions `workflow_dispatch`, existing HP approval bridge, existing Ed25519 approval verifier, Node/Python contract tests.

**Spec:** `docs/superpowers/specs/2026-11-18-stable4-h48-hype-order-enable-design.md` plus the Owner requirement for Runner-specific approval, SHA/plan/scope pinning, Shared Risk/Gross/Margin/STOP revalidation, Runner-only permit, formal GitHub Actions/Root cutover, and no cross-Runner propagation.

## Global Constraints

- Keep canonical GLOBAL `HOLD_PROTECTED/GLOBAL/active:true` unchanged.
- Do not modify strategy parameters, entry/exit logic, STOP policy, Shared Risk limits, Gross limits or Margin Guard semantics.
- Do not place, cancel, close, replace or test any exchange order.
- Use the official HP approval bridge, protected `disdex-production` environment, Root helper and immutable release path.
- HYPE's existing `HYPE_STABLE4_H48_TIME_ONLY_LIVE` permit remains the only HYPE order-enable path; do not replace it in this plan.
- A missing, expired, malformed, mismatched or cross-Runner permit must fail closed before any executor method can be called.
- Unrelated untracked `apps/` files must not be staged.

## Review Focus

- A permit for Runner A must be rejected by Runner B even when the SHA and GLOBAL HOLD are otherwise valid.
- A changed GLOBAL HOLD must invalidate an existing permit before entry execution.
- A stale heartbeat, unhealthy Margin Guard, tripped/stale Shared Risk, active pending exposure or missing protective STOP evidence must block Root publication.
- Old `CODEX_SSH`/broad activation artifacts must not be treated as fresh formal GitHub Actions approvals.
- Installing or rolling back one Runner's overlay must not rewrite GLOBAL HOLD or any other Runner's overlay/permit.

### Task 1: Runner permit contract

**Files:**
- Create: `lib/runner-order-permit.ts`
- Test: `tests/runner-order-permit.test.ts`

**Interfaces:**
- Produces `RUNNER_ORDER_PERMIT_SCHEMA`, `RunnerOrderPermitInput`, `RunnerOrderPermitContext`, and `validateRunnerOrderPermit(value, context)`.
- `validateRunnerOrderPermit` returns the validated permit or throws a stable reason string; it reads no network state and performs no mutation.

- [ ] Write failing tests for exact schema/source/plan/scope/operation/runner binding, expiry, root-file metadata, exact GLOBAL HOLD digest/provenance, zero mutation counters, missing permit, wrong Runner and replayed nonce.
- [ ] Run `npx tsx tests/runner-order-permit.test.ts` and observe the expected missing-module failure.
- [ ] Implement the minimal validator and canonical JSON/digest helpers.
- [ ] Re-run the focused test and the existing HYPE permit tests.
- [ ] Commit `feat: add runner-scoped order permit contract`.

### Task 2: Root overlay transaction

**Files:**
- Create: `scripts/ops/deploy/disdex_runner_scoped_order_enable.py`
- Create: `scripts/ops/root/disdex-runner-scoped-order-enable`
- Create: `scripts/ops/root/install-disdex-runner-scoped-order-enable`
- Test: `scripts/ops/test_disdex_runner_scoped_order_enable.py`

**Interfaces:**
- Root helper accepts `--runner`, `--source-sha`, `--scope`, `--operation`, `--plan-sha256`, `--approval-id`, `--run-id`, `--preflight-readonly|--execute|--rollback`, and a signed approval token on stdin.
- It uses a static map for `V12_V4`, `PENGU_V8`, `QUALITY102_CAUSAL_V1`, `V52`, `FET_BRK48_RESIDUAL`, and `IDLE_PRIORITY_SHORT`; HYPE is rejected with `USE_HYPE_H48_GATE`.
- It publishes only `/etc/disdex/runner-order-enable/<runner>/<sha>.order-enable.json`, a Root-owned common Kill Switch overlay, an EnvironmentFile and a per-unit systemd drop-in. GLOBAL HOLD bytes are never rewritten.

- [ ] Write failing pure tests for approval identity, current unit/source matching, Shared Risk 7.5%, healthy Margin Guard, released pending exposure, signed read-only zero-mutation evidence, overlay anchor/hash, staged publication and rollback.
- [ ] Run the focused Python tests and observe missing-helper failure.
- [ ] Implement the Root helper with double preflight, execution lock, atomic publication, exact rollback, no venue mutation commands, and per-Runner-only paths.
- [ ] Re-run focused Python tests and source forbidden-mutation checks.
- [ ] Commit `feat: add root runner-scoped order-enable transaction`.

### Task 3: Formal HP/GitHub Actions operation

**Files:**
- Modify: `lib/deploy-approval-token.ts`
- Modify: `app/api/system/deploy-approval/route.ts` and the protected request workflow grammar as needed
- Create: `.github/workflows/disdex-runner-scoped-order-enable.yml`
- Test: `tests/runner-scoped-order-enable-workflow.test.mjs`
- Test: `tests/deploy-approval-operation-separation.test.mjs` (extend existing assertions)

**Interfaces:**
- Add only scoped operations for the six non-HYPE Runner scopes; do not add a `FULL_PROJECT` alias to this workflow.
- Workflow is `workflow_dispatch` on `master`, protected environment `disdex-production`, exact Runner/SHA/plan/scope/operation inputs, official HP redemption, Root helper hash verification, Root preflight, then execute.

- [ ] Write failing contract tests that reject `FULL_PROJECT`, wrong scope, wrong operation, wrong SHA/plan, non-master refs, non-owner actor and any order/cancel/test-order command.
- [ ] Run the tests and observe missing operation/workflow failures.
- [ ] Implement operation policy bindings and the protected workflow.
- [ ] Run the workflow contract tests and the existing deployment approval self-tests.
- [ ] Commit `feat: add formal runner-scoped order-enable workflow`.

### Task 4: CI, release evidence and production preflight

**Files:**
- Modify: relevant CI workflow(s) to run TypeScript, Python, workflow-contract and forbidden-mutation checks.
- Create: `docs/implementation/RUNNER_SCOPED_ORDER_ENABLE_20261119.md`

- [ ] Run `npx tsc --noEmit`, focused Node/Python tests, and the complete relevant deployment-gate suite.
- [ ] Push the branch and wait for GitHub Actions success on the exact SHA.
- [ ] Generate the six exact HP approval requests only after the workflow/Root helper hashes are fixed; do not reuse old `CODEX_SSH` or broad approvals.
- [ ] For each fresh approved request, run the formal workflow one Runner at a time, preserving GLOBAL HOLD and verifying signed GET, Shared Risk, Gross, Margin, STOP ownership, heartbeat, PID, SHA and zero mutation counters.
- [ ] Observe at least three natural decision cycles per enabled Runner; do not manufacture a signal or order.
- [ ] Push the final evidence and record any Runner that remains blocked with its exact fail-closed reason.

