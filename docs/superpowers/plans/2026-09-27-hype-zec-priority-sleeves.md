# HYPE/ZEC Priority Sleeves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add independently evaluated HYPE LONG and ZEC LONG crypto sleeves with risk-based sizing, a 1.0x Gross ceiling, 5x Cross venue gating, and deterministic reduce-only preemption when a higher-priority existing Production strategy needs capacity.

**Architecture:** Keep signal generation and risk sizing pure and independently testable. Extend the existing strict portfolio planner with explicit low-priority sidecar ownership and a bounded preemption plan; execute that plan through the existing account lock and Aster adapter, then re-read positions and protective orders before any new exposure order. Add a SHA-pinned runner contract without enabling real orders by default.

**Tech Stack:** TypeScript, Node test runner via `tsx`, existing Aster V3 client/direct executor, existing strict portfolio planner, systemd release wiring.

**Spec:** The approved chat design: HYPE LONG risk 5.0% of equity at protective STOP, ZEC LONG risk 4.5% of equity at protective STOP, each capped at GROSS 1.0x, venue leverage 5x Cross, existing Production strategies have priority, sidecar reduction is reduce-only and bounded at 50% maximum, and all failures remain fail-closed.

## Global Constraints

- HYPE risk budget is 5.0% of current equity at the validated protective STOP, including configured fee/slippage buffer.
- ZEC risk budget is 4.5% of current equity at the validated protective STOP, including configured fee/slippage buffer.
- HYPE and ZEC are long-only and each has a maximum Gross of 1.0x; risk sizing may produce a smaller notional.
- New exposure requires exact Aster leverage 5 and Cross margin read-back before submission.
- Existing V12, PENGU, Q102, FET, V52, Shared Risk, Margin Guard, account-lock, Kill Switch, and Fail Closed contracts remain unchanged.
- A sidecar may be reduced only by a reduce-only order under the shared account lock, never by an exposure order or blind cancellation.
- A sidecar reduction is at most 50% of the eligible quantity and never larger than the capacity deficit requires.
- After partial reduction, remaining protective STOP/TP quantities must be reconciled and read back before any priority entry.
- No synthetic, test, dummy, or manual market orders are used for validation.
- This plan does not authorize VPS deployment or operator activation.

## Review Focus

- Risk/Gross conflict: risk-derived quantity must never exceed GROSS 1.0x; covered by HYPE and ZEC sizing tests.
- Partial-fill ambiguity: uncertain reduction execution blocks the priority entry and preserves manual review; covered by executor tests.
- Protection mismatch after reduction: stale or duplicate STOP/TP blocks the priority entry; covered by protection reconciliation tests.
- Priority inversion: a sidecar may not preempt a higher-priority strategy or preempt without an accepted priority candidate; covered by planner tests.
- Restart/idempotency: the same preemption request must not reduce twice after a restart; covered by durable pending/idempotency tests.

---

### Task 1: Freeze the HYPE/ZEC production contract and ownership model

**Files:**
- Create: `config/hypeZecLongPolicy.ts`
- Modify: `lib/disdex-aster-portfolio-classifier.ts`
- Modify: `lib/disdex-strict-portfolio-planner.ts`
- Test: `tests/hype-zec-policy.test.ts`

**Interfaces:**
- Produces `HYPE_ZEC_LONG_POLICY`, `HYPE_ZEC_STRATEGIES`, `isHypeZecStrategy`, and classifier ownership for `HYPEUSDT`/`ZECUSDT`.
- Extends `StrictStrategy` with `HYPE_LONG` and `ZEC_LONG` without changing existing strategy caps.

- [ ] **Step 1: Write failing tests** for exact risk percentages, 1.0x cap, 5x Cross requirement, long-only ownership, and sidecar priority below every existing Production sleeve.
- [ ] **Step 2: Run the focused test** and confirm RED because the policy and ownership are absent.
- [ ] **Step 3: Implement the policy and classifier changes** with explicit constants and fail-closed unknown-symbol handling.
- [ ] **Step 4: Run the focused test** and confirm GREEN.

### Task 2: Implement independent HYPE and ZEC long signal/risk sizing

**Files:**
- Create: `lib/hype-zec-long-sleeves.ts`
- Create: `tests/hype-zec-long-sleeves.test.ts`
- Modify: `config/hypeZecLongPolicy.ts`

**Interfaces:**
- Produces `evaluateHypeLongSignal(input)`, `evaluateZecLongSignal(input)`, `calculateHypeZecQuantity(input)`, and `buildHypeZecProtection(input)`.
- The signal inputs contain only completed candles and current read-only quote data; no future bars or live order state are used.

- [ ] **Step 1: Write failing tests** for HYPE BTC-gated breakout, ZEC independent reclaim/breakout, long-only rejection, stale data rejection, stop/TP generation, and risk-vs-Gross minimum sizing.
- [ ] **Step 2: Run the focused tests** and confirm RED.
- [ ] **Step 3: Implement pure signal, stop, and quantity functions** using the approved research parameters, with all thresholds named in the policy.
- [ ] **Step 4: Run the focused tests** and confirm GREEN.

