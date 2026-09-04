# Four-Strategy Auto-Recovery and Quality102 HP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep V12, PENGU Recovery V8, V52, and `QUALITY102_CAUSAL_V1` operationally recoverable without weakening safety gates, and expose the same four-strategy status plus Q102 target symbols and conditions on the HP.

**Architecture:** Add a small, language-neutral heartbeat JSON contract. TypeScript runners and the Python V52/margin processes write the contract atomically; a root-owned allowlisted watchdog reads it, validates systemd state and immutable release identity, and performs bounded restarts only for operational failures. The HP reads a redacted status projection from the same heartbeat directory through a typed API, so Q102 status and symbols cannot drift from runtime configuration.

**Tech Stack:** TypeScript, Node.js `tsx`, Next.js App Router, React, Python 3, systemd, JSON state files, Node test runner, PowerShell/XServer deployment.

**Spec:** `docs/superpowers/specs/2026-09-05-four-strategy-auto-recovery-hp-design.md`

## Global Constraints

- Quality102 maximum Gross is `0.50x`; combined Crypto Gross is `2.00x`; total Gross is `2.50x`.
- Quality102 remains `QUALITY102_CAUSAL_V1` with selector mode `DERIVED_HIGH_VOL_ONLY`; historical selector parity remains explicitly false.
- Kill Switch, daily-loss latch, stale-data gate, reconciliation, account lock, managed-position ownership, and duplicate-order protection remain fail closed.
- Auto-recovery never submits, cancels, modifies, or force-closes an order or position.
- A Q102-local failure must not stop V12, PENGU, or V52; shared account uncertainty blocks all new orders through the existing global gate.
- Recovery must validate exact immutable release SHA and working directory before a runner can resume.
- No private key, secret, raw environment value, or credential is written to a heartbeat, API response, HP, log, commit, or artifact.
- No historical fixed CSV or fixed historical timestamp is used as a live signal input.
- The canonical deployment target is the XServer VPS; do not use Vercel.

## File Map

### Recovery contract and runners

- Create `lib/disdex-runner-health.ts`: typed heartbeat schema, atomic JSON persistence, stale classification, bounded recovery decision function.
- Create `scripts/disdex-runner-health-selftest.ts`: no-order contract self-test for liveness and safety-state decisions.
- Modify `scripts/disdex-v12-x1-all-live-runner.ts`: publish V12 heartbeat after each tick and on fatal/startup failure.
- Modify `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`: publish PENGU heartbeat after each tick and on fatal/startup failure.
- Modify `scripts/disdex-v13d-v11eq-v96-live-runner.ts`: publish supervisor/V52 heartbeat and preserve child failure fail-closed behavior.
- Modify `scripts/disdex-quality102-causal-v1-live-runner.ts`: publish Q102 heartbeat including selector mode, caps, effective symbols, safety state, and last decision.
- Create `scripts/disdex_runner_heartbeat.py`: Python implementation of the same redacted JSON contract for V52 and margin-guard processes.
- Modify `scripts/disdex_v52_aster_only_live_engine.py` and `scripts/disdex_v96_v52_margin_guard_runtime.py`: publish V52 operational heartbeats without changing order logic.

### Watchdog and systemd

- Create `scripts/disdex-runner-watchdog.ts`: allowlisted systemd/process/cwd/heartbeat observer and bounded restart executor.
- Create `scripts/disdex-runner-watchdog-selftest.ts`: injected-adapter self-test; it must never call systemd or an exchange.
- Create `ops/env/disdex-runner-watchdog.env.example`: non-secret unit map, heartbeat root, timeout, backoff, and attempt limits.
- Create `ops/systemd/disdex-runner-watchdog.service`: root-owned oneshot watchdog with restricted write paths.
- Create `ops/systemd/disdex-runner-watchdog.timer`: one-minute watchdog schedule.
- Create `scripts/ops/install-disdex-runner-health.sh`: idempotent installation of the watchdog units and safe per-runner environment/drop-in configuration.
- Modify `ops/systemd/disdex-quality102-causal-v1@.service`, `ops/systemd/disdex-v12-x1-all@.service`, and `ops/systemd/disdex-v96-v52-live.service`: provide heartbeat path/state-root settings and preserve `Restart=on-failure` and existing safety preflights. The deployed PENGU V8 process is supervised by the V96/V52 combined unit, so it is represented by the `PENGU_V8` heartbeat and is not given a second restart target.

