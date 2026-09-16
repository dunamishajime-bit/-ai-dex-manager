# Final Integrated Logic + V52 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the validated V12/PENGU/Q102/PENGU/V52/shared-risk contracts from the current Production runtime, synchronize the live HP/UI, repair V52 day-boundary telemetry, persist candidate cost evidence, and deploy only after all parity, safety, and runtime gates pass.

**Architecture:** The trading runtime branch starts at Production SHA `b8fd5d721a4e898b77e9910cf3cb772d9867e24d`. The live HP is a separate UI release lineage, currently derived from `a6d753bb1425d81d2f7ae9c608318044864be6ff`; it will be updated in a second UI branch/release without importing research-only code. Shared contract constants are the source of truth for runtime, snapshots, API, and UI; V52 persists a day-scoped diagnostic document and append-only cost telemetry. Live restart is gated by baseline parity, integrated BT, tests, build, GitHub Actions, authenticated read-only Aster preflight, Margin Guard HEALTHY, and zero mutation evidence.

**Tech Stack:** TypeScript/tsx, Python 3, Node test runner, Next.js, systemd, Aster V3 authenticated read-only API, PowerShell/SSH deployment tooling.

**Spec:** `docs/research-results/v52-final-validated-logic-20260917.md` and the user-provided Production integration contract in the task request.

## Global Constraints

- Never deploy the research branch; the trading runtime must be based on current Production `b8fd5d721a4e898b77e9910cf3cb772d9867e24d`.
- Preserve V12 signal logic, Top2, 2 positions, 1.00x per-position, 1.50x aggregate, and 5x Cross.
- Preserve current Production PENGU signal/direction/entry/exit/hard-stop/recovery logic; change allocation to 0.85x and retain Recovery V8 plus 24h hard-stop cooldown.
- Use Q102 Causal V4 generator/selector/planner/reconciliation/live adapter, 1.50x gross, exactly 1 slot, no fixed CSV playback.
- Preserve V11; set V50 to basis 60bps, convergence 20bps, basis stop 1.75x, net edge 7.5bps, max cost 60bps, spread 20bps, POST_EARLY3, 3h, BOTH, slot 1.00x.
- Set shared caps to Crypto 3.00x, Stock 1.50x, Total 3.50x; shared crypto daily loss is 7.5% and stock daily loss remains 3.5%.
- Require Aster 5x Cross and Margin Guard HEALTHY; fail closed on mismatch, stale state, unknown state, or unsafe maintenance/liquidation evidence.
- Do not send synthetic, test, dummy, micro, forced entry, forced exit, or verification orders.
- Preserve shared account lock, Kill Switch, ownership, stale-data, reconciliation, and fail-closed semantics.
- Historical BT artifacts and Research-only fixtures remain unchanged; only runtime/production contracts and new evidence files are changed.

---

### Task 1: Establish production/runtime and UI baselines

**Files:**
- Read only: `config/v12X1AllRuntime.ts`, `config/penguDualLsV2Runtime.ts`, `config/penguRecoveryV8.ts`, `config/disdexStrictBt33404708902Runtime.ts`, `scripts/disdex_v52_aster_only_legacy_engine.py`, `scripts/disdex_strict_portfolio_planner.py`, `scripts/ops/root/disdex-current-runtime-wiring`.
- Test inventory: `tests/`, `scripts/*selftest*`, `package.json`.
- UI baseline branch: `a6d753bb1425d81d2f7ae9c608318044864be6ff`.

**Interfaces:**
- Produces a recorded baseline table of current Production values versus the Research target.
- Produces the exact test command list and the current Aster/Margin Guard read-only evidence used by later deployment gates.

- [ ] Confirm `b8fd...` is the current VPS marker and branch base; do not edit the dirty parent worktree.
- [ ] Record current Production values: V12 formal params, PENGU caps and cooldowns, Q102 caps/selector/live flags, V50 constants, strict caps, shared daily-loss contract, and Margin Guard requirements.
- [ ] Record current UI source/release separately from runtime source; do not merge unrelated UI history into the runtime branch.
- [ ] Run the existing baseline self-tests without modifying state and save exit codes in `reports/final-integrated-live-v52-baseline-20260917.json`.
- [ ] Stop with `BLOCKED_BASELINE_FAILURE` if baseline tests fail for a reason introduced by the base commit or if the current production contract cannot be identified.

