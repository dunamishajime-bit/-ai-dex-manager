# DisDex Multi-SHA Production Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct and verify the source-level multi-SHA runtime wiring, truthful runner heartbeat, shared risk/STOP ownership, shared API persistence, Gross reservation safety, runner contracts, and release evidence without enabling unapproved LIVE behavior.

**Architecture:** Add one validated runner-pin contract and make root wiring, health snapshot, watchdog, operator activation, preflight, and STOP ownership consume the same runner-specific identity. Preserve legacy evidence modes until a real tick-capable release is deployed, and harden shared persistence with collision-resistant atomic publication while retaining existing fail-closed and account-lock semantics. Keep economic research candidates outside the LIVE release boundary.

**Tech Stack:** TypeScript/Node.js, Node's built-in `node:test` through `tsx`, Python self-tests and `unittest`, Bash/systemd contract tests, existing GitHub Actions workflows, immutable SHA-marked release scripts.

**Spec:** `docs/superpowers/specs/2026-10-29-disdex-multisha-production-safety-design.md`

## Global Constraints

- Base all implementation on `06555dcaaf8b62fd8f8fcec2b6fa650225012f2c` and preserve existing dirty checkouts/worktrees.
- No Vercel deployment or Vercel runtime configuration.
- No unauthenticated test order, real-money test order, forced close, STOP cancellation/change, or Kill Switch relaxation.
- No dynamic Gross allocation; preserve existing Gross caps and the rule that transfer happens only when available Gross is insufficient.
- Unknown, partial, stale, malformed, or unreconciled protection remains Fail Closed.
- A marker is written only after a real decision cycle; tests and operators must never fabricate a healthy tick.
- Legacy runner binaries remain on their existing safe heartbeat path until a real tick writer is present and deployed.
- #296 HYPE/AVAX/economic changes and #261 V52 stale-quote behavior remain research/source-only unless separately certified; they are not silently merged into LIVE logic.
- Native Aster history is required for formal BT certification; no Binance or synthetic substitute is allowed.
- VPS/systemd apply, LIVE cutover, signed venue reads, and operator activation remain blocked unless the prescribed key and formal approvals exist.
- Durable research/audit artifacts go under `C:\Users\dis\Desktop\DisDex_AI_Files` using the prescribed category folders, never the Desktop root.

## Review Focus

- A peer runner must never inherit `DEPLOYED_SHA` when its actual service/release has a different SHA; test every unit, health, watchdog, operator, and STOP owner projection.
- A legacy binary must not be declared tick-healthy from a missing or manually created marker; test legacy/tick evidence-mode separation and real decision-cycle publication.
- Same-PID/same-millisecond writes must never overwrite a competing temporary inode or publish a partial state; test the rate budget, IDLE, HYPE, and tick writers under 80-way contention.
- A stale, unknown, or partial STOP must never become “managed” through a familiar symbol, side, or old common SHA; test independent V4 and Q102 ownership and exact quantity.
- A stale/invalid Gross or pending snapshot must never authorize a new order or an unnecessary reduction; test NaN, Infinity, negative, missing, timeout, UNKNOWN, restart, stock-vs-crypto, and reservation paths.

---

### Task 1: Establish the runner-pin contract and baseline failing tests

**Files:**
- Create: `scripts/ops/root/disdex-runner-pin-manifest.mjs`
- Create: `tests/runner-pin-manifest.test.mjs`
- Test: `tests/test_runtime_multilineage_monitoring.py`
- Test: `tests/test_runtime_wiring_hygiene.py`

**Interfaces:**
- Consumes: runner identity, SHA, release root, systemd unit, evidence mode, and STOP-owner identifiers.
- Produces: `RUNNER_PIN_MANIFEST_SCHEMA`, `RUNNER_PIN_IDS`, `validateRunnerPinManifest(input)`, `getRunnerPin(manifest, runnerId)`, and `serviceUnitForPin(runnerId, sha)` for later wiring/preflight code.