### Task 3: Add deterministic sidecar preemption planning

**Files:**
- Modify: `lib/disdex-strict-portfolio-planner.ts`
- Create: `lib/hype-zec-preemption.ts`
- Test: `tests/hype-zec-preemption.test.ts`
- Test: `tests/strict-portfolio-hype-zec.test.ts`

**Interfaces:**
- Produces `planHypeZecPreemption(input)` and extends `planStrictPortfolio` with an explicit `allowHypeZecPreemption` option.
- A plan includes the exact sidecar position, reduction quantity, capacity released, cause idempotency key, and fail-closed reason.

- [ ] **Step 1: Write failing tests** for no-preemption without a priority candidate, capacity-deficit preemption, maximum 50% reduction, proportional reduction across two sidecars, priority ordering, pending/reserved Gross accounting, and hard-cap preservation.
- [ ] **Step 2: Run the focused tests** and confirm RED.
- [ ] **Step 3: Implement the pure planner** so existing planner calls keep their current behavior unless the new option is explicitly enabled by the HYPE/ZEC production route.
- [ ] **Step 4: Run the focused tests and all existing strict planner tests** and confirm GREEN.

### Task 4: Execute preemption safely through Aster

**Files:**
- Create: `lib/hype-zec-preemption-executor.ts`
- Create: `lib/hype-zec-runner-state.ts`
- Modify: `lib/disdex-managed-protective-orders.ts`
- Test: `tests/hype-zec-preemption-executor.test.ts`

**Interfaces:**
- Produces `executeHypeZecPreemption(input)` with states `reduced`, `not-needed`, or `blocked`.
- Requires an already-held account lock, fresh positions, no unmanaged open orders, exact 5x Cross read-back, and read-back confirmation of the post-reduction STOP/TP.

- [ ] **Step 1: Write failing tests** for reduce-only market submission, exact step-size rounding, partial fill, unknown execution, duplicate retry, protection replacement/read-back, and no mutation on any failed precondition.
- [ ] **Step 2: Run the focused tests** and confirm RED.
- [ ] **Step 3: Implement the executor** by reusing the existing DirectTradeExecutor/Aster adapter; persist pending state before mutation and clear it only after reconciliation.
- [ ] **Step 4: Run focused and existing protection/order-lock tests** and confirm GREEN.

### Task 5: Wire signal, planner, state, and systemd runner

**Files:**
- Create: `scripts/disdex-hype-zec-long-live-runner.ts`
- Create: `scripts/disdex-hype-zec-long-runner-selftest.ts`
- Create: `ops/systemd/disdex-hype-zec-long@.service`
- Modify: `scripts/ops/root/disdex-current-runtime-wiring`
- Modify: `config/integratedProductionRiskPolicy.ts`
- Test: `tests/hype-zec-runtime-wiring.test.mjs`

**Interfaces:**
- Runner is SHA-pinned, operator-gated, and disabled unless the new contract variables are exact.
- Existing priority runners may invoke the preemption executor, but no runner may bypass the shared account lock or protection read-back.

- [ ] **Step 1: Write failing wiring tests** for exact release SHA, operator gate, 5x Cross, risk/Gross env, state ownership/mode, support wiring, and old legacy runner exclusion.
- [ ] **Step 2: Run the wiring tests** and confirm RED.
- [ ] **Step 3: Implement the runner and release wiring** with default real-order disabled behavior and explicit operator activation separation.
- [ ] **Step 4: Run wiring self-tests and compile checks** and confirm GREEN.

### Task 6: Add deterministic integrated replay and contract evidence

**Files:**
- Create: `scripts/backtest-hype-zec-priority-sleeves.ts`
- Create: `tests/hype-zec-integrated-replay.test.ts`
- Create: `docs/implementation/HYPE_ZEC_PRIORITY_SLEEVES_CONTRACT_20260927.md`

- [ ] **Step 1: Write failing replay tests** for completed-bar ordering, monthly deposits, fee/slippage accounting, Gross reservation, sidecar preemption, and no PnL from rejected entries.
- [ ] **Step 2: Run the replay tests** and confirm RED.
- [ ] **Step 3: Implement the deterministic replay** and emit per-route ledger, preemption ledger, Gross timeline, DD timeline, and manifest.
- [ ] **Step 4: Run the replay for the approved period/data available in the repository** and record whether the source is sufficient for a Production decision.

### Task 7: Full verification, commit, and push

- [ ] **Step 1:** Run focused tests, strict planner regression tests, existing runner self-tests, TypeScript typecheck, and production build.
- [ ] **Step 2:** Run `git diff --check` and inspect the diff for signal/sizing changes outside the new HYPE/ZEC sleeves.
- [ ] **Step 3:** Commit the implementation with a focused message.
- [ ] **Step 4:** Push the detached commit to a new `codex/` remote branch and verify the remote SHA.
- [ ] **Step 5:** Do not deploy or enable operator activation; report the exact SHA, tests, replay evidence, and remaining deployment gates.