### Task 2: Add failing canonical contract tests

**Files:**
- Create: `tests/final-integrated-logic-contract.test.ts`.
- Modify only if needed for test imports: `package.json` test script aliases.

**Interfaces:**
- Tests import `V12_X1_ALL`, `PENGU_DUAL_LS_V2`, `STRICT_BT33404708902`, the new shared-cap resolver, and V52 policy constants.
- Tests assert exact values and reject stale environment overrides with named fail-closed errors.

- [ ] Write RED assertions for PENGU 0.85x, Q102 1.50x/1-slot, crypto 3.0x, total 3.5x, V50 B60/C20/Stop1.75/Edge7.5, and stale 2.0/2.5 overrides.
- [ ] Write RED assertions that V12 formal signal parameters and 1.0x/1.5x sizing are unchanged.
- [ ] Write RED assertions that V11 remains identity-equivalent and V52 cost/spread ceilings remain 60/20.
- [ ] Run `npx tsx --test tests/final-integrated-logic-contract.test.ts`; record expected failures before implementation.

### Task 3: Implement canonical shared contract and sizing changes

**Files:**
- Modify: `config/disdexStrictBt33404708902Runtime.ts`.
- Modify: `config/penguDualLsV2Runtime.ts`.
- Modify: `lib/disdex-strict-portfolio-planner.ts`.
- Modify: `scripts/disdex_strict_portfolio_planner.py`.
- Modify: `lib/disdex-unified-portfolio-routing.ts` and Q102 runtime/selector files where the 1.00x cap is the production Causal V4 cap.
- Modify: shared risk writer/state/snapshot files that expose caps.
- Test: `tests/final-integrated-logic-contract.test.ts`, existing strict planner and Q102 sizing tests.

**Interfaces:**
- Introduce one immutable `IntegratedProductionRiskContract` resolver consumed by TypeScript and Python-facing environment validation.
- Resolver returns `{penguMaximumGross: 0.85, q102CausalV4Gross: 1.5, q102MaximumPositions: 1, cryptoGrossCap: 3, stockGrossCap: 1.5, totalGrossCap: 3.5, cryptoDailyLossPct: 7.5, stockDailyLossPct: 3.5}`.
- Any explicit conflicting legacy environment value raises `*_CONTRACT_MISMATCH` and blocks new exposure.

- [ ] Implement the smallest canonical resolver and wire PENGU/Q102/Shared Risk/strict planner to it.
- [ ] Change Q102 live Causal V4 cap to 1.50x while keeping one slot, base priority, ownership, MTM reduction, and live reconciliation.
- [ ] Change PENGU allocation cap to 0.85x without changing existing signal thresholds, direction priority, Recovery V8 behavior, or hard-stop cooldown.
- [ ] Change strict crypto/total caps to 3.0/3.5; keep stock 1.5; update reservations and gross snapshots so `crypto + stock == total` remains enforced.
- [ ] Run the new contract tests and the strict planner/Q102/PENGU tests; fix only implementation failures caused by these exact contract changes.

### Task 4: Implement V52 policy, day-scoped diagnostics, and cost telemetry

**Files:**
- Modify: `scripts/disdex_v52_aster_only_legacy_engine.py`.
- Modify: `scripts/disdex_v13d_v11eq_stock_live_engine.py` only for shared V11 constants used by V50; preserve V11 behavior.
- Create or modify: `scripts/disdex_v52_telemetry.py` for pure policy/serialization helpers.
- Create: `tests/v52-integrated-policy-and-telemetry.test.ts` and `tests/test_v52_integrated_policy.py`.
- Modify: `tests/test_v52_*` relevant contract fixtures without rewriting historical artifacts.

**Interfaces:**
- `current_ny_day(now=None) -> str` returns the NY calendar day.
- `ensure_v52_day_state(state, ny_day) -> state` atomically resets only day-scoped diagnostics when the stored day differs and preserves ledger, positions, ownership, and reconciliation fields.
- `build_v52_cost_telemetry(...) -> dict` returns the required non-secret fields and finite numeric validation.
- `append_v52_cost_telemetry(path, row)` appends one JSONL row under the existing runner lock; invalid rows fail closed.

