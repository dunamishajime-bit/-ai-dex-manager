# PENGU Recovery V8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the frozen PENGU Recovery V8 supplemental Long sleeve with BT/LIVE execution parity, durable partial-defense state, protective-order reconciliation, and guarded XServer LIVE activation.

**Architecture:** Keep Recovery V8 in a dedicated pure policy/evaluator module and integrate it as a distinct `RECOVERY_V8` entry lineage in the existing PENGU DUAL LS V2 runner. Use a PENGU-specific protective-order adapter over the Aster client so the shared `DirectTradeExecutor` contract and V12/V52 logic remain unchanged. The deterministic BT uses theoretical trigger fills; LIVE uses the same trigger levels and quantity/event protocol while persisting actual exchange fills and slippage.

**Tech Stack:** TypeScript, Node.js `tsx`, existing Aster Futures V3 client, existing PENGU DUAL LS V2 runner/state store, JSON fixture/replay data, npm typecheck/build, SSH/systemd on XServer VPS.

**Spec:** `docs/superpowers/specs/2026-08-28-pengu-recovery-v8-design.md`

## Global Constraints

- Source of Truth: `research/pengu-recovery-v8-final-20260828` at `15c0b7586710c9db1c46b376bb5041203fc7d826` and freeze config `research/pengu-recovery-v8-final-20260828.json`.
- Frozen Recovery policy: `R_BTC3`, `SHORT_FIRST`, initial gross `0.50`, `BASE_LONG`, hard stop `6%`, trail activation `6%`, trail retrace `3%`, max hold `72h`, partial after `24h` at `entryPrice * 0.96`, partial gross `0.25`, remaining gross `0.25`.
- BT uses exact theoretical trigger fills; LIVE uses trigger prices but records actual fill prices and slippage.
- Same-bar event order is partial-defense first, then hard stop on remaining gross.
- LIVE partial protection must not be armed before `entryTs + 24h`.
- All protective orders are reduce-only; active protective quantities must sum to the live managed position quantity.
- Any unknown, unacknowledged, overfilled, overlapping, or unreconciled order state fails closed.
- Existing PENGU Legacy/V20 state remains loadable; only new `RECOVERY_V8` state uses V8 fields.
- V12 and V52 logic, parameters, services, and state are unchanged.
- The current user explicitly authorizes LIVE activation, but no synthetic/test order is allowed.
- Canonical deployment target is XServer VPS `professional-dismanager.net` as `root` with `C:\Users\dis\Desktop\DisDex.pem`; Vercel is not used.

---

### Task 1: Freeze policy and pure Recovery V8 evaluator

**Files:**
- Create: `config/penguRecoveryV8.ts`
- Create: `lib/pengu-recovery-v8.ts`
- Modify: `tsconfig.pengu-dual-ls-v2.json`
- Test: `scripts/pengu-recovery-v8-selftest.ts`

**Interfaces:**
- `config/penguRecoveryV8.ts` produces `PENGU_RECOVERY_V8` with immutable policy, `RecoveryV8EntryContext`, and `RecoveryV8Policy` types.
- `lib/pengu-recovery-v8.ts` consumes completed-bar feature rows and produces `RecoveryV8EntryDecision` and `RecoveryV8PositionDecision`.
- `RecoveryV8PositionDecision` must distinguish `NONE`, `PARTIAL_DEFENSE`, `HARD_STOP`, `TRAILING_STOP`, `MAX_HOLD`, and `YIELD_BASE_LONG` and include theoretical trigger price where relevant.

- [ ] **Step 1: Write failing tests for the frozen constants and R_BTC3 boundaries.**

  Add assertions for the freeze SHA, all V8 policy values, all three R_BTC3 thresholds, no breakeven/static guard/staged entry, and no fallback when a required feature is not finite.

- [ ] **Step 2: Run the focused self-test and verify the expected failure.**

  Run `npx tsx scripts/pengu-recovery-v8-selftest.ts`. It must fail because the new policy/evaluator exports do not exist yet.

- [ ] **Step 3: Implement immutable policy and pure R_BTC3 evaluation.**

  Port the research transform's deduplicated three-point cross and fixed thresholds exactly. Keep Recovery as a supplemental Long signal. Apply competition in this order: ordinary Short, ordinary/base Long, then Recovery; `SHORT_FIRST` must not allow Recovery to displace either base signal.

- [ ] **Step 4: Add pure exit evaluation with frozen event ordering.**

  For each completed position bar, evaluate the delayed partial trigger first after the 24-hour threshold; then evaluate the original hard stop against the remaining gross; then trail, max hold, and BASE_LONG yield. Return a theoretical partial price of `entryPrice * 0.96` for BT and never read a post-close market price as the trigger fill.

- [ ] **Step 5: Run the focused self-test and verify it passes.**

  Run `npx tsx scripts/pengu-recovery-v8-selftest.ts` and require all policy, boundary, event-order, and no-fallback assertions to pass.