- [ ] **Step 1: Write the failing manifest tests.** Assert that a valid manifest accepts distinct V4, Q102, V52, legacy peer, and candidate SHA records; rejects short/non-hex SHA, symlink/legacy evidence mode mismatch, a service unit ending in another SHA, duplicate runner IDs, missing release roots, and unknown STOP owner values.
- [ ] **Step 2: Run the focused test to verify it fails.** Run `npx tsx --test tests/runner-pin-manifest.test.mjs`. Expected: FAIL because the manifest validator module and exports do not exist.
- [ ] **Step 3: Implement the minimal validator.** Keep the schema versioned, normalize SHA case, validate every required field, and return structured errors without reading credentials or venue state. Do not make the validator grant order authority.
- [ ] **Step 4: Add Python/Bash contract assertions.** Pin the required runner IDs, forbid implicit all-peer `DEPLOYED_SHA` use in multi-SHA mode, and require explicit legacy evidence mode for old binaries.
- [ ] **Step 5: Run focused tests.** Run `npx tsx --test tests/runner-pin-manifest.test.mjs` and the two Python runtime contract tests. Expected: PASS.
- [ ] **Step 6: Commit the contract.** Commit with `test: define multi-sha runner pin contract`.

### Task 2: Make root wiring, health snapshot, watchdog, and operator scope runner-specific

**Files:**
- Modify: `scripts/ops/root/disdex-current-runtime-wiring`
- Modify: `scripts/ops/root/disdex-runner-health-snapshot-current.mjs`
- Modify: `scripts/ops/root/disdex-runner-watchdog-current.mjs`
- Modify: `scripts/ops/root/disdex-live-operator-activation-gate.mjs`
- Create or modify: `tests/runner-multisha-wiring-contract.test.mjs`
- Modify: `tests/test_runtime_health_snapshot_current.py`
- Modify: `tests/ops-current-runtime-safety-daemon-contract.test.mjs`
- Modify: `tests/ops-runner-watchdog-current-contract.test.mjs`
- Modify: `tests/operator_activation_hardening.test.ts`

**Interfaces:**
- Consumes: `validateRunnerPinManifest`, `getRunnerPin`, and the existing V4/legacy operation-mode inputs from Task 1.
- Produces: runner-specific unit/release/health/watchdog/operator variables; `approvedShaByRunner` compatibility support while retaining single-runner `approvedSha` checks; explicit legacy versus `tick-v1` monitor behavior.

- [ ] **Step 1: Write failing wiring tests.** Use a fixture with the five known SHA lineages and assert that PENGU/Q102/V52/FET/HYPE/IDLE/Shared Risk each emit their own exact service unit, release root, expected SHA, operator runner, and STOP owner. Assert that V4 primary does not rewrite peer identities.
- [ ] **Step 2: Run the focused contract suite.** Run `npx tsx --test tests/runner-multisha-wiring-contract.test.mjs tests/operator_activation_hardening.test.ts` plus the targeted Python monitor tests. Expected: FAIL because current wiring uses `DEPLOYED_SHA` for peers and the operator gate has only a single approved SHA path.
- [ ] **Step 3: Implement runner-pin loading in root wiring.** Validate the root-owned manifest before generating unit/drop-in/environment files. Refuse missing, symlinked, malformed, or inconsistent records. Retain a visible explicit single-lineage legacy mode only when the manifest declares it.
- [ ] **Step 4: Rewire health snapshot and watchdog.** Derive `expectedSha`, `releaseRoot`, `serviceUnit`, tick root, age limits, and evidence mode per runner. Keep `heartbeatAt` separate from validated `lastTickAt`; reject future, stale, SHA-mismatched, service-mismatched, or unsupported markers.
- [ ] **Step 5: Extend operator activation safely.** Preserve root ownership/mode checks and v1 compatibility for a single SHA. Add a runner-keyed SHA validation path for multi-SHA scope; a multi-runner activation fails unless every requested runner has an exact approved SHA and target.
- [ ] **Step 6: Run focused tests and shell self-tests.** Expected: PASS with no actual systemd or order operation. Verify that the generated plan is read-only and that `--apply` remains gated by existing operator checks.
- [ ] **Step 7: Commit.** Commit with `fix: bind runtime monitoring and operator gates to runner shas`.

### Task 3: Complete truthful tick storage and collision-resistant marker publication

**Files:**
- Modify: `lib/disdex-runner-tick-heartbeat.ts`
- Modify: `scripts/ops/root/disdex-current-runtime-wiring`
- Modify: `tests/runner-tick-heartbeat.test.ts`
- Modify: `tests/runner-health-tick-contract.test.mjs`
- Create: `tests/runner-tick-storage-contract.test.mjs`
- Modify: `tests/test_runner_tick_heartbeat.py`
- Modify: `scripts/v12-v4-production-runner.ts` only if its tick/state publication is covered by the failing collision test

**Interfaces:**
- Consumes: per-runner `evidenceMode`, exact `runtimeSha`, exact `serviceUnit`, and #300 storage contract.
- Produces: atomic tick-v1 publication with unique temporary inode, real-cycle status/reason/counters, and root wiring that grants only required `ReadWritePaths`.