- [ ] Add RED tests for stale `nyDay`, `v50DailyEntriesDay`, rejection counters, decisions, accepted candidates, lastDecision, v50Top2Telemetry, and signal snapshots.
- [ ] Change V50 values to B60/C20/Stop1.75/Edge7.5 while preserving Cost60/Spread20/POST_EARLY3/3h/BOTH/slot1.00.
- [ ] Normalize rejection reason strings to current thresholds (`BASIS_BELOW_60`, `NET_EDGE_BELOW_7_5`) and prevent prior-day reasons from being surfaced as current.
- [ ] Add candidate/decision telemetry fields: timestamp, NY day, strategy, symbol, window, direction, signal/current basis, estimated cost, maker/taker fees, spread, VWAP slippage, safety buffer, net edge, max cost, min edge, accepted/rejected, reasons, requested/accepted gross, available stock gross, and total gross before/after reservation.
- [ ] Ensure append-only telemetry never contains credentials, signatures, private keys, or raw auth headers.
- [ ] Run day-reset, stale/current-day, cost gate, >60bps fail-closed, and V11 identity tests; verify RED→GREEN.

### Task 5: Preserve and validate Aster 5x Cross Margin Guard

**Files:**
- Modify: `scripts/disdex_v96_v52_margin_guard.py` only to consume dynamic ownership/canonical caps if required; preserve fail-closed checks.
- Modify: `scripts/disdex_v96_v52_margin_guard_runtime.py` only for explicit runtime snapshot fields.
- Modify: `scripts/ops/root/disdex-current-runtime-wiring` and systemd/env templates.
- Create: `tests/margin-guard-integrated-cap-contract.test.ts`.

**Interfaces:**
- `resolve_managed_symbols()` includes fixed managed symbols plus active/pending V12/Q102 ownership.
- `verify_managed_configuration()` requires `leverage == 5` and normalized `marginType == cross` for every target symbol.
- Read-only preflight returns maintenance margin ratio, liquidation buffer, position initial margin, open-order initial margin, equity, positions, and open orders with zero mutation counters.

- [ ] Add RED tests for all new cap/env wiring and dynamic-symbol 5x Cross requirements.
- [ ] Ensure new caps do not relax Margin Guard; a mismatch remains NO ENTRY and does not auto-mutate venue state in preflight.
- [ ] Ensure runtime contract exports `ASTER_REQUIRED_LEVERAGE=5`, `ASTER_REQUIRED_MARGIN_TYPE=cross`, crypto 3.0, stock 1.5, total 3.5, and shared loss 7.5.
- [ ] Run Python/TypeScript Margin Guard and reconciliation tests with synthetic clients only; no VPS order calls.

### Task 6: Build a formal parity/BT verification harness

**Files:**
- Modify/create: `scripts/final-integrated-logic-bt.ts` or the existing canonical BT entrypoint discovered in Task 1.
- Create: `tests/final-integrated-bt-contract.test.ts`.
- Create: `reports/final-integrated-bt-20260917.json`.
- Preserve: Research JSON artifacts unchanged.

**Interfaces:**
- BT input is fixed to `2025-08-10T00:00:00Z` through `2026-08-10T00:00:00Z`, initial ¥10,000, monthly ¥10,000 x12, total ¥130,000, compounding ON.
- Harness emits baseline NORMAL/SEVERE and integrated NORMAL-40bps/SEVERE-stock-100bps with ending asset, PF, DD, executions, sleeve PnL/trades, gross conflicts, and V52 trade count.

- [ ] Re-run baseline parity first and assert the exact supplied baseline within the established serialization tolerance.
- [ ] If baseline does not reproduce, stop with `INVALID_COMPARISON` and do not implement/deploy further.
- [ ] Run the integrated candidate and assert supplied expected values, SEVERE DD <=20%, and V52 trades=0 at 100bps.
- [ ] Record Research evidence limitations: the exact historical 24–60bps Gate sweep is not identifiable without historical order-book data; preserve 60bps fail-closed ceiling and validate live telemetry capture instead.

### Task 7: Update HP/UI from the current live UI lineage

**Files:**
- New UI worktree/branch from current UI SHA `a6d753bb1425d81d2f7ae9c608318044864be6ff`.
- Modify/create: `lib/disterminal-live-config.ts`, `lib/server/v52-top2-observability.ts`, `lib/server/disdex-decision-status.ts`, `lib/server/quality102-runtime-observability.ts`.
- Modify: `app/page.tsx`, `app/positions/page.tsx`, `app/decision-status/page.tsx`, `components/features/DecisionStatusPanel.tsx`, responsive layout components.
- Test: UI contract tests, mobile rendering/test scripts, typecheck, production build.

