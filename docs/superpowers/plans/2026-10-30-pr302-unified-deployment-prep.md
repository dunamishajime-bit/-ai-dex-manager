# PR #302 Unified Deployment Preparation

## Goal

Complete the technical preparation for PR #302 without changing Production, live orders, positions, protective stops, Kill Switch state, or existing Runner releases. Leave only owner-authenticated signing and final LIVE approval for the owner.

## Safety boundary

- Read-only against the VPS and Aster unless a repository-local dry-run explicitly proves no Production mutation.
- Do not create or activate owner-signed tokens, activation artifacts, or venue evidence.
- Do not change the VPS `current` symlink, systemd units, service enablement, Runner permissions, STOPs, positions, pending exposure, Gross, Shared Risk, Margin Guard, or Kill Switch.
- Keep PR #302 Draft.
- Preserve old deployment and emergency recovery paths until the new path is independently verified.

## Work items

1. Establish the PR/source baseline: remote HEAD, PR checks, branch diff, deployment scripts, tests, and current VPS/Production facts.
2. Audit the unified deployment contract and root helper: exact SHA/scope/route binding, canonical plan hash, runner map, orders flag, nonce, Writer mutual exclusion, root ownership, STOP/position safeguards, rollback, and three-cycle audit. Add only safe, testable fixes.
3. Prepare read-only VPS authentication inputs and evidence from measured state. Generate no owner activation artifact; distinguish staging evidence from Production evidence and record missing prerequisites.
4. Validate the Shared Risk-only candidate plan (`SHARED_CRYPTO_RISK_ONLY`, `ordersEnabled=false`) against the measured live release, compatibility metadata, release marker, and economic non-change. Do not adopt the candidate unless the contract proves it is compatible.
5. Exercise Actions and direct-SSH adapters in dry-run/test fixtures, including nonce replay rejection, scope/SHA mismatch rejection, Writer exclusivity, rollback, systemd wiring, STOP ownership, and three-cycle audit.
6. Diagnose and repair the Windows `fcntl` test portability issue and the Q102 `1.50` versus runtime `3.00` expectation only where the established contract and current production source justify it; do not alter Q102 economics.
7. Classify legacy deployment routes, preserve fallback/recovery paths, run focused and relevant full tests, `git diff --check`, source-boundary checks, and CI. Push only to the PR branch, keep it Draft, and report each readiness gate with evidence.

## Completion criteria

- SOURCE_READY: source and test changes are committed on the PR branch.
- CI_VERIFIED: focused tests, helper/contract tests, source boundary, and CI pass.
- VPS_STAGING_VERIFIED: measured VPS state and read-only staging evidence are internally consistent.
- OPERATOR_PREFLIGHT_READY: all non-owner preflight checks pass; owner signature/activation is still absent.
- OWNER_ACTION_REQUIRED: exact owner terminal steps are listed, with no secret entry into Codex.
- PRODUCTION_ACTIVATION_READY: only if the owner-controlled prerequisites are satisfied; no activation is performed in this task.
- LIVE_VERIFIED: remains false unless a separately authorized and completed Production activation is evidenced.