- [ ] **Step 1: Add failing collision/storage tests.** Assert same-PID/same-millisecond publication creates distinct temporary paths, uses exclusive creation, cleans up after failure, and atomically replaces only the final runner marker. Assert root parent symlink/file refusal, deploy ownership/mode, seven required drop-ins, `ProtectSystem` ordering, and no manual marker command.
- [ ] **Step 2: Run the focused tests to verify failure.** Run `npx tsx --test tests/runner-tick-heartbeat.test.ts tests/runner-health-tick-contract.test.mjs tests/runner-tick-storage-contract.test.mjs` and `python -m unittest tests.test_runner_tick_heartbeat`. Expected: FAIL on the current PID+millisecond TypeScript writer and missing #300 source in the base branch.
- [ ] **Step 3: Implement unique atomic publication.** Add UUID-bearing temporary paths and exclusive creation to the TypeScript writer; preserve schema validation and final rename. Do not add a synthetic writer or change decision-cycle timing.
- [ ] **Step 4: Integrate the #300 storage contract.** Add safe root-owned creation, narrow deploy access, and drop-ins for only tick-capable services. Keep old binaries on legacy evidence mode and do not make the monitor require markers they cannot emit.
- [ ] **Step 5: Verify real-cycle statuses.** Add contract coverage for no-signal, lock, held, market-closed, order-free, and protective outcomes as actual result reasons/statuses.
- [ ] **Step 6: Run focused tests and commit.** Expected: PASS. Commit with `fix: harden runner tick publication and storage permissions`.

### Task 4: Harden shared rate budget, state persistence, retries, and account-lock observability

**Files:**
- Modify: `lib/disdex-aster-global-rate-budget.ts`
- Modify: `lib/idle-priority-short-state.ts`
- Modify: `lib/idle-residual-long-state.ts`
- Modify: `lib/hype-zec-long-runner-state.ts`
- Modify: `lib/aster-v3-client.ts`
- Modify: `lib/disdex-aster-rate-budget-policy.ts` only if tests prove a missing policy branch
- Modify: `tests/aster-global-rate-budget.test.ts`
- Modify: `tests/aster-418-fail-closed.test.ts`
- Modify: `tests/aster-rate-limit-cooldown.test.ts`
- Modify: `tests/idle-priority-short-state.test.ts`
- Modify: `tests/idle-residual-long-state.test.ts`
- Modify: `tests/hype-zec-long-state.test.ts`
- Modify: `tests/account-lock-renew.test.ts`
- Create: `tests/shared-state-concurrency.test.ts`

**Interfaces:**
- Consumes: current UUID account lease and global rate-budget lock APIs.
- Produces: collision-resistant `atomicWrite*` functions, injectable read-only retry jitter, and structured non-secret contention/defer diagnostics.

- [ ] **Step 1: Add failing 80-way and same-timestamp tests.** Exercise budget reserve/defer, IDLE, residual, HYPE, and tick/state writers concurrently with a fixed clock/PID fixture. Assert no corrupt JSON, no lost publication due to shared temporary names, and no unauthorized permission grant.
- [ ] **Step 2: Add failing retry/lock tests.** Assert read-only 429 backoff includes bounded jitter, 418 remains non-retryable, order mutations never retry, shared cooldown remains authoritative, stale/malformed snapshots fail closed, and account-lock owner/lease mismatch cannot release another owner.
- [ ] **Step 3: Run the focused suite to observe failures.** Run the affected `npx tsx --test` files and the Python rate-budget tests. Expected: failures on base temporary names and missing jitter/diagnostic assertions.
- [ ] **Step 4: Apply only the minimal #260-safe changes.** Add UUID plus `wx` to the four writers without importing the broader Draft branch or deleting existing freshness/recovery validation. Keep account lock lease behavior intact.
- [ ] **Step 5: Implement bounded injectable jitter.** Add a deterministic test hook or injected random source to the read-only retry path; never retry order mutations or 418, and never bypass the global budget/cooldown.
- [ ] **Step 6: Add non-secret diagnostics.** Log budget owner/contender when available, wait time, retry count, cooldown/defer reason, and skip reason without API keys, signatures, wallet data, or private configuration.
- [ ] **Step 7: Run the 80-way, restart/recovery, and full focused tests.** Expected: PASS with no unbounded wait and no state corruption.
- [ ] **Step 8: Commit.** Commit with `fix: prevent shared persistence collisions and retry starvation`.

