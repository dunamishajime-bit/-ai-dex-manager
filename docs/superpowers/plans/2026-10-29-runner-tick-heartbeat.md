# Runner Tick Heartbeat Truthfulness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the production health snapshot distinguish supervisor writes from the last completed decision cycle for every production Runner, including held, locked, no-signal, and market-closed cycles.

**Architecture:** Add a small language-neutral JSON marker contract at `/var/lib/disdex/runner-health/ticks/<runner>.json`. TypeScript and Python Runner entrypoints write the marker atomically after each completed cycle; the read-only health snapshot validates the marker's identity, SHA, service unit, timestamps, and freshness before allowing that Runner's new orders. Existing strategy state files and all exchange/order/risk paths remain unchanged.

**Tech Stack:** TypeScript/Node.js `fs/promises`, Python 3 standard library, Node test runner via `tsx --test`, Python `unittest`, systemd environment paths.

**Spec:** `docs/superpowers/specs/2026-10-29-runner-tick-heartbeat-design.md`

## Global Constraints

- No exchange API request, order, cancel, position change, STOP change, or Kill Switch operation is added.
- No signal, entry, exit, Gross, Daily Loss, Shared Risk, Margin Guard, or operator-activation policy is changed.
- No AVAX/HYPE economic behavior is promoted to LIVE by this change.
- Existing immutable releases and current systemd services remain active until the new SHA passes CI, venue read-only reconciliation, and a fresh SHA-bound operator gate.
- The marker is monitoring evidence only; a missing or invalid marker fails closed for that Runner.

## Review Focus

- Atomic replacement must never expose partial JSON; test a temp-file/rename failure boundary.
- A marker from another Runner or SHA must be rejected even when its timestamp is fresh.
- Future-dated markers and stale markers must deny that Runner while leaving unrelated peers scoped.
- Normal `no-signal`, `held`, `locked`, and market-closed cycles must refresh the marker.
- Marker write failures must not be interpreted as a healthy tick or enable an order path.

### Task 1: Define and test the tick-marker contract

**Files:**
- Create: `lib/disdex-runner-tick-heartbeat.ts`
- Create: `scripts/disdex_runner_tick_heartbeat.py`
- Test: `tests/runner-tick-heartbeat.test.ts`
- Test: `tests/test_runner_tick_heartbeat.py`

**Interfaces:**
- TypeScript produces `writeRunnerTickHeartbeat(input: RunnerTickHeartbeatInput): Promise<RunnerTickHeartbeat>` and `runnerTickHeartbeatPath(root: string, runnerId: string): string`.
- Python produces `write_runner_tick_heartbeat(runner_id, runtime_sha, service_unit, tick_started_at, tick_completed_at, status, reason, counters, root=None) -> dict`.
- Both emit schema `disdex-runner-tick-heartbeat/v1` with `runnerId`, `runtimeSha`, `serviceUnit`, `tickStartedAt`, `tickCompletedAt`, `status`, `reason`, and zero-or-positive `ordersSent`, `cancelsSent`, `positionChangesSent`.

- [ ] **Step 1: Write failing tests** for valid payloads, SHA/runner validation, atomic file replacement, counters, future timestamps, and no mutation counters other than zero in Runner call sites.
- [ ] **Step 2: Run the focused TypeScript and Python tests** and confirm they fail because the contract helpers do not exist.
- [ ] **Step 3: Implement the two standard-library helpers** with strict validation, fixed production root fallback, temporary-file write, and same-directory rename; permit an explicit test root only through the function argument.
- [ ] **Step 4: Run the focused tests** and confirm they pass.
- [ ] **Step 5: Commit the isolated contract implementation** with message `feat: add atomic runner tick heartbeat contract`.

### Task 2: Record markers from every production Runner

**Files:**
- Modify: `scripts/v12-v4-production-runner.ts`
- Modify: `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`
- Modify: `scripts/disdex-quality102-causal-v1-live-runner.ts`
- Modify: `scripts/disdex-fet-brk48-live-runner.ts`
- Modify: `scripts/disdex-hype-zec-long-live-runner.ts`
- Modify: `scripts/disdex-idle-priority-short-live-runner.ts`
- Modify: `scripts/disdex_v52_aster_only_live_engine.py`
- Test: `tests/runner-tick-heartbeat.test.ts`
- Test: `tests/test_runner_tick_heartbeat.py`