- [ ] **Step 6: Commit the pure policy/evaluator slice.**

  Run `git add config/penguRecoveryV8.ts lib/pengu-recovery-v8.ts scripts/pengu-recovery-v8-selftest.ts tsconfig.pengu-dual-ls-v2.json` and commit with message `feat(pengu): add frozen Recovery V8 evaluator`.

### Task 2: Durable V8 state and PENGU signal integration

**Files:**
- Modify: `lib/pengu-dual-ls-v2.ts`
- Modify: `lib/pengu-dual-ls-v2-runner-state.ts`
- Modify: `lib/pengu-dual-ls-v2-portfolio-runner.ts`
- Modify: `scripts/pengu-dual-ls-v2-selftest.ts`
- Test: `scripts/pengu-recovery-v8-selftest.ts`

**Interfaces:**
- Add `entryVersion: "RECOVERY_V8"` without reusing `SHORT_V20`.
- Add `PenguRecoveryV8State` with `entryTs`, `originalGross`, `remainingGross`, `partialDefenseTriggered`, protective order IDs/status, and actual partial fill telemetry.
- Add pending action metadata for `RECOVERY_V8_PARTIAL_EXIT` and protective-order replacement.

- [ ] **Step 1: Write failing state and signal integration tests.**

  Cover Recovery entry creation, BASE_LONG yield, ordinary Short priority, V8 normalization, invalid state rejection, and preservation of legacy/V20 state.

- [ ] **Step 2: Run the focused tests and verify the expected failure.**

  Run `npx tsx scripts/pengu-recovery-v8-selftest.ts`; the new state fields and signal lineage must fail before implementation.

- [ ] **Step 3: Implement typed V8 position state and normalization.**

  Validate exact gross values, finite timestamps/prices, one-time flag, and protective-order metadata. Missing or malformed V8 fields must throw the existing manual-review/Fail Closed error path.

- [ ] **Step 4: Integrate Recovery into signal selection without changing ordinary logic.**

  Keep existing Long/Short feature predicates unchanged. Add Recovery only after ordinary Short/base Long selection and carry `RECOVERY_V8` through signal, pending, and filled-position state.

- [ ] **Step 5: Run focused tests and verify state/reason parity.**

  Require the self-test to prove V12/V52-independent PENGU behavior, exact frozen lineage, and no accidental V20 mutation.

- [ ] **Step 6: Commit the state/integration slice.**

  Commit with message `feat(pengu): integrate Recovery V8 state lineage`.

### Task 3: Aster protective-order adapter and safe partial lifecycle

**Files:**
- Modify: `lib/aster-v3-client.ts`
- Create: `lib/pengu-recovery-v8-protective-orders.ts`
- Modify: `lib/pengu-dual-ls-v2-portfolio-runner.ts`
- Modify: `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`
- Modify: `tsconfig.pengu-dual-ls-v2.json`
- Test: `scripts/pengu-recovery-v8-protective-order-selftest.ts`

**Interfaces:**
- `PenguRecoveryV8ProtectiveOrderAdapter` exposes `placeStopMarket`, `cancel`, `openOrders`, `getOrder`, and `replaceRecoveryStops` with explicit acknowledgement, client IDs, stop trigger, quantity, and reduce-only fields.
- `replaceRecoveryStops(position, oldHardStop, partialStop, remainingHardStop)` returns a reconciled protective-order set or throws a Fail Closed error.

- [ ] **Step 1: Write failing adapter tests.**

  Test stop payloads, reduce-only enforcement, deterministic client IDs, full-quantity hard stop at entry, guarded 24-hour replacement, quantity sum, old-order cancellation order, and failure retention of the old hard stop.

- [ ] **Step 2: Run the adapter tests and verify the expected failure.**

  Run `npx tsx scripts/pengu-recovery-v8-protective-order-selftest.ts`; it must fail before the adapter exists.

- [ ] **Step 3: Add Aster STOP_MARKET request/response types and methods.**

  Extend only the Aster client with stop-market placement/cancel/status capabilities. Do not change the shared `DirectTradeExecutor` interface used by V12/V52.

- [ ] **Step 4: Implement guarded protection replacement.**

  At entry, install one full-quantity reduce-only hard stop at `entryPrice * 0.94`. At `entryTs + 24h`, under the existing account lock, verify the live position and open orders, calculate `qPartial = currentQuantity * 0.5` and `qRemaining = currentQuantity - qPartial`, acknowledge/verify remaining hard stop and partial stop, cancel the old full stop only after both are confirmed, then re-read order/position state. If any non-atomic operation fails, retain the old full stop, clean up new orders where possible, and persist manual review.

- [ ] **Step 5: Implement actual fill capture and partial accounting.**

  On partial fill, persist actual exchange average price, executed quantity, slippage versus `entryPrice * 0.96`, set the one-time flag, reduce quantity/gross, and leave remaining hard/trailing protection active. A hard-stop-first report in a gap collision is not silently treated as Frozen parity.