### HP/API

- Create `lib/disdex-runtime-status.ts`: redacted four-runner status projection and stale-state mapping.
- Create `app/api/strategy/runtime-status/route.ts`: dynamic read-only API for all four runner records.
- Create `hooks/useStrategyRuntimeStatus.ts`: client polling hook with safe unavailable handling.
- Create `components/features/autotrade/StrategyRuntimeStatusPanel.tsx`: responsive four-strategy status and Q102 condition panel.
- Modify `app/page.tsx`: show the runtime status panel on the home page.
- Modify `app/positions/page.tsx`: show the same panel beside the existing live decision/history panels.
- Modify `components/features/autotrade/LiveDecisionPanel.tsx`: add an explicit link/section for the Q102判定条件 and target symbols using the shared status hook, without changing existing V12/PENGU decision calculations.

### Tests and CI

- Create `tests/disdex_runner_health.test.ts`: heartbeat schema, stale/dead/drift decisions, bounded retry, safety-state preservation, and Q102-local isolation.
- Create `tests/disdex_runtime_status.test.ts`: four-strategy projection, Q102 symbols/caps, redaction, stale-to-要確認 mapping.
- Modify `package.json`: add `strategy:runner-health:selftest`, `strategy:runner-watchdog:selftest`, and `strategy:runtime-status:test` commands.
- Create `.github/workflows/disdex-runner-health-ci.yml`: run focused tests, existing runner regressions, typecheck, and production build at the pushed SHA.
- Create `docs/implementation/disdex-four-strategy-auto-recovery.md`: operator-visible recovery states, deployment contract, and no-order verification evidence format.

---

### Task 1: Write the failing heartbeat and recovery contract tests

**Files:**
- Create: `tests/disdex_runner_health.test.ts`
- Create: `scripts/disdex-runner-health-selftest.ts`

**Interfaces:**
- Consumes: no production runtime changes; test fixtures only.
- Produces: the required behavior for `RunnerHeartbeat`, `RecoveryObservation`, `RecoveryDecision`, and `decideRecovery()` in `lib/disdex-runner-health.ts`.

- [ ] **Step 1: Write tests for the heartbeat schema and recovery decisions**

Add tests that assert:

```ts
const healthy = makeHeartbeat({
  runnerId: "QUALITY102_CAUSAL_V1",
  safetyState: "LIVE",
  heartbeatAt: NOW,
  runtimeSha: SHA,
  expectedSha: SHA,
});
assert.equal(decideRecovery({ now: NOW, heartbeat: healthy, serviceActive: true, mainPid: 123, processCwd: RELEASE, expectedCwd: RELEASE, restartAttempts: 0 }).action, "NOOP");

assert.equal(decideRecovery({ now: NOW, heartbeat: undefined, serviceActive: false, mainPid: 0, processCwd: undefined, expectedCwd: RELEASE, restartAttempts: 0 }).action, "RESTART");

assert.equal(decideRecovery({ now: NOW, heartbeat: { ...healthy, heartbeatAt: NOW - 10 * 60_000 }, serviceActive: true, mainPid: 123, processCwd: RELEASE, expectedCwd: RELEASE, restartAttempts: 0 }).action, "RESTART");

for (const safetyState of ["KILL_SWITCH", "DAILY_LOSS_LATCH", "STALE_DATA", "RECONCILIATION_FAILED", "MANUAL_REVIEW", "UNKNOWN"] as const) {
  assert.equal(decideRecovery({ now: NOW, heartbeat: { ...healthy, safetyState }, serviceActive: true, mainPid: 123, processCwd: RELEASE, expectedCwd: RELEASE, restartAttempts: 0 }).action, "HOLD_FAIL_CLOSED");
}
```