### Task 5: Bind Shared Risk, STOP ownership, preflight, and formal activation to the new identity model

**Files:**
- Modify: `lib/resident-stop-observation.ts`
- Modify: `lib/disdex-managed-protective-orders.ts` only if a failing owner/quantity test identifies a source gap
- Modify: `scripts/ops/root/disdex-risk-api-final-preflight-20261028.py`
- Modify: `scripts/ops/root/disdex-live-operator-activation-gate.mjs`
- Modify: `scripts/ops/root/disdex-current-runtime-wiring`
- Modify: `tests/resident-stop-v4-multisha.test.ts`
- Modify: `tests/resident-stop-q102-multisha.test.ts`
- Modify: `tests/resident-stop-cross-sha-writer-rollout.test.ts`
- Modify: `tests/resident-stop-observation.test.ts`
- Modify: `tests/operator_activation_hardening.test.ts`
- Create or modify: `tests/risk-api-final-preflight-multisha.test.mjs`

**Interfaces:**
- Consumes: runner-pin manifest, exact service/release identity, tick evidence mode, Shared Risk snapshot, pending registry, and current STOP proof structures.
- Produces: runner-specific preflight blockers, independent V4/Q102 ownership proofs, and no authority grant (`liveOrderAuthorityGranted: false`) until external gates pass.

- [ ] **Step 1: Write failing tests for old fixed SHA behavior.** Assert the preflight accepts an explicit before/after runner map, rejects old common-SHA substitution for Q102/FET/HYPE/IDLE/V52, preserves 7.5% daily loss/freshness checks, and fails unknown/partial/quantity-mismatched STOPs.
- [ ] **Step 2: Run focused tests to verify failure.** Run the resident STOP and new preflight tests. Expected: failure because the current Python preflight hardcodes the old common SHA and observer defaults remain too broad.
- [ ] **Step 3: Implement runner-scoped owner resolution.** Require exact V4 and Q102 owner/service/tick proof; derive legacy peer owners only from validated pins; preserve unknown STOP fail-closed and exact full/partial quantity rules.
- [ ] **Step 4: Refactor read-only preflight inputs.** Add explicit pin-manifest input and runner-level evidence output while retaining no HTTP/no-write/no-order behavior and the 7.5% contract.
- [ ] **Step 5: Test transition safety.** Prove that old/new Risk Writer overlap is refused, old positions/STOPs remain protected, latch/date/freshness mismatch blocks, and recovery failure blocks.
- [ ] **Step 6: Run focused Python/TypeScript tests and commit.** Commit with `fix: enforce runner-scoped risk and stop certification`.

### Task 6: Verify Gross reservation and all runner safety boundaries without importing economic research

**Files:**
- Modify: `lib/disdex-pending-exposure-registry.ts` only for proven source defects
- Modify: `lib/disdex-integrated-gross-governor.ts` only for proven source defects
- Modify: `lib/fet-brk48-live-runner.ts` and/or `lib/fet-brk48-live-reduction.ts` only after a failing safety test
- Modify: `lib/disdex-quality102-causal-v1-runner.ts` only after a failing safety test
- Modify: `lib/disdex-v96-portfolio-runner.ts` and/or `scripts/disdex_v52_aster_only_live_engine.py` only after a failing safety test
- Modify: `lib/hype-zec-preemption.ts`, `lib/idle-residual-long-preemption.ts`, or related runner files only after a failing safety test
- Modify: `tests/v12-preorder-gross-reservation.test.ts`
- Modify: `tests/integrated_gross_governor.test.ts`
- Modify: `tests/fet-core-preemption.test.ts`
- Modify: `tests/fet-brk48-live-runner.test.ts`
- Modify: `tests/quality102-preflight-protective-order.test.ts`
- Modify: `tests/fet_v52_ownership.py`
- Modify: `tests/test_final_dynamic_gross_strict_caps.py`
- Modify: `tests/v52-worst-case-capacity.test.py`
- Modify: `tests/hype-zec-preemption.test.ts`
- Modify: `tests/idle-residual-long-preemption.test.ts`

**Interfaces:**
- Consumes: current pending registry, account lock, runner-owned state, exact Gross caps, and Task 5 risk/STOP permission.
- Produces: source-level proofs for FET, Q102, V52, HYPE, IDLE/RESIDUAL, and V12 behavior; no unapproved economic entry/exit change.

