# Exact Current-SHA Monthly BT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a deterministic, fail-closed integrated replay engine pinned to the exact current Production SHA, then run a one-year compounded monthly report with ¥10,000 initial capital and no monthly contributions.

**Architecture:** The engine consumes a manifest of per-strategy candidate/market inputs, verifies every source SHA against the target runtime SHA and every data hash before replay, then applies a single chronological allocator/execution emulator. It emits an immutable event ledger, trade ledger, monthly equity, strategy attribution, reconciliation, and a result manifest. Missing or legacy-source inputs stop the run instead of being relabeled as current.

**Tech Stack:** TypeScript, Node.js, JSONL/JSON manifests, Node crypto SHA-256, `node:test`, existing runtime policy modules.

**Spec:** User request: latest VPS/Production SHA exact one-year BT, initial ¥10,000, monthly contribution ¥0, compounding, monthly output.

## Global Constraints

- Target runtime SHA is `e8cc2e73f8d3981d708ee52f013241597c038b10` until a new implementation commit is intentionally created.
- Period is `2025-08-10T00:00:00Z` through `2026-08-10T00:00:00Z`.
- Initial capital is ¥10,000; monthly contribution is ¥0; compounding is ON.
- Legacy ledgers with `eab...`, `dbf...`, `e1b...`, or any other source SHA are never relabeled as current.
- The engine is research-only and must not send/cancel orders or modify VPS state.
- Missing candidate, market, funding, FX, or policy evidence causes a fail-closed result.

## Review Focus

- Runtime/source SHA mismatch: must stop before producing performance metrics; tested in the input validator task.
- Duplicate or out-of-order events: must be rejected or deterministically tie-broken; tested in the event ledger task.
- Gross reservation and pending exposure: candidate worst-case exposure must be reserved before acceptance; tested in allocator task.
- Same-symbol ownership and actual-exit cooldown: ownership is released only at exit and cooldown uses actual exit timestamp; tested in lifecycle task.
- Accounting and monthly mark-to-market: deposits remain zero after the initial deposit and monthly rows reconcile to the event ledger; tested in reporting task.

### Task 1: Exact Input Contract

**Files:**
- Create: `scripts/research/exact-current-sha-bt-contract.ts`
- Test: `tests/exact-current-sha-bt-contract.test.ts`

**Interfaces:**
- `validateExactBtManifest(manifestPath: string, expectedSha: string): ValidatedBtManifest`
- `ValidatedBtManifest` contains target SHA, period, capital policy, source files, SHA-256 hashes, and per-strategy coverage.

- [ ] Step 1: Write failing tests for rejecting legacy runtime SHA, nonzero monthly contribution, missing strategy coverage, and accepting an exact manifest.
- [ ] Step 2: Run the focused test and confirm it fails because the validator does not exist.
- [ ] Step 3: Implement strict JSON/schema/hash validation using Node crypto and no network calls.
- [ ] Step 4: Run the focused test and confirm all contract cases pass.
- [ ] Step 5: Commit the contract and tests.

### Task 2: Chronological Integrated Allocator

**Files:**
- Create: `scripts/research/exact-current-sha-integrated-bt.ts`
- Test: `tests/exact-current-sha-integrated-bt.test.ts`

**Interfaces:**
- `runExactIntegratedBt(input: ValidatedBtManifest): IntegratedBtResult`
- `IntegratedBtResult` contains trades, events, monthly equity, per-strategy attribution, gross timeline, reconciliation, and result hash.

- [ ] Step 1: Write failing tests for deterministic event ordering, pending/reserved gross, same-symbol ownership, actual-exit cooldown, and no-order mutation.
- [ ] Step 2: Run the focused test and confirm it fails.
- [ ] Step 3: Implement the minimal chronological replay state machine with initial ¥10,000, zero recurring deposits, compounding sizing, fees/funding/slippage fields, and fail-closed invalid-event handling.
- [ ] Step 4: Run focused tests and confirm they pass.
- [ ] Step 5: Commit the allocator and tests.

### Task 3: Manifest Runner and Monthly Report

**Files:**
- Create: `scripts/research/run-exact-current-sha-monthly-bt.ts`
- Create: `tests/exact-current-sha-monthly-report.test.ts`
- Create: `docs/research/results/exact-current-sha-monthly-bt-20261014/README.md`

**Interfaces:**
- CLI: `tsx scripts/research/run-exact-current-sha-monthly-bt.ts <manifest> <outputDir>`
- Outputs: `portfolio-trades.jsonl`, `portfolio-events.jsonl`, `candidate-decisions.jsonl`, `monthly-equity.json`, `strategy-attribution.json`, `result.json`, `manifest.json`.

- [ ] Step 1: Write failing tests for monthly zero-deposit accounting, output hashes, and independent rerun equality.
- [ ] Step 2: Run focused tests and confirm they fail.
- [ ] Step 3: Implement CLI orchestration and result/manifest emission.
- [ ] Step 4: Run tests, then run the exact target SHA replay twice and compare result hashes.
- [ ] Step 5: Report either the verified result or the exact fail-closed missing-source reason; do not substitute old runtime data.

### Verification Gate

- [ ] Run focused tests, then the complete relevant TypeScript test/typecheck command.
- [ ] Verify `git status`, target SHA, output manifest hashes, accounting reconciliation, and zero trading mutations.
- [ ] Only report a completed BT when the result manifest records the exact target SHA and all strategy inputs pass validation.