Also assert that a Q102 `HOLD_FAIL_CLOSED` decision has `affectsOtherRunners === false`, while a shared reconciliation uncertainty has `affectsOtherRunners === true`. For every decision, assert `restartAuthorized === (action === "RESTART")` and `tradingEffects` equals `{ ordersSent: 0, cancelSent: 0, positionChangesSent: 0 }`.

- [ ] **Step 2: Run the new tests and verify the expected failure**

Run: `npx tsx --test tests/disdex_runner_health.test.ts`

Expected: FAIL because `lib/disdex-runner-health.ts` and its exported contract do not yet exist.

- [ ] **Step 3: Add the no-order self-test entry point**

Make `scripts/disdex-runner-health-selftest.ts` import the contract functions and run the same safety matrix, then print exactly:

```text
DISDEX_RUNNER_HEALTH_SELFTEST_PASS ordersSent=0 cancelSent=0 positionChangesSent=0
```

- [ ] **Step 4: Commit the failing-test contract**

```bash
git add tests/disdex_runner_health.test.ts scripts/disdex-runner-health-selftest.ts
git commit -m "test: define four-runner recovery safety contract"
```

### Task 2: Implement the heartbeat contract and atomic persistence

**Files:**
- Create: `lib/disdex-runner-health.ts`
- Modify: `tests/disdex_runner_health.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the fixtures and required decisions from Task 1.
- Produces:
  - `RunnerId = "V12" | "PENGU_V8" | "V52" | "QUALITY102_CAUSAL_V1"`.
  - `RunnerSafetyState = "LIVE" | "WAITING" | "FAIL_CLOSED" | "KILL_SWITCH" | "DAILY_LOSS_LATCH" | "STALE_DATA" | "RECONCILIATION_FAILED" | "MANUAL_REVIEW" | "UNKNOWN"`.
  - `RunnerSymbolStatus = { symbol: string; eligible: boolean; reason: string }`.
  - `RunnerHeartbeat` with `schema`, `runnerId`, `serviceUnit`, `runtimeSha`, `expectedSha`, `workingDirectory`, `mode`, `liveEnabled`, `safetyState`, `heartbeatAt`, `lastTickAt`, `lastReconciliationAt`, `lastDecision`, `reason`, `symbols: RunnerSymbolStatus[]`, `caps: { strategy: number | null; crypto: number | null; total: number | null }`, `restartAttempts`, and `updatedAt`.
  - `Quality102HeartbeatMeta = { selectorMode: "DERIVED_HIGH_VOL_ONLY"; historicalSelectorParity: false; brkLiveEnabled: false }` on Q102 records.
  - `RecoveryDecision` also includes `restartAuthorized: boolean` and `tradingEffects: { ordersSent: number; cancelSent: number; positionChangesSent: number }`; every recovery decision must report all three trading-effect counters as zero.
  - `RecoveryObservation`, `RecoveryDecision`, `readRunnerHeartbeat()`, `writeRunnerHeartbeat()`, and `decideRecovery()`.

- [ ] **Step 1: Implement strict parsing and atomic writes**

Use a temporary file in the heartbeat directory, write JSON with mode `0600`, flush and `fsync`, then `rename` it into place. Reject missing schema, unknown runner ID, invalid timestamps, non-40-character SHA values, future heartbeat timestamps, and non-finite caps. Never include environment objects or credential fields in the serialized type.

- [ ] **Step 2: Implement the recovery decision table**

Use the following precedence:

1. `KILL_SWITCH`, `DAILY_LOSS_LATCH`, `STALE_DATA`, `RECONCILIATION_FAILED`, `MANUAL_REVIEW`, and `UNKNOWN` → `HOLD_FAIL_CLOSED`.
2. Active service with matching PID/cwd/SHA and fresh heartbeat → `NOOP`.
3. Inactive service, zero PID, stale heartbeat, missing heartbeat, or cwd/SHA drift → `RESTART` if retry budget remains.
4. Retry budget exhausted → `RECOVERY_EXHAUSTED` and `HOLD_FAIL_CLOSED`.

Never return `RESTART` for an intentional systemd stop marker or for a safety state that the runner itself reported.

- [ ] **Step 3: Run the focused tests and self-test**

Run: `npx tsx --test tests/disdex_runner_health.test.ts` and `npx tsx scripts/disdex-runner-health-selftest.ts`

Expected: PASS with zero order/cancel/position-change counters.

- [ ] **Step 4: Commit the contract implementation**

```bash
git add lib/disdex-runner-health.ts tests/disdex_runner_health.test.ts scripts/disdex-runner-health-selftest.ts package.json
git commit -m "feat: add atomic four-runner health contract"
```

### Task 3: Instrument the four live runner paths

**Files:**
- Modify: `scripts/disdex-v12-x1-all-live-runner.ts`
- Modify: `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`
- Modify: `scripts/disdex-v13d-v11eq-v96-live-runner.ts`
- Modify: `scripts/disdex-quality102-causal-v1-live-runner.ts`
- Create: `scripts/disdex_runner_heartbeat.py`
- Modify: `scripts/disdex_v52_aster_only_live_engine.py`
- Modify: `scripts/disdex_v96_v52_margin_guard_runtime.py`
- Modify: `scripts/v12-x1-all-selftest.ts`: assert the V12 heartbeat payload keeps the strict strategy ID and live mode.
- Modify: `scripts/pengu-dual-ls-v2-selftest.ts`: assert the PENGU heartbeat payload keeps the final strategy ID and live mode.

**Interfaces:**
- Consumes: `writeRunnerHeartbeat()` and the Python JSON contract from Task 2.
- Produces: one heartbeat file per active runner under the configured health root, with Q102 symbols and caps included.

- [ ] **Step 1: Add configurable heartbeat paths without changing trading defaults**

Use these non-secret environment names:

```text
DISDEX_RUNNER_HEALTH_ROOT=/var/lib/disdex/runner-health
DISDEX_RUNNER_HEARTBEAT_PATH=<health-root>/<runner-id>.json
DISDEX_RUNNER_HEARTBEAT_INTERVAL_MS=60000
```

The Q102 heartbeat must include `selectorMode`, effective `symbols`, `maximumGross: 0.5`, `cryptoGrossCap: 2`, and `totalGrossCap: 2.5`. It must keep `historicalSelectorParity: false` and `brkLiveEnabled: false`.

- [ ] **Step 2: Publish heartbeat after successful, blocked, waiting, and held ticks**

Record the actual returned status and reason. A `STALE_DATA`, `KILL_SWITCH`, `DAILY_LOSS_LATCH`, or `MANUAL_REVIEW` result updates the heartbeat safety state but does not cause the heartbeat publisher to claim `LIVE`.

- [ ] **Step 3: Publish startup and fatal failure states**

Write `UNKNOWN` or `FAIL_CLOSED` before exiting on an uncaught error when the health path is writable. If the health path itself is unavailable, log the failure and preserve the runner’s existing fail-closed exit behavior; do not use health publishing as a reason to submit an order.

- [ ] **Step 4: Add the Python writer and wire V52/margin guard**

The Python writer must use `tempfile.mkstemp`, `os.fsync`, `os.replace`, and `chmod(0o600)`. V52 and its margin guard write separate runner IDs but share the same non-secret state root; the watchdog treats the combined V52 service as one restart target so it never starts duplicate children.

- [ ] **Step 5: Run runner regression self-tests**

Run:

```bash
npm run strategy:v12-x1-all:selftest
npm run strategy:pengu-dual-ls-v2:selftest
npm run strategy:disdex-v13d-v11eq-v96:supervisor:selftest
npm run strategy:quality102-causal-v1:runtime:selftest
npm run strategy:quality102-causal-v1:runner:selftest
python3 scripts/disdex_v52_aster_only_live_engine.py --self-test
python3 scripts/disdex_v96_v52_margin_guard_runtime.py --self-test
```

Expected: all existing behavior remains PASS and every self-test reports zero orders, cancels, and position changes.

- [ ] **Step 6: Commit runner instrumentation**

```bash
git add scripts/disdex-v12-x1-all-live-runner.ts scripts/disdex-pengu-dual-ls-v2-live-runner.ts scripts/disdex-v13d-v11eq-v96-live-runner.ts scripts/disdex-quality102-causal-v1-live-runner.ts scripts/disdex_runner_heartbeat.py scripts/disdex_v52_aster_only_live_engine.py scripts/disdex_v96_v52_margin_guard_runtime.py
git commit -m "feat: publish safe liveness for all production runners"
```

### Task 4: Implement and test the bounded watchdog

**Files:**
- Create: `scripts/disdex-runner-watchdog.ts`
- Create: `scripts/disdex-runner-watchdog-selftest.ts`
- Modify: `tests/disdex_runner_health.test.ts`
- Create: `ops/env/disdex-runner-watchdog.env.example`
- Create: `ops/systemd/disdex-runner-watchdog.service`
- Create: `ops/systemd/disdex-runner-watchdog.timer`
- Create: `scripts/ops/install-disdex-runner-health.sh`

**Interfaces:**
- Consumes: `RunnerHeartbeat`, `decideRecovery()`, and an allowlisted map of service units to expected release roots.
- Produces: a no-order watchdog command that returns `0` for healthy/held states and `1` only when recovery is exhausted or the watchdog itself cannot verify safety.

- [ ] **Step 1: Define the injected systemd adapter**

Implement:

```ts
export interface RunnerWatchdogSystem {
  isActive(unit: string): Promise<boolean>;
  mainPid(unit: string): Promise<number>;
  processCwd(pid: number): Promise<string | undefined>;
  processCommand(pid: number): Promise<string | undefined>;
  restart(unit: string): Promise<void>;
}
```

The production adapter may call only `systemctl is-active`, `systemctl show`, and `systemctl restart` for a compile-time allowlisted service map. It must reject arbitrary unit names from the heartbeat file.

- [ ] **Step 2: Implement bounded recovery**

For each of the four runner records, validate service state, MainPID, command/cwd, expected release SHA, heartbeat age, safety state, and attempt window. Restart at most three times in thirty minutes per runner with delays of 15s, 60s, and 300s. After the third failed observation, write `RECOVERY_EXHAUSTED` and do not restart again until the next operator-visible reset window. Q102 exhaustion affects only Q102.

- [ ] **Step 3: Add watchdog self-tests**

Inject fake systemd adapters for:

- process exited → one restart;
- stale heartbeat → one restart;
- matching healthy service → no restart;
- cwd/SHA drift → restart target is the allowlisted exact unit only;
- Kill Switch/manual review/stale-data/reconciliation failure → no restart and fail closed;
- three failed attempts → no fourth restart;
- Q102 recovery failure → V12/PENGU/V52 adapter calls remain zero.

Print:

```text
DISDEX_RUNNER_WATCHDOG_SELFTEST_PASS restarts=0 ordersSent=0 cancelSent=0 positionChangesSent=0
```

- [ ] **Step 4: Add restricted systemd units**

The service runs as `root`, uses `Type=oneshot`, `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=full`, and writes only `/var/lib/disdex/runner-health`. The timer runs once per minute with a five-second randomized delay. It must not be `Restart=always`; an operator-intentional stop must remain stopped.

- [ ] **Step 5: Run watchdog tests**

Run: `npx tsx --test tests/disdex_runner_health.test.ts` and `npx tsx scripts/disdex-runner-watchdog-selftest.ts`

Expected: PASS, with no calls to an exchange client and zero order-related counters.

- [ ] **Step 6: Commit watchdog implementation**

```bash
git add scripts/disdex-runner-watchdog.ts scripts/disdex-runner-watchdog-selftest.ts tests/disdex_runner_health.test.ts ops/env/disdex-runner-watchdog.env.example ops/systemd/disdex-runner-watchdog.service ops/systemd/disdex-runner-watchdog.timer scripts/ops/install-disdex-runner-health.sh
git commit -m "feat: add bounded fail-closed runner watchdog"
```

### Task 5: Wire service units and prove restart/reconciliation safety

**Files:**
- Modify: `ops/systemd/disdex-quality102-causal-v1@.service`
- Modify: `ops/systemd/disdex-v12-x1-all@.service`
- Modify: `ops/systemd/disdex-v96-v52-live.service`
- Modify: `scripts/ops/install-disdex-runner-health.sh`
- Create: `tests/disdex_runner_restart_reconciliation.test.ts`

**Interfaces:**
- Consumes: watchdog unit and heartbeat paths from Task 4.
- Produces: a deployment configuration that starts only the configured singleton service for each runner and re-enters the existing preflight/reconciliation path after recovery.

- [ ] **Step 1: Add only non-secret health environment entries**

Set service-specific `DISDEX_RUNNER_ID` and `DISDEX_RUNNER_HEARTBEAT_PATH` values. Preserve each unit’s existing `ExecStartPre`, exact-release checks, kill-switch handling, `Restart=on-failure`, `RestartPreventExitStatus` where present, and read/write path restrictions.

- [ ] **Step 2: Add restart/reconciliation fixtures**

Use an in-memory account/exchange fixture with one managed position and one open order. Assert that a simulated runner restart reloads identical position/order/ownership state, does not call submit/cancel/modify/close, and does not create a second account lock owner.

- [ ] **Step 3: Verify safety states remain stopped**

Assert that a heartbeat with `MANUAL_REVIEW`, `STALE_DATA`, or `KILL_SWITCH` remains `FAIL_CLOSED` after the watchdog cycle and that no runner is promoted to `LIVE` by the watchdog alone.

- [ ] **Step 4: Run restart/reconciliation tests**

Run: `npx tsx --test tests/disdex_runner_restart_reconciliation.test.ts`

Expected: PASS with submit/cancel/modify/close counters all zero.

- [ ] **Step 5: Commit unit integration**

```bash
git add ops/systemd/disdex-quality102-causal-v1@.service ops/systemd/disdex-v12-x1-all@.service ops/systemd/disdex-v96-v52-live.service scripts/ops/install-disdex-runner-health.sh tests/disdex_runner_restart_reconciliation.test.ts
git commit -m "ops: wire fail-closed recovery into runner services"
```

### Task 6: Build the redacted four-strategy status projection

**Files:**
- Create: `lib/disdex-runtime-status.ts`
- Create: `app/api/strategy/runtime-status/route.ts`
- Create: `tests/disdex_runtime_status.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: heartbeat files from the configured health root; no exchange write client.
- Produces:

