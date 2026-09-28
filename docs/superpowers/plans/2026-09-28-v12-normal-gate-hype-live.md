# V12 Normal Gate + HYPE Live Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the verified V12 normal-gate threshold change together with the tested high-win HYPE long sidecar, while preserving every existing strategy and safety contract.

**Architecture:** Start from the GitHub V12 handoff branch, add HYPE as a lowest-priority, operator-gated Aster sidecar using the same account lock, pending-exposure registry, strict portfolio planner, 5x Cross gate, and reduce-only protective-order ownership used by the existing runtime. The HYPE live signal must consume completed Aster 1h candles and use the BT-pinned EMA12/48, 24h breakout, regime EMA240/slope25, ATR14, 2.5 ATR stop, 3 ATR trail, and 168h maximum hold contract. V12's only production logic delta remains Score 1.4649 -> 1.00 and volume ratio 0.9845 -> 0.80.

**Tech Stack:** TypeScript/tsx, Node test runner, systemd template units, shell runtime wiring, Aster V3 REST client, GitHub Actions.

**Spec:** `docs/implementation/V12_NORMAL_GATE_ONLY_PRODUCTION_HANDOFF_20260928.md` plus the current approved HYPE research contract from the fixed Aster ledger replay.

## Global Constraints

- Do not modify the dirty primary checkout or existing research worktree.
- Do not reset or force-checkout the VPS to an older SHA.
- V12 production source changes are limited to `neutralScoreThreshold=1.00` and `minimumVolumeRatio=0.80`.
- Keep Strong Regime rescue, Momentum rescue without a score floor, HC1.75, WinRate Gate, Top3, Rank3 score/gross, stops, cooldowns, reservations, Shared Risk, Margin Guard, operator gate, Kill Switch, and all other strategies unchanged.
- HYPE is lowest priority, long-only, Gross 1.5x research candidate only if the live contract explicitly pins it; it may not consume core capacity or violate Crypto/Total caps.
- HYPE entries require existing + pending + reserved + candidate worst-case Gross reservation, 5x Cross read-back, account lock, fresh quote, valid exchange filters, and two read-back-verified reduce-only protective orders.
- No synthetic, test, forced, manual, or probe orders may be sent to Aster.
- HYPE real execution remains operator-gated until all preflight and reconciliation checks pass.

## Review Focus

- HYPE live signal must use completed 1h data and never use the current incomplete candle; test with a future/incomplete bar.
- HYPE must be rejected when core/pending Gross leaves no capacity; test that core trade count and V12 reservations are unchanged.
- HYPE entry failure or ambiguous exchange response must leave state in manual review and send no second exposure order.
- Protective stop/TP quantities must match the filled HYPE position and both must be reduce-only after read-back.
- A stale or mismatched operator artifact must block the HYPE unit independently of V12/PENGU/Q102/V52.

### Task 1: Establish candidate branch and RED contracts

**Files:**
- Create: `tests/hype-trend-live-contract.test.ts`
- Create: `tests/hype-trend-runner-gate.test.ts`
- Create: `tests/hype-systemd-contract.test.mjs`

- [ ] **Step 1: Write failing tests** for the HYPE 1h trend parameters, completed-bar-only behavior, Gross reservation/core priority, operator gate, and required service wiring.
- [ ] **Step 2: Run the new tests** and confirm they fail because the handoff branch has no HYPE production implementation/service.
- [ ] **Step 3: Record baseline branch/remote SHA and preserve the original V12 handoff evidence.**

### Task 2: Add the HYPE trend signal and live market-data contract

**Files:**
- Create or modify: `config/hypeTrendLongPolicy.ts`
- Create or modify: `lib/hype-trend-long-signal.ts`
- Create or modify: `lib/hype-zec-long-market-data.ts`
- Test: `tests/hype-trend-live-contract.test.ts`

**Interfaces:**
- `HYPE_TREND_LONG_POLICY` exposes exact signal, risk, Gross, leverage, and margin values.
- `buildHypeTrendSignal(input)` consumes completed Aster 1h BTC/HYPE candles and returns a signal or an explicit rejection reason.

- [ ] **Step 1:** Define the exact HYPE contract: EMA12/48, 24h breakout, minimum breakout30bps, maximum distance900bps, regime EMA240/slope25bps, ATR14, stop2.5, trail3, max hold168h, risk5%, Gross1.5x, 5x Cross, LONG, lowest sidecar.
- [ ] **Step 2:** Implement completed-bar normalization, gap/duplicate checks, and signal evaluation without look-ahead.
- [ ] **Step 3:** Run the focused tests and confirm GREEN.