**Interfaces:**
- UI reads live runtime snapshot thresholds; it must not hardcode a contradictory fallback.
- V52 observability returns `telemetryState: FRESH_NO_CANDIDATE | FRESH_CANDIDATE | STALE | UNAVAILABLE`, current-day diagnostics only, current thresholds, and freshness timestamps.
- UI copy displays V12 Top2/1.00/1.50, PENGU 0.85/Recovery V8/24h, Q102 Causal V4/1.50/1 slot, V52 B60/C20/Stop1.75/Edge7.5/Cost60/Spread20, Shared 3.00/1.50/3.50/7.5, and Aster 5x Cross.

- [ ] Add RED UI tests for old Q102 0.50/2.00/2.50 and old V52 B65/Edge5 strings.
- [ ] Replace UI static thresholds with runtime contract/snapshot values.
- [ ] Distinguish fresh “本日判定済み / 条件適合候補なし” from “Runner telemetry未取得” and “STALE / 発注不可”.
- [ ] Show candidate basis, required basis, cost, net edge, spread, latest decision, reason, timestamp, and freshness on PC and mobile layouts.
- [ ] Run UI tests, `npx tsc --noEmit`, and `npm run build` in a clean UI worktree.

### Task 8: Complete test, lint, typecheck, build, and GitHub Actions gates

**Files:**
- Test reports: `reports/final-integrated-test-summary-20260917.json`.

- [ ] Run all required V12/PENGU/Q102/V52/shared-risk/Margin Guard/reconciliation/watchdog/history/status/UI tests.
- [ ] Run Python self-tests and contract tests.
- [ ] Run typecheck and production build for runtime and UI.
- [ ] Separate pre-existing unrelated failures from changes in this branch; any new failure blocks the release.
- [ ] Commit runtime branch and UI branch separately with exact changed-file lists; push both only after local gates pass.
- [ ] Verify local SHA equals GitHub remote SHA for each branch.
- [ ] Verify GitHub Actions completed successfully; “No jobs were run” is not green.

### Task 9: VPS immutable release, live restart, and final verification

**Files:**
- Deployment inputs are the pushed runtime/UI commits only; no VPS-only source edit.
- Release marker and systemd wiring generated from the new runtime commit.

- [ ] Before mutation, repeat authenticated Aster read-only: positions, open orders, balance/equity, maintenance margin, liquidation buffer, position/open-order initial margin, margin type/leverage, Kill Switch, Shared Risk, Margin Guard, Q102 ownership, and mutation counters.
- [ ] Abort fail closed if not flat/reconciled, Kill Switch active, Margin Guard not HEALTHY, any unknown/orphan order/position exists, any 5x Cross mismatch exists, or stale state is unresolved.
- [ ] Create immutable `/home/deploy/disdex-trading/releases/<NEW_SHA>` from pushed GitHub source; preserve rollback `b8fd...` and dependencies.
- [ ] Apply/check runtime wiring atomically; ensure current symlink and every active service/support timer points to the new SHA; old active SHA count must be zero.
- [ ] Restart Shared Risk/Margin Guard first, then V12/PENGU/Q102/V52 one at a time; verify active/running, PID, NRestarts=0, runtime SHA, state/reconciliation heartbeat, and no duplicate unit.
- [ ] Confirm Shared Risk state refreshes to `maximumLossPct=7.5`, current UTC day, finite PnL, valid hash, expected strategy IDs, and not stale.
- [ ] Confirm V52 current NY day reset and cost telemetry file updates with no mutation; no forced signal/order.
- [ ] Deploy UI through its XServer UI release path, then verify PC/mobile HTTP/API responses and all new display values.
- [ ] Run final read-only Aster reconciliation and compare before/after positions/open orders/protective orders; synthetic/test/unintended orders, cancels, and position changes must remain zero.
- [ ] Verify watchdog, health snapshot, history sync, position recovery, fill notifier, timers, failed units, journal restart loops, disk state, and rollback release retention.
- [ ] Only then report `STATUS: FINAL_INTEGRATED_LOGIC_LIVE_VERIFIED`; otherwise report `STATUS: BLOCKED_<REASON>` with exact evidence.