**Interfaces:**
- Each loop records `tickStartedAt` immediately before its decision-cycle call and invokes its helper after the cycle result is available, including ordinary no-signal, held, lock-deferred, and market-closed results.
- Runtime SHA comes from the existing release/runtime SHA already used by the Runner; service unit is derived from the existing Runner identity and SHA.
- Marker counters are copied from the cycle result when present, otherwise zero; no new exchange calls are introduced.

- [ ] **Step 1: Add static failing assertions** that all seven production entrypoints import/use the marker writer, use the existing runtime SHA, and write after the cycle rather than before it.
- [ ] **Step 2: Run the contract tests** and confirm the call-site assertions fail.
- [ ] **Step 3: Add marker writes** to the existing loops without changing their wait, lock, signal, order, STOP, or error policies; a marker-write failure must propagate to the existing fail-closed outer handler.
- [ ] **Step 4: Cover the IDLE combined loop** with one `IDLE_PRIORITY_SHORT` marker after the final result of each outer cycle, including residual-only cycles.
- [ ] **Step 5: Add Python marker writes** after `prepare_tick_inputs`/`idle_tick`/`tick` decision completion and after lock-busy or upstream-hold outcomes, without changing the existing defer intervals.
- [ ] **Step 6: Run focused tests, Python compile, and each Runner self-test**; confirm all mutation counters remain zero in self-test paths.
- [ ] **Step 7: Commit the Runner instrumentation** with message `fix: record completed runner ticks for health monitoring`.

### Task 3: Make the read-only health snapshot consume tick markers

**Files:**
- Modify: `scripts/ops/root/disdex-runner-health-snapshot-current.mjs`
- Test: `tests/runner-health-tick-contract.test.mjs`
- Test: `tests/test_runtime_health_snapshot_current.py`

**Interfaces:**
- Add `DISDEX_HEALTH_SNAPSHOT_TICK_ROOT` with fallback `/var/lib/disdex/runner-health/ticks`.
- Each Runner definition has an explicit `tickMaxAgeMs`; defaults are bounded to the Runner cadence and are not derived from strategy state age.
- `readRunnerTickHeartbeat(runner, now)` returns `{ present, valid, fresh, reason, marker }` and never mutates state.

- [ ] **Step 1: Write failing tests** for missing, malformed, wrong-SHA, wrong-runner, wrong-service, future, stale, and fresh marker cases; assert a peer block is scoped to the affected Runner.
- [ ] **Step 2: Run the focused tests** and confirm the snapshot has no marker reader yet.
- [ ] **Step 3: Implement marker validation** and use marker `tickCompletedAt` as `heartbeat.lastTickAt`; keep `heartbeatAt` equal to the supervisor snapshot time.
- [ ] **Step 4: Set `safetyState=BLOCKED`, `newOrdersAllowed=false`, and a concrete `healthReason`** when the marker is missing/invalid/stale; preserve disabled V52 handling and global Shared Risk/Margin/Kill Switch behavior.
- [ ] **Step 5: Include marker diagnostics** in the read-only output, including marker age and status, without adding any order or API operation.
- [ ] **Step 6: Run focused tests and the snapshot self-test** and confirm all existing read-only counters remain zero.
- [ ] **Step 7: Commit the snapshot integration** with message `fix: fail closed on stale runner tick evidence`.

### Task 4: Verify, review, and prepare an immutable release

**Files:**
- Modify only if needed by tests: the Task 1–3 files.
- Test: existing CI contract suites plus the new focused tests.

- [ ] **Step 1: Run TypeScript typechecks, Python compile/unittests, all relevant Runner self-tests, and the full existing contract suite.**
- [ ] **Step 2: Run the new snapshot for at least three read-only cycles in a disposable/test root and confirm `heartbeatAt` changes independently of `lastTickAt`.
- [ ] **Step 3: Run the repository review and inspect the diff for order/cancel/position/STOP/Kill Switch changes; reject any unrelated production behavior.
- [ ] **Step 4: Run the fresh Aster signed read-only reconciliation three times with safe pacing, proving DOGE SHORT 226, its exact V4 STOP, zero order/cancel/position mutations, Shared Risk, Margin Guard, pending exposure, and no API-budget bypass.
- [ ] **Step 5: Push a new PR, wait for all required CI, merge only the final verified head, and create a new immutable VPS release; keep the current symlink/systemd units unchanged until the fresh SHA-bound operator gate is present.
- [ ] **Step 6: Ask the fresh reviewer to review the final diff and address only actionable findings.
- [ ] **Step 7: Report the new SHA, test/CI evidence, Aster evidence, and any remaining activation blockers without claiming Production cutover unless every formal gate passes.