- [ ] **Step 6: Run adapter tests and verify all safety assertions.**

  Require no over-reduce, no duplicate partial, no pre-24h arming, correct order quantities, and manual review on unknown/overlapping state.

- [ ] **Step 7: Commit the protective-order slice.**

  Commit with message `feat(pengu): add Recovery V8 protective order lifecycle`.

### Task 4: Restart reconciliation and BT parity harness

**Files:**
- Create: `scripts/pengu-recovery-v8-parity.ts`
- Create: `scripts/pengu-recovery-v8-parity-selftest.ts`
- Modify: `scripts/pengu-dual-ls-v2-selftest.ts`
- Modify: `package.json`
- Modify: `.github/workflows/disdex-pengu-dual-ls-v2-final-ci.yml`
- Test data: use the frozen research replay inputs/artifacts referenced by `15c0b758...`; do not substitute a newly tuned dataset.

**Interfaces:**
- `pengu-recovery-v8-parity.ts` accepts a frozen input directory and freeze config, emits a JSON result with BT metrics, event traces, actual/theoretical fill fields, and safety flags.
- `pengu-recovery-v8-parity-selftest.ts` verifies fixture-level event ordering, state restoration, fee/funding/slippage accounting, and exact frozen expectations.

- [ ] **Step 1: Write failing parity tests for theoretical fills and state restoration.**

  Assert exact theoretical `0.96` partial fills, partial-before-hard-stop on collision, separate tranche costs, restart restoration, and the full Normal/Severe/external expected values from the freeze config.

- [ ] **Step 2: Run the parity tests and verify the expected failure.**

  Run `npx tsx scripts/pengu-recovery-v8-parity-selftest.ts`; it must fail until the harness is implemented.

- [ ] **Step 3: Implement one deterministic replay/event ledger.**

  Reuse the fixed research thresholds and event ordering; report whether the input is present and fail closed if data is missing or misaligned. Do not embed a fabricated PASS result or call observed forward output fresh holdout.

- [ ] **Step 4: Add restart/reconciliation fixture cases.**

  Round-trip serialized V8 state and pending partial actions through normalization, then require the protective-order IDs, actual fill telemetry, and quantities to survive reload.

- [ ] **Step 5: Run parity self-tests and CI-relevant PENGU tests.**

  Run `npx tsx scripts/pengu-recovery-v8-parity-selftest.ts`, `npx tsx scripts/pengu-dual-ls-v2-selftest.ts`, and the existing PENGU V20 parity test. Require exact freeze metrics or report a fail-closed mismatch.

- [ ] **Step 6: Commit the parity slice.**

  Commit with message `test(pengu): verify Recovery V8 BT and restart parity`.

### Task 5: Full verification and guarded XServer LIVE activation

**Files:**
- Modify only the release/runtime configuration required for the PENGU V8 branch.
- VPS targets: the PENGU release directory, systemd unit/drop-in, and V8 runtime state only.

- [ ] **Step 1: Run local compile, self-tests, and build.**

  Run `npm install`, `npx tsc --noEmit -p tsconfig.pengu-dual-ls-v2.json`, all new/old PENGU self-tests, `npm run build`, and `git diff --check`. Record `ORDERS_SENT=0` for local verification.

- [ ] **Step 2: Verify V12/V52 unchanged.**

  Compare V12/V52 source files and configuration against the base `15c0b758...` tree; any unexpected diff stops the task.

- [ ] **Step 3: Push the tested branch before VPS activation.**

  Push `codex/pengu-recovery-v8-implementation-20260828` and record the exact SHA. Do not use Vercel.

- [ ] **Step 4: Deploy only the tested PENGU release to XServer VPS.**

  Transfer the built PENGU files over SSH using the Desktop key, verify SHA256, and do not touch V12/V52 release files or services.

- [ ] **Step 5: Run VPS read-only preflight and reconciliation.**

  Confirm current PENGU state, open orders, positions, Kill Switch, shared risk, code SHA, and `tradingMutation` before activation. Any active unmanaged position, pending order mismatch, missing protective state, or stale/invalid reference fails closed.

- [ ] **Step 6: Activate PENGU V8 LIVE only after all gates pass.**

  Enable the PENGU V8 runtime in the XServer systemd environment, start/restart only the PENGU service if required by the deployment, and verify `LIVE`, process health, strategy ID, protective-order readiness, and `ORDERS_SENT=0` for the deployment itself. No synthetic/test order is sent.

- [ ] **Step 7: Verify natural-signal readiness and report.**

  Confirm V8 is capable of reaching its order/protective path without forcing a signal, while shared Kill Switch/Fail Closed remain active safeguards. If any live preflight or reconciliation check fails, leave V8 inactive and report the exact failure.

- [ ] **Step 8: Commit any release metadata and push final SHA.**

  Run fresh `git status`, `git diff --check`, and the full verification command set before the final push/report. The final report must include branch, SHA, changed files, tests, freeze metrics, `V12 unchanged`, `V52 unchanged`, and live/VPS/order flags.