```ts
export type RuntimeDisplayState = "LIVE" | "WAITING" | "FAIL_CLOSED" | "MANUAL_REVIEW" | "RECOVERING" | "要確認";
export interface StrategyRuntimeStatus {
  strategyId: "V12_X1.00_ALL" | "PENGU_DUAL_LS_V2_FINAL" | "V52_ASTER_ONLY" | "QUALITY102_CAUSAL_V1";
  displayName: string;
  state: RuntimeDisplayState;
  serviceActive: boolean;
  heartbeatAt: number | null;
  runtimeSha: string | null;
  releaseShaMatch: boolean;
  safetyReason: string;
  lastDecision: string | null;
  recovery: { action: "NONE" | "RESTARTED" | "HELD_FAIL_CLOSED" | "EXHAUSTED"; attempts: number };
  gross: { strategyCap: number | null; cryptoCap: number | null; totalCap: number | null };
  symbols: Array<{ symbol: string; eligible: boolean; reason: string }>;
}
```

- [ ] **Step 1: Implement redaction and four-record normalization**

Read only the allowlisted heartbeat filenames. Normalize Q102 to `QUALITY102_CAUSAL_V1`; map the three base runners to their production IDs. Omit private keys, wallet addresses, balances, order IDs, raw environment values, and filesystem paths outside the public status fields.

