# PR #302 route-neutral deployment approval implementation plan

> **For the implementer:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task-by-task.

**Goal:** Keep GitHub Actions as the formal GPT deployment adapter while preserving Codex direct SSH/operator-helper deployment, with one route-neutral owner approval and safety contract.

**Architecture:** The signed approval and canonical multi-SHA plan are the shared contract. `GITHUB_ACTIONS` and `CODEX_SSH` are signed route identifiers and adapters only; neither adapter may broaden scope or bypass the root-owned helper. The plan binds the fixed XServer target, operator target, runner SHA map, UI/monitor SHA, exact scope, and explicit `ordersEnabled`. Shared Risk-only, monitoring, HP-only, and rollback scopes default to and enforce no new order permission. LIVE remains blocked until the independently installed root helper, protected environment/owner approval, rollback, and production evidence gates are verified.

**Tech Stack:** Python 3 standard library, Bash/GitHub Actions, Ed25519 via OpenSSL, existing root-owned VPS operator helper contract.

## Task 1: Add failing tests for route and order-permission separation

**Files:**
- Modify: `tests/test_disdex_owner_approval.py`
- Modify: `tests/test_disdex_deployment_plan.py`
- Add: `tests/test_disdex_codex_ssh_deploy.py`

**Steps:**
1. Add tests that a signed grant is bound to `GITHUB_ACTIONS` or `CODEX_SSH`, fixed deployment target, fixed operator target, and exact `ordersEnabled` value.
2. Add tests that Shared Risk-only rejects `ordersEnabled=true`, while an order-capable scope requires explicit signed authorization and does not infer it from the route.
3. Add tests that the Codex adapter accepts only the fixed target host and constructs the fixed root-helper command; arbitrary shell text, host, or route must be rejected.
4. Run the focused tests and confirm they fail against the current implementation.

## Task 2: Implement the shared authorization contract

**Files:**
- Modify: `scripts/ops/deploy/disdex_owner_approval.py`
- Modify: `scripts/ops/deploy/disdex_deployment_plan.py`

**Steps:**
1. Version the approval schema and add route, deployment target, operator target, and explicit order permission to the canonical signed payload.
2. Validate exact route values, exact XServer target, exact operator target, boolean order permission, time window, nonce, signature, and scope-specific no-order restrictions.
3. Add `ordersEnabled` to the canonical plan and include it in the plan hash; reject mismatches or invalid scope/order combinations before any deployment.
4. Keep nonce replay protection root-side and preserve fail-closed behavior; do not add a local bypass or fallback acceptance path.
5. Run the focused tests and confirm they pass.

## Task 3: Implement the two execution adapters

**Files:**
- Modify: `.github/workflows/disdex-unified-production-deploy.yml`
- Modify: `.github/workflows/disdex-owner-deploy-ci.yml`
- Add: `scripts/ops/deploy/disdex_codex_ssh.py`
- Add: `tests/test_disdex_codex_ssh_deploy.py`

**Steps:**
1. Fix the Actions adapter to verify `GITHUB_ACTIONS`, target, operator target, plan hash, and explicit order permission, then call only the fixed root helper.
2. Add a Codex adapter that takes a local identity/known-host file and signed token from stdin, validates the exact host/SHA/scope/plan inputs, and invokes only the fixed root helper with `CODEX_SSH`; never accept a shell command or print secret material.
3. Keep the protected GitHub environment and owner review as an Actions-specific gate; retain the same root helper, venue/STOP/risk/pending/rollback gates for both routes.
4. Keep old write-capable workflows inventoried but do not remove them until the replacement and rollback have been independently proven.
5. Run source-contract CI checks and the focused tests.

## Task 4: Rewrite the staged runbook and policy boundary

**Files:**
- Modify: `docs/implementation/DISDEX_UNIFIED_OWNER_APPROVAL_DEPLOYMENT_20261030.md`

**Steps:**
1. Document separate GPT/Actions and Codex/direct-SSH procedures using the same signed approval and safety contract.
2. Explicitly distinguish Shared Risk approval from new-order authorization and state that the former does not imply the latter.
3. Document owner password handling, secret boundaries, exact SHA/runner pin/scope/target binding, fail-closed rollback, and legacy-path retirement criteria.
4. State that this PR is source/CI ready only; no helper installation, operator activation, VPS change, order, STOP change, Kill Switch change, or LIVE claim is made.

## Task 5: Verify and publish

**Steps:**
1. Run focused Python tests, source-contract checks, legacy-path read-only inventory, and repository-appropriate static checks.
2. Inspect the final diff for accidental secrets, arbitrary SSH commands, dynamic Gross/order changes, or production mutations.
3. Commit the changes on the isolated PR branch and push the branch; do not deploy to VPS.
4. Re-read PR #302 CI and report `SOURCE_READY_NOT_LIVE` unless the owner helper/environment/production evidence gates are independently verified.