### Task 3: Integrate HYPE execution safety and state

**Files:**
- Modify: `lib/hype-zec-long-runner.ts` or create `lib/hype-trend-long-runner.ts`
- Modify: `lib/hype-zec-long-runner-state.ts` or create the trend state store
- Modify: `lib/disdex-strict-portfolio-planner.ts`
- Modify: `lib/disdex-aster-portfolio-classifier.ts`
- Modify: `lib/disdex-managed-protective-orders.ts`
- Test: `tests/hype-trend-runner-gate.test.ts`

**Interfaces:**
- Entry planner must evaluate existing/pending/reserved/candidate Gross before any executor call.
- State must be exact-SHA, regular-file, deploy-owned, mode0600, and migration-aware.

- [ ] **Step 1:** Add failing tests for core-priority capacity blocking, stale quote blocking, 5x Cross mismatch, ambiguous execution, duplicate protection prevention, and state lineage mismatch.
- [ ] **Step 2:** Implement the minimum runner/state/planner changes; preserve existing PENGU/Q102/V12/V52/FET behavior byte-for-byte where unrelated.
- [ ] **Step 3:** Verify that every exposure mutation is behind the shared account lock and operator gate, and that protection installation is reduce-only/read-back verified.
- [ ] **Step 4:** Run focused runner tests and existing portfolio/safety tests.

### Task 4: Add runtime wiring and systemd support

**Files:**
- Modify: `scripts/ops/root/disdex-current-runtime-wiring`
- Create: `ops/systemd/disdex-hype-long@.service`
- Create or modify: runtime wiring contract tests
- Test: `tests/hype-systemd-contract.test.mjs`

- [ ] **Step 1:** Add RED assertions for exact SHA runtime env, disabled-by-default state, root-owned operator artifact requirement, no legacy duplicate unit, and HYPE state path ownership/mode.
- [ ] **Step 2:** Add the HYPE env/drop-in and systemd unit with ExecStartPre gate; keep real execution disabled until the exact target SHA artifact is approved.
- [ ] **Step 3:** Run runtime wiring, systemd, operator gate, and typecheck tests.

### Task 5: Integrate the V12 handoff and verify the full candidate

**Files:**
- Modify only the handoff's `config/v12X1AllRuntime.ts` thresholds plus the HYPE integration files above.
- Add: `docs/implementation/V12_HYPE_LIVE_INTEGRATION_20260928.md`

- [ ] **Step 1:** Verify the V12 diff against `a09ea45...` contains only the two approved thresholds plus explicitly reviewed HYPE integration files.
- [ ] **Step 2:** Run V12, PENGU, Q102, FET, V52, Shared Risk, Margin Guard, HYPE, operator gate, runtime wiring, and no-order safety tests.
- [ ] **Step 3:** Run typecheck and production build.
- [ ] **Step 4:** Run the fixed-ledger HYPE BT/parity evidence check and record that this is research/overlay evidence, not live-fill proof.
- [ ] **Step 5:** Commit and push the combined candidate; confirm local/remote SHA equality and a real Green GitHub Actions run.

### Task 6: VPS read-only preflight and immutable deployment

- [ ] **Step 1:** Re-read current VPS release, active units, old-SHA processes, Aster positions/open orders/protections, Shared Risk, Margin Guard, Kill Switch, disk, rate-limit, lock, and operator artifact.
- [ ] **Step 2:** Build an immutable release from the exact pushed SHA and verify marker, dependencies, wiring, and rollback release.
- [ ] **Step 3:** Apply current-runtime wiring check/apply/check without changing state or sending orders.
- [ ] **Step 4:** Reconcile HYPE state and existing positions before enabling any runner; do not delete or flatten positions.

### Task 7: Operator-gated LIVE activation and final verification

- [ ] **Step 1:** If the target SHA artifact is missing/stale/invalid, stop with `BLOCKED_OPERATOR_LIVE_ACTIVATION_REQUIRED` and leave trading fail-closed.
- [ ] **Step 2:** If valid, activate only the required new-SHA units in dependency order, including HYPE, with old-SHA active count zero.
- [ ] **Step 3:** Verify every runner's ActiveState/SubState/MainPID/NRestarts/runtime SHA, HYPE signal heartbeat, state ownership, Shared Risk, Margin Guard, 5x Cross, HP status, and watchdog/auto-repair gates.
- [ ] **Step 4:** Perform final Aster read-only reconciliation and prove deployment orders/cancels/position changes are zero.
- [ ] **Step 5:** Report `LIVE_ACTIVATED_VERIFIED` only if every item is freshly evidenced; otherwise report the exact blocker.