- [ ] **Step 2: Add safe stale handling**

If the heartbeat is absent, malformed, too old, or SHA-mismatched, emit `state: "要確認"`, `serviceActive: false` or the observed systemd state, `releaseShaMatch: false`, and a non-secret reason. Never emit `LIVE` based only on a configured boolean.

- [ ] **Step 3: Add Q102 target-symbol projection**

Use the Q102 heartbeat’s effective symbols, not a second UI constant. Include each symbol’s eligibility/reason as last reported by the causal selector. Preserve `historicalSelectorParity: false` in the Q102 record metadata and show the caps `0.50x`, `2.00x`, and `2.50x`.

- [ ] **Step 4: Test the API model**

Assert all four records are always present, Q102 symbols are present, stale data maps to `要確認`, and no serialized response contains `PRIVATE`, `SECRET`, `TOKEN`, `KEY`, `PASSWORD`, or wallet credential values.

- [ ] **Step 5: Run the status tests**

Run: `npx tsx --test tests/disdex_runtime_status.test.ts`

Expected: PASS with fixtures only and zero order-related calls.

- [ ] **Step 6: Commit the status projection**

```bash
git add lib/disdex-runtime-status.ts app/api/strategy/runtime-status/route.ts tests/disdex_runtime_status.test.ts package.json
git commit -m "feat: expose redacted four-strategy runtime status"
```

