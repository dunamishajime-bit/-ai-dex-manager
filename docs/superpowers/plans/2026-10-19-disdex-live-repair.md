# DisDex Live Repair and Certification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair shared Aster rate-budget pressure, make V4 certification evidence current-SHA and content-valid, and move only independently verified services toward formal LIVE without bypassing safety gates.

**Architecture:** Keep trading logic and existing safety caps unchanged. Add a bounded completed-H1 snapshot cache and deterministic request scheduling at the market-data boundary; make the V4 V3 certificate validate the current runtime gross contract and the contents/provenance of all five root-managed evidence files; add a root-only evidence revalidation command that fails closed when signed venue or health evidence is stale or inconsistent. Production activation remains a separate operator-gated step.

**Tech Stack:** TypeScript/Node `tsx`, Node test runner, POSIX root operational scripts, systemd, GitHub Actions, Aster signed GET diagnostics.

**Spec:** User request dated 2026-10-19 plus `docs/implementation/DIRECT_V4_CERTIFICATION_AND_FULL_LIVE_REPAIR_20261019.md`, `docs/implementation/V12_V4_VENUE_CERTIFICATION_WITHOUT_TESTNET_20261010.md`, and the two referenced rate-safety/certification branches.

## Global Constraints

- Keep existing V12/PENGU/Q102/V52/FET/HYPE/Idle entry, exit, ownership, STOP, Gross, Margin Guard, Shared Risk, Kill Switch, and operator safety contracts unchanged unless a test proves a defect in the requested boundary.
- Do not create test or synthetic market orders, cancel existing orders, close existing positions, or replace protective orders during validation.
- Treat `486091bc4ac26f7b7fa0af600f7f03b4d7a221e7` and its exact VPS release as the starting production baseline until a new immutable release passes all checks.
- Use the current runtime gross contract as the source of truth; do not silently increase caps to satisfy an older certificate. Current observed contract is V12 2.0x, crypto 3.0x, total 4.25x, recovery 2.5x.
- Never rewrite an old evidence file's SHA/candidate field without rerunning the underlying check and recording its source, timestamp, and result.
- Keep V4 CANARY/disabled when certification evidence is incomplete; keep V52 DISABLED and FET preemption BLOCKED unless their independent contracts are actually satisfied.
- Never expose credentials, private keys, signed request material, or secret environment values.

## Review Focus

- Current-SHA evidence with an old candidate SHA must fail before any order authority is granted; covered by Task 1 content-validation tests.
- A valid V4 certificate with stale/mismatched gross caps must fail closed; covered by Task 1 runtime-contract tests.
- Repeated Idle market loads in one completed H1 boundary must not refetch immutable candles; covered by Task 2 cache tests.
- Rate-budget saturation must degrade health and defer read-only work without changing order permissions or retrying mutations; covered by Task 2 policy/scheduler tests.
- A current signed Aster snapshot with an existing protected position must be accepted only when counts, ownership, and freshness agree; covered by Task 3 evidence-preflight tests and VPS read-only verification.

### Task 1: Current-SHA V4 certification contract

**Files:**
- Modify: `lib/v12-v4-certified-gates.ts`
- Create: `lib/v12-v4-production-contract.ts`
- Test: `tests/v12-v4-certified-gates.test.ts` and the existing direct-certification regression test

**Interfaces:**
- Produces `V12_V4_CURRENT_GROSS_CONTRACT` and content validation for the five V3 evidence files.
- Consumes the existing `PRODUCTION_EXIT_CATALOG` and root-managed evidence paths.

- [ ] Write failing tests for old candidate SHA, stale margin health, invalid evidence provenance, and current-cap mismatch.
- [ ] Run the focused tests and observe the expected failures.
- [ ] Implement the shared current contract and strict evidence-content validation without accepting fabricated lifecycle claims.
- [ ] Run focused tests, V4 self-tests, and typecheck.
- [ ] Commit the contract change.

### Task 2: Bounded H1 market-data reuse and rate safety

**Files:**
- Modify: `lib/idle-priority-short-market-data.ts`, `lib/aster-v3-client.ts`, and the applicable rate-budget health script.
- Create or modify: a focused completed-H1 cache/scheduler module under `lib/`.
- Test: `tests/idle-priority-short-market-data.test.ts`, `tests/aster-global-rate-budget.test.ts`, and the health snapshot contract test.

**Interfaces:**
- The Idle provider consumes a cache keyed by symbol, interval, limit, and completed-bar boundary.
- The cache never returns a forming candle and invalidates at the next H1 boundary or a detected gap.
- Request scheduling remains bounded, weighted, and fail-closed; mutation requests retain protective priority.

- [ ] Write failing tests proving same-boundary reuse, boundary invalidation, gap invalidation, and bounded sequential scheduling.
- [ ] Run focused tests and observe failures.
- [ ] Implement the minimal cache/scheduler change; do not change strategy signals or caps.
- [ ] Run market-data, rate-budget, health, and related runner tests.
- [ ] Commit the rate-safety change.

### Task 3: Root evidence revalidation and operational preflight

**Files:**
- Create: `scripts/ops/root/disdex-v12-v4-evidence-preflight.mjs` (or the repository's established root-script equivalent).
- Modify: `deploy/systemd/disdex-v12-v4@.service` only if the preflight must be wired before certification; keep it fail-closed.
- Test: a root-script contract test under `tests/`.

**Interfaces:**
- Command accepts an exact release SHA and reads only root-managed evidence, runtime marker, health files, and signed read-only diagnostics.
- It emits a redacted JSON summary with evidence hashes, freshness, route count, cap contract, margin/risk state, positions/orders counts, and mutation counters; it never emits secret values.
- It exits nonzero on stale SHA, stale signed data, margin/risk failure, missing evidence, or any mutation count other than zero.

- [ ] Write failing tests for SHA mismatch, missing content fields, stale signed evidence, and mutation counters.
- [ ] Run tests and observe failures.
- [ ] Implement the preflight and atomic summary output under the existing VPS audit path.
- [ ] Run tests and a local redacted fixture audit.
- [ ] Commit the operational preflight.

### Task 4: Integration verification and release

**Files:**
- Modify: the relevant CI workflow only when it currently treats historical compatibility failure as a production failure without separating it from current-contract checks.
- Create: a dated audit manifest under `C:\Users\dis\Desktop\DisDex_AI_Files\03_VPS_LIVE` only after production evidence is collected.

- [ ] Run the current-contract test set, V4/PENGU/Q102/FET/HYPE/Idle self-tests, typecheck, and build.
- [ ] Push the immutable candidate and wait for the required CI jobs; a `jobs=0`, skipped, or historical nonblocking failure is not Green.
- [ ] Build an immutable VPS release from the exact remote SHA and run the root evidence preflight read-only.
- [ ] Reconcile current-SHA evidence from fresh checks; do not alter positions/orders or claim unobserved venue lifecycle.
- [ ] Re-audit all runners, rate budget, Shared Risk, Margin Guard, Kill Switch, watchdog, HP endpoints, disk, and rollback.
- [ ] Create/update operator approval only if all exact gates pass; otherwise leave production on 486 and report the exact blocker.

### Task 5: Final verification and handoff

- [ ] Run the full relevant test suite and `git diff --check`.
- [ ] Perform a separate verification pass over code, CI, VPS, evidence hashes, and mutation counters.
- [ ] If any required venue or operator gate remains unproven, report `BLOCKED_<EXACT_REASON>` and preserve the safe current state; do not report LIVE.
- [ ] If every gate is proven, perform the atomic current switch, verify rollback, and report all runner states with evidence.