- [ ] **Step 1: Add failing contract cases.** Cover existing positions/STOP preservation with available Gross, Gross-shortage-only preemption, stock-versus-crypto isolation, NaN/Infinity/negative/missing/stale notional rejection, timeout/UNKNOWN/restart/manual-review blocking, and authoritative 4.75x versus 4.25x cap selection.
- [ ] **Step 2: Run current runner safety suites to establish failures.** Use the existing package scripts for V12, Q102, PENGU, HYPE, IDLE, FET, V52, pending exposure, and Gross contracts. Record failures without changing behavior.
- [ ] **Step 3: Implement only fail-closed corrections.** Do not add dynamic Gross or research entry/exit logic. Preserve current STOP and existing-position protection when an attempted transfer cannot result in a valid new order.
- [ ] **Step 4: Verify each runner boundary.** Assert V12 route/STOP/partial/duplicate/restart behavior, Q102 BASE_NOT_IDLE/one-slot/owner/Gross reasons, PENGU timed protections, HYPE TREND-vs-old-M5 separation, FET Core ownership, V52 local stale hold/Margin Guard/stock Gross, and IDLE/RESIDUAL ATR/AVAX timing contracts.
- [ ] **Step 5: Run focused suites and commit.** Commit with `test: certify gross reservation and runner fail-closed boundaries` or a narrower `fix:` message only when code changed.

### Task 7: Align HP/runtime snapshots and authenticated observability contracts

**Files:**
- Modify: `scripts/ops/root/disdex-runner-health-snapshot-current.mjs`
- Modify: `scripts/ops/root/disdex-runner-health-alert.ts`
- Modify: relevant HP/API snapshot components identified by the existing source tests
- Modify: `tests/current_live_target_readiness.test.ts`
- Modify: `tests/runtime-alert-policy.test.ts`
- Modify: `tests/runner-health-tick-contract.test.mjs`
- Modify: `tests/ops-runner-watchdog-current-contract.test.mjs`
- Create or modify: `tests/hp-runner-snapshot-consistency.test.ts`

**Interfaces:**
- Consumes: Task 2 runner identities, Task 3 evidence mode, Task 5 risk/STOP state, pending/Gross/Margin Guard state.
- Produces: one consistent authenticated snapshot for HP, runner-specific SHA/status/reason/tick/permission/STOP fields, and explicit stale/anonymous-data blockers.

- [ ] **Step 1: Add failing snapshot/page consistency tests.** Assert no page can display a different SHA, old heartbeat, duplicate runner, or anonymous HTTP-200 state than the canonical snapshot. Cover mobile and desktop route contracts through existing source-level tests.
- [ ] **Step 2: Run focused tests to verify failures.** Expected: failures where current health/wiring values still derive from common `DEPLOYED_SHA` or confuse supervisor heartbeat with decision tick.
- [ ] **Step 3: Implement canonical snapshot projection.** Use runner pins and evidence modes, preserve fail-closed permission/STOP states, include Q102 family/layer/score, V4 route count, ranking, Shared Risk, API backlog, Margin Guard, pending, stock Gross, and crypto Gross.
- [ ] **Step 4: Implement alert reason consistency.** Ensure alerts identify runner, expected SHA, actual SHA, evidence age, service mismatch, and reason without exposing credentials.
- [ ] **Step 5: Run focused tests and commit.** Commit with `fix: align runner health and authenticated snapshot identity`.

### Task 8: Preserve research/native-history blockers and generate auditable release evidence

**Files:**
- Modify: `.github/workflows/disdex-multisha-risk-api-release-cert-20261028.yml` or add a new narrowly scoped workflow only when existing CI cannot express the required checks
- Modify: `.github/workflows/disdex-runner-tick-storage-ci-20261029.yml` if the integrated source needs an additional contract check
- Modify: release/readiness scripts under `scripts/ops/root/`
- Create: `docs/implementation/DISDEX_MULTISHA_PRODUCTION_SAFETY_IMPLEMENTATION_20261029.md`
- Create: `docs/implementation/DISDEX_MULTISHA_RELEASE_EVIDENCE_20261029.md`
- Create: a manifest only under `C:\Users\dis\Desktop\DisDex_AI_Files\05_Logs_Audits` or the appropriate output folder after verification

**Interfaces:**
- Consumes: all prior task outputs, Git SHA, test results, native data-availability checks, and operator/VPS blockers.
- Produces: immutable release/readiness evidence that distinguishes source/CI, research-only, operator-blocked, venue-blocked, native-history-blocked, and LIVE-verified states.