### Task 7: Add Q102 to HP status and 判定条件 surfaces

**Files:**
- Create: `hooks/useStrategyRuntimeStatus.ts`
- Create: `components/features/autotrade/StrategyRuntimeStatusPanel.tsx`
- Modify: `app/page.tsx`
- Modify: `app/positions/page.tsx`
- Modify: `components/features/autotrade/LiveDecisionPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/strategy/runtime-status` from Task 6.
- Produces: responsive HP UI showing V12/PENGU/V52/Q102 operational state and Q102 target-symbol conditions from one source.

- [ ] **Step 1: Implement the polling hook**

Poll every 60 seconds and listen for `auto-trade-live-decision-refresh`. Keep the last successful response during a transient fetch failure but mark it stale after the API says so. Do not infer `LIVE` from wallet status or `activeStrategies.length`.

- [ ] **Step 2: Implement the four-strategy status cards**

Show for every strategy: display name, state, heartbeat age, release match, last decision/reason, recovery action, and cap summary. Use `要確認` when status is unavailable or stale.

- [ ] **Step 3: Implement the Q102判定条件 panel**

Show:

```text
Selector: DERIVED_HIGH_VOL_ONLY
Quality102上限: 0.50x
Crypto Gross上限: 2.00x
Total Gross上限: 2.50x
Historical selector parity: 未証明（LIVE判定とは分離）
対象通貨: runtime heartbeatのsymbols一覧
```

