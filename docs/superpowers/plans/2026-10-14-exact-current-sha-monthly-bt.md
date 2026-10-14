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

- [x] Step 1: Write failing tests for rejecting legacy runtime SHA, nonzero monthly contribution, missing strategy coverage, and accepting an exact manifest.
- [x] Step 2: Run the focused test and confirm it fails because the validator does not exist.
- [x] Step 3: Implement strict JSON/schema/hash validation using Node crypto and no network calls.
- [x] Step 4: Run the focused test and confirm all contract cases pass.
- [x] Step 5: Commit the contract and tests.

### Task 2: Chronological Integrated Allocator

**Files:**
- Create: `scripts/research/exact-current-sha-integrated-bt.ts`
- Test: `tests/exact-current-sha-integrated-bt.test.ts`

**Interfaces:**
- `runExactIntegratedBt(input: ValidatedBtManifest): IntegratedBtResult`
- `IntegratedBtResult` contains trades, events, monthly equity, per-strategy attribution, gross timeline, reconciliation, and result hash.

- [x] Step 1: Write failing tests for deterministic event ordering, pending/reserved gross, same-symbol ownership, actual-exit cooldown, and no-order mutation.
- [x] Step 2: Run the focused test and confirm it fails.
- [x] Step 3: Implement the minimal chronological replay state machine with initial ¥10,000, zero recurring deposits, compounding sizing, fees/funding/slippage fields, and fail-closed invalid-event handling.
- [x] Step 4: Run focused tests and confirm they pass.
- [x] Step 5: Commit the allocator and tests.

### Task 3: Manifest Runner and Monthly Report

**Files:**
- Create: `scripts/research/run-exact-current-sha-monthly-bt.ts`
- Create: `tests/exact-current-sha-monthly-report.test.ts`
- Create: `docs/research/results/exact-current-sha-monthly-bt-20261014/README.md`

**Interfaces:**
- CLI: `tsx scripts/research/run-exact-current-sha-monthly-bt.ts <manifest> <outputDir>`
- Outputs: `portfolio-trades.jsonl`, `portfolio-events.jsonl`, `candidate-decisions.jsonl`, `monthly-equity.json`, `strategy-attribution.json`, `result.json`, `manifest.json`.

- [x] Step 1: Write failing tests for monthly zero-deposit accounting, output hashes, and independent rerun equality.
- [x] Step 2: Run focused tests and confirm they fail.
- [x] Step 3: Implement CLI orchestration and result/manifest emission.
- [x] Step 4: Run tests, then run the exact target SHA replay twice and compare result hashes.
- [x] Step 5: Report either the verified result or the exact fail-closed missing-source reason; do not substitute old runtime data.

### Verification Gate

- [x] Run focused tests, then the complete relevant TypeScript test/typecheck command.
- [x] Verify `git status`, target SHA, output manifest hashes, accounting reconciliation, and zero trading mutations.
- [x] Only report a completed BT when the result manifest records the exact target SHA and all strategy inputs pass validation.

### Task 4: Recover And Certify The Current Economic Input Set

**Files:**
- Create: `scripts/research/run_e8cc_exact_no_dca_bt.py`
- Create: `tests/test_e8cc_exact_no_dca_bt.py`
- Update: `docs/research/results/exact-current-sha-monthly-bt-20261014/README.md`

- [x] Preserve every historical candidate/data origin SHA instead of relabeling it.
- [x] Bind the candidate stream to Production `e8cc2e73f8d3981d708ee52f013241597c038b10` with the checked-in V4 source/route/exit parity evidence and record every proof hash.
- [x] Re-evaluate FET with the current `VOL10_RET15` Gate from the raw Aster H1 bars.
- [x] Disable Q102 BRK exactly as the current runtime contract requires.
- [x] Apply the approved TIME-family fixed 8% emergency STOP on causal H1 bars.

### Task 5: Current-Contract 10/20/30bps Replay

- [x] Replay the one-year period with only the initial JPY 10,000 contribution, zero recurring deposits and compounding enabled.
- [x] Apply V4 Gross 3.0 / Crypto 3.5 / Total 4.75 only to V4 entry authority, while peer runners retain Crypto 3.0 / Total 4.25.
- [x] Preserve PENGU Q60/DD17/H72, FET 1.0, HYPE 1.5, Q102 family sizing, V52, Idle and Residual behavior.
- [x] Emit complete trade, candidate-decision and event ledgers for 10/20/30bps plus monthly equity/returns, strategy attribution, drawdown and Gross diagnostics.
- [x] Assert accounting PASS, one JPY 10,000 contribution, Q102 BRK accepted count zero, no ownership conflict and zero trading mutations.

### Task 6: Independent Reproduction And Final Evidence

- [x] Run the full replay twice into independent directories.
- [x] Verify deterministic SHA-256 equality for every canonical ledger and summary.
- [x] Pin input, policy, engine and output hashes in a final manifest.
- [x] Run focused tests, TypeScript tests/typecheck and `git diff --check`.
- [x] Report the 10bps result as the primary current-SHA H1 causal BT and 20/30bps as cost stress; disclose that historical L2 fills and historical venue minQty/readback are not modeled.