- [ ] **Step 1: Add failing CI contract assertions.** Assert candidate SHA, runner map, marker writer lineage, no dynamic Gross, no research-only HYPE/AVAX import, no Vercel target, and no generated credential output.
- [ ] **Step 2: Run local release/readiness self-tests to verify the new checks fail where expected.** Record missing operator/venue/native evidence as blockers, not as test skips or PASS.
- [ ] **Step 3: Implement release evidence generation.** Include source SHA, file hashes, tests, workflow run links/IDs, release marker expectations, and explicit external blockers. Never copy or modify operator artifacts.
- [ ] **Step 4: Keep BT output separated.** If Aster native history is unavailable, write only a `BLOCKED_NATIVE_HISTORY` evidence record; do not create a formally certified BT using substitute data.
- [ ] **Step 5: Run CI contract tests and commit.** Commit with `docs: record multisha production safety evidence boundary` or a workflow-specific message.

### Task 9: Full verification, review, push, and PR creation

**Files:**
- All files changed by Tasks 1–8
- Create: final audit manifest under `C:\Users\dis\Desktop\DisDex_AI_Files\05_Logs_Audits` only after all local verification completes

**Interfaces:**
- Consumes: clean isolated branch, task commits, focused test evidence, and release/readiness report.
- Produces: verified branch, pushed GitHub branch if credentials/network permit, and a PR that explicitly excludes LIVE activation and unapproved economic changes.

- [ ] **Step 1: Run formatting/diff checks.** Run `git diff --check`, inspect `git diff --stat`, confirm no credential/API-key/wallet/private-config files are staged, and confirm no Desktop-root output was created.
- [ ] **Step 2: Run focused suites.** Run every task-level Node/Python/shell contract suite and the existing V12, Q102, PENGU, HYPE, FET, V52, IDLE, Shared Risk, STOP, pending, Gross, and runtime wiring self-tests.
- [ ] **Step 3: Run repository typecheck and relevant build checks.** Use the repository's `npm run typecheck` and targeted `npx tsc --noEmit`/`npx tsx` commands, preserving and documenting pre-existing unrelated failures.
- [ ] **Step 4: Run the full relevant test set.** Use the package scripts and `npx tsx --test`/Python test commands for all modified contracts. Do not run any command that contacts the venue or sends orders.
- [ ] **Step 5: Inspect release readiness.** Verify immutable SHA256 output, candidate release marker, per-runner map, no-live-order authority, and all remaining blockers.
- [ ] **Step 6: Commit the integrated source.** Create a final commit only after fresh verification evidence. Do not amend or rewrite previous commits unnecessarily.
- [ ] **Step 7: Push the branch to GitHub.** Push only the isolated branch `codex/disdex-production-safety-20261029`. If GitHub credentials/network are unavailable, preserve the local commit and report `SOURCE_READY_NOT_LIVE` with the exact push blocker.
- [ ] **Step 8: Create a PR.** Open a PR against the appropriate base branch/commit, link the design/plan/evidence documents, state that LIVE cutover is excluded, and attach the PR to this task. Do not merge the PR automatically.
- [ ] **Step 9: Final verification before reporting.** Re-read branch head, PR head, CI status, diff, and evidence manifest. Report each issue under the exact required labels; report `LIVE_VERIFIED` only if real external approval, VPS application, venue evidence, and three audit cycles exist.

## Plan self-review

- **Spec coverage:** Tasks 1–2 cover multi-SHA wiring, health snapshot, watchdog, operator scope, and V4-primary behavior; Task 3 covers tick storage and truthful markers; Task 4 covers API budget, atomic state, retry, lock, and 80-way contention; Task 5 covers Shared Risk and STOP ownership; Task 6 covers Gross and all runner logic boundaries; Task 7 covers HP/alerts; Task 8 covers native-history/research/release evidence; Task 9 covers full verification, CI, push, and PR.
- **Step scan:** Each task separates failing test, observed failure, minimal implementation, focused verification, and commit. No step grants LIVE authority or depends on an unverified venue state.
- **Type consistency:** Task 1 owns the manifest helpers; Tasks 2–5 consume the same runner identity fields; Tasks 6–8 consume the resulting permission/evidence contracts; Task 9 consumes only committed task outputs.
- **Review focus coverage:** The five high-risk review inputs are pinned to Tasks 2, 3/4, 5, and 6 respectively.
- **Proportion:** The plan defines file boundaries, test names/commands, interfaces, and acceptance evidence without prescribing implementation bodies beyond the safety invariants.