For each target symbol show eligible/not eligible, the last causal reason, data freshness state, and whether the sleeve is `LIVE`, `WAITING`, `FAIL_CLOSED`, or `要確認`. Do not show a symbol as executable when the heartbeat is stale.

- [ ] **Step 4: Mount the panel on the home and positions pages**

Place the same component on `app/page.tsx` and `app/positions/page.tsx`. Keep existing 12H V12/PENGU decision cards and history panels intact; the new panel is additive and does not rewrite their decision math.

- [ ] **Step 5: Add the Q102 section to LiveDecisionPanel**

Add a compact link/summary labeled `Q102判定条件` that opens the full panel region on the positions page or renders the same status summary. It must use the hook’s data and never duplicate the target-symbol list.

- [ ] **Step 6: Run UI verification**

Run:

```bash
npx tsc --noEmit
npx next build
```

Expected: both PASS. Use the existing browser/HP route after deployment to verify mobile wrapping, all four cards, Q102 symbols, caps, and safe `要確認` rendering with the API unavailable fixture.

- [ ] **Step 7: Commit HP integration**

```bash
git add hooks/useStrategyRuntimeStatus.ts components/features/autotrade/StrategyRuntimeStatusPanel.tsx app/page.tsx app/positions/page.tsx components/features/autotrade/LiveDecisionPanel.tsx
git commit -m "feat: add Quality102 runtime conditions to HP"
```

### Task 8: Add CI, documentation, and complete local verification

**Files:**
- Create: `.github/workflows/disdex-runner-health-ci.yml`
- Create: `docs/implementation/disdex-four-strategy-auto-recovery.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: all implementation and tests from Tasks 1–7.
- Produces: repeatable CI evidence and an operator runbook with no-order deployment checks.

- [ ] **Step 1: Add explicit package scripts**

Add:

```json
"strategy:runner-health:selftest": "tsx scripts/disdex-runner-health-selftest.ts",
"strategy:runner-watchdog:selftest": "tsx scripts/disdex-runner-watchdog-selftest.ts",
"strategy:runtime-status:test": "tsx --test tests/disdex_runtime_status.test.ts"
```

- [ ] **Step 2: Add CI checks**

The workflow must run the health tests, Q102 causal/runtime/runner self-tests, V12/PENGU/V52 regression self-tests, `npx tsc --noEmit`, and `npx next build`. Add static assertions that the watchdog has no exchange client import, only allowlisted service units, and no `systemctl start`/`submit`/`cancel`/`close` calls.

- [ ] **Step 3: Write the runbook**

Document normal states, `RECOVERING`, `RECOVERY_EXHAUSTED`, safety-latched states, read-only inspection commands, rollback, and the proof fields required in the final report. State that safety-latched states require normal operator clearance and fresh reconciliation; the watchdog does not clear them.

- [ ] **Step 4: Run the complete local verification**

Run:

```bash
npm run strategy:runner-health:selftest
npm run strategy:runner-watchdog:selftest
npm run strategy:runtime-status:test
npm run strategy:quality102-causal-v1:runner:selftest
npm run strategy:v12-x1-all:selftest
npm run strategy:pengu-dual-ls-v2:selftest
npm run strategy:disdex-v13d-v11eq-v96:contract
npx tsx --test tests/disdex_runner_health.test.ts tests/disdex_runner_restart_reconciliation.test.ts tests/disdex_runtime_status.test.ts
npx tsc --noEmit
npx next build
```

Expected: every command passes; all order/cancel/position-change counters remain zero.

- [ ] **Step 5: Commit CI and documentation**

```bash
git add .github/workflows/disdex-runner-health-ci.yml docs/implementation/disdex-four-strategy-auto-recovery.md package.json
git commit -m "ci: verify four-strategy recovery and Q102 HP status"
```

### Task 9: Push, deploy immutably to XServer, and verify live health

**Files:**
- Modify only through the release/deployment procedure: XServer systemd units, watchdog configuration, and HP release assets.

**Interfaces:**
- Consumes: exact pushed commit and GREEN CI run from Task 8.
- Produces: active four-runner services, active watchdog timer, synchronized HP status, and an audit report proving zero verification orders.

- [ ] **Step 1: Push the branch and wait for exact-SHA CI**

Run:

```bash
git push -u origin HEAD
gh run list --repo dunamishajime-bit/-ai-dex-manager --branch codex/quality102-live-connection-20260904 --limit 5
```

Do not deploy until the health workflow is `completed/success` for the exact commit SHA.

- [ ] **Step 2: Run VPS read-only preflight before touching units**

Verify disk headroom, current release links, every active service’s `MainPID`, `/proc/<pid>/cwd`, command line, current heartbeat files, kill switch, daily risk, account positions, open orders, and account lock. Abort the deployment if account state is not readable or if any open order/position requires mutation.

- [ ] **Step 3: Install the immutable release and health units**

Use the XServer release directory for the exact commit, install the tracked systemd units/configuration, run `systemctl daemon-reload`, enable only the watchdog timer and the already-approved four runner services, and preserve the current release symlink policy. Never run a live probe or test order.

- [ ] **Step 4: Restart only as required by the release**

Restart services one at a time after their read-only preflight succeeds. Do not stop all four together. Do not cancel, modify, or close existing exchange orders/positions. The first post-restart tick must pass reconciliation before any new signal can proceed.

- [ ] **Step 5: Verify services, watchdog, HP, and account state**

Confirm:

```text
V12/PENGU/V52/Q102 active or explicitly safety-held
watchdog timer active
heartbeat timestamps fresh or safety reason explicit
exact release SHA and /proc cwd match
reconciliation PASS
Gross caps 0.50 / 2.00 / 2.50 visible for Q102
Q102 target symbols match runtime heartbeat
open orders unchanged
managed positions unchanged
submit/cancel/modify/close/test/synthetic order count = 0
```

- [ ] **Step 6: Capture final evidence and report**

Report branch, final SHA, CI run ID, changed files, service states, watchdog state, heartbeat states, Q102 target symbols, Gross caps, reconciliation result, HP pages updated, recovery test result, and explicit `LIVE_ORDERS_SENT=0`, `TEST_ORDERS=0`, `SYNTHETIC_ORDERS=0`.
