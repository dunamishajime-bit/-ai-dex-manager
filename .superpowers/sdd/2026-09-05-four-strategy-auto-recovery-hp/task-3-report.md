# Task 3 report — instrument the four live runner paths

## Scope

Implemented Task 3 fix round 2 in the `quality102-live-connection-20260904` worktree. Modified the four TypeScript runner paths, the active combined margin-aware V52 worker boundary, the standalone V52 worker boundary, the combined supervisor environment, and focused self-tests. Created `scripts/disdex_runner_heartbeat.py` and the shared `scripts/disdex_v52_heartbeat.py` publisher mixin. The V52 margin guard was not modified. UI, systemd, watchdog, deployment targets, orders, and user-owned untracked files were not modified or staged.

Heartbeat records use `disdex-runner-heartbeat/v1`, atomic writes, `0700` directories, and `0600` files. Canonical paths are `v12.json`, `pengu-v8.json`, `v52.json`, and `quality102-causal-v1.json`; explicit runner-specific paths take precedence over the global path. Writes are best-effort on fatal paths and never alter the original exit code.

Q102 publishes the exact required metadata and caps `{ strategy: 0.5, crypto: 2, total: 2.5 }`, while preserving `QUALITY102_LIVE_SELECTOR_PARITY=false` and `QUALITY102_LIVE_ENABLED=false`. V52 is written by the worker after ticks/preflight/stop; the supervisor writes only a V52 fail-closed supervisor state if the V52 child exits unexpectedly.

## Files changed

- `lib/disdex-runner-health.ts`
- `scripts/disdex-v12-x1-all-live-runner.ts`
- `scripts/disdex-pengu-dual-ls-v2-live-runner.ts`
- `scripts/disdex-v13d-v11eq-v96-live-runner.ts`
- `scripts/disdex-quality102-causal-v1-live-runner.ts`
- `scripts/disdex-quality102-causal-v1-live-runner-selftest.ts`
- `scripts/disdex-runner-health-selftest.ts`
- `scripts/disdex_runner_heartbeat.py`
- `scripts/disdex_v52_heartbeat.py`
- `scripts/disdex_v52_aster_only_live_engine.py`
- `scripts/disdex_v52_margin_aware_live_engine.py`
- `.superpowers/sdd/2026-09-05-four-strategy-auto-recovery-hp/task-3-report.md`

## Verification commands and outputs

### TypeScript typecheck

Command:

```text
npx tsc --noEmit
```

Output: no TypeScript errors.

### Required V12 self-test

Command:

```text
npm run strategy:v12-x1-all:selftest
```

Output:

```text
V12_X1_ALL_SELFTEST_PASS {"strategyId":"V12_X1.00_ALL","bars":2}
ACCOUNT_ORDER_LOCK_TS_SELFTEST_PASS
UNIFIED_PORTFOLIO_ROUTING_SELFTEST_PASS
V12_X1_ALL_FROZEN_ARTIFACT_PARITY_SELFTEST_PASS
V12_RESIDENT_STOP_SELFTEST_PASS
V12_X1_ALL_RUNNER_SELFTEST_PASS
```

### Required PENGU self-test

Command:

```text
npm run strategy:pengu-dual-ls-v2:selftest
```

Output ended with:

```text
PENGU_DUAL_LS_V2_FINAL_SELFTEST_PASS
ordersSent=false
cancelSent=false
positionChangesSent=false
```

### Required combined supervisor self-test

Command:

```text
npm run strategy:disdex-v13d-v11eq-v96:supervisor:selftest
```

Output:

```text
V96 + V52 margin-aware supervisor self-test: PASS
```

### Required Q102 runtime self-test

Command:

```text
npm run strategy:quality102-causal-v1:runtime:selftest
```

Output:

```text
QUALITY102_CAUSAL_V1_RUNTIME_SELFTEST_PASS
```

### Required Q102 runner self-test

Command:

```text
npm run strategy:quality102-causal-v1:runner:selftest
```

Output:

```text
QUALITY102_CAUSAL_V1_RUNNER_SELFTEST_PASS {"realOrders":0,"testOrders":0,"syntheticOrders":0}
QUALITY102_CAUSAL_V1_LIVE_RUNNER_SELFTEST_PASS {"ordersSent":0,"syntheticOrders":0,"testOrders":0}
```

### Required V52 self-test

Command:

```text
python3 scripts/disdex_v52_aster_only_live_engine.py --self-test
```

Output:

```text
DISDEX_STRICT_PORTFOLIO_PLANNER_PY_SELFTEST_PASS
V52_STRICT_ASTER_ONLY_SELFTEST_PASS
```

### Required margin-guard self-test

Command:

```text
python3 scripts/disdex_v96_v52_margin_guard_runtime.py --self-test
```

Output:

```text
ModuleNotFoundError: No module named 'fcntl'
```

This Windows environment cannot import the margin guard's POSIX-only `fcntl`; the margin guard file was preserved unchanged.

### Heartbeat contract self-test

Command:

```text
npm run strategy:runner-health:selftest
```

Output:

```text
DISDEX_RUNNER_HEALTH_SELFTEST_PASS ordersSent=0 cancelSent=0 positionChangesSent=0
```

### Python compilation and diff checks

Commands:

```text
python3 -m py_compile scripts/disdex_runner_heartbeat.py scripts/disdex_v52_aster_only_live_engine.py
git diff --check
```

Output: no compilation or diff-check errors. Git emitted only its normal LF/CRLF conversion warnings.

### Payload round-trip

Command validated a V12 fixture through `buildV12RunnerHeartbeat()`, `writeRunnerHeartbeat()`, and `readRunnerHeartbeat()` using a temporary file.

Output:

```text
TASK3_PAYLOAD_VALIDATION_PASS V12 LIVE
```

The resulting payload contained no secrets and validated against the Task 2 contract.

## Remaining non-blocking limitations

1. The unchanged margin-guard self-test is POSIX-only and cannot import `fcntl` on this Windows host. VPS/Linux verification remains required; the guard was not bypassed or modified.
2. The requested checks are local self-tests/typechecks only; no deployment or live exchange activity was performed, and all test paths reported zero order/cancel/position changes.
3. If a heartbeat destination is unavailable, the Python publisher logs a redacted warning and returns `False`; the original trading exception and order behavior are preserved, but no heartbeat file can be published until the destination is available.
4. The pre-existing user-owned `scripts/account-readonly-inspect.tmp.ts` and inaccessible `q102-v52-selftest-b2djjsa5/` path were left untouched and unstaged.

## Commit

The requested Task 3-only commit is recorded in the final response.

## Fix round 1

### Changes

- Fixed `buildCombinedChildEnvironment()` to use `paths.stateRoot`, the canonical property returned by `combinedPaths()`.
- Preserved valid configured runtime/expected SHA values. When a live heartbeat lacks either identity, V12, PENGU, Q102, and the Python V52 helper now publish `safetyState: "UNKNOWN"` with a non-secret reason, preventing healthy recovery decisions. The contract-required SHA fields remain syntactically valid zero placeholders only as opaque unavailable values.
- Added focused missing-SHA assertions to `scripts/disdex-runner-health-selftest.ts` for V12 and PENGU.
- Did not modify `scripts/disdex_v96_v52_margin_guard_runtime.py`; VPS/Linux verification remains required.

### Fix-round commands and results

```text
npm run strategy:runner-health:selftest
DISDEX_RUNNER_HEALTH_SELFTEST_PASS ordersSent=0 cancelSent=0 positionChangesSent=0

npm run strategy:disdex-v13d-v11eq-v96:supervisor:selftest
V96 + V52 margin-aware supervisor self-test: PASS

npx tsc --no-emit
No TypeScript errors.

npm run strategy:v12-x1-all:selftest
V12_X1_ALL_SELFTEST_PASS {"strategyId":"V12_X1.00_ALL","bars":2}
ACCOUNT_ORDER_LOCK_TS_SELFTEST_PASS
UNIFIED_PORTFOLIO_ROUTING_SELFTEST_PASS
V12_X1_ALL_FROZEN_ARTIFACT_PARITY_SELFTEST_PASS
V12_RESIDENT_STOP_SELFTEST_PASS
V12_X1_ALL_RUNNER_SELFTEST_PASS

npm run strategy:pengu-dual-ls-v2:selftest
PENGU_DUAL_LS_V2_FINAL_SELFTEST_PASS
ordersSent=false
cancelSent=false
positionChangesSent=false

npm run strategy:quality102-causal-v1:runtime:selftest
QUALITY102_CAUSAL_V1_RUNTIME_SELFTEST_PASS

npm run strategy:quality102-causal-v1:runner:selftest
QUALITY102_CAUSAL_V1_RUNNER_SELFTEST_PASS {"realOrders":0,"testOrders":0,"syntheticOrders":0}
QUALITY102_CAUSAL_V1_LIVE_RUNNER_SELFTEST_PASS {"ordersSent":0,"syntheticOrders":0,"testOrders":0}

python3 scripts/disdex_v52_aster_only_live_engine.py --self-test
DISDEX_STRICT_PORTFOLIO_PLANNER_PY_SELFTEST_PASS
V52_STRICT_ASTER_ONLY_SELFTEST_PASS

python3 -m py_compile scripts/disdex_runner_heartbeat.py scripts/disdex_v52_aster_only_live_engine.py
No Python compilation errors.

git diff --check
No diff-check errors; only normal LF/CRLF conversion warnings.

python3 scripts/disdex_v96_v52_margin_guard_runtime.py --self-test
ModuleNotFoundError: No module named 'fcntl'
```

The margin-guard result is an environment limitation on Windows. It requires VPS/Linux verification and was not bypassed or changed. The pre-existing untracked `scripts/account-readonly-inspect.tmp.ts` remains unmodified and unstaged.

## Fix round 2

### Reviewer findings addressed

- Centralized the TypeScript safety classifier so V12, PENGU, and Q102 map fatal, generic failed/error, and underscore-form safety/hold statuses to `UNKNOWN` or `FAIL_CLOSED` as appropriate; focused assertions cover these states and runtime-only identity.
- Added the single `V52HeartbeatMixin` boundary to both the standalone strict worker and the actual margin-aware worker launched by the combined supervisor. The active production worker now publishes `V52` heartbeats without adding a writer to the margin guard.
- V52 heartbeat outcomes now reflect shared kill switch, daily-loss latch, shared crypto risk, V96 margin-priority, and persisted margin-guard outcomes. A stop/finally publication cannot replace an existing failure or safety hold with `WAITING`.
- Removed runtime-SHA fallbacks for expected release identity. Q102 leaves expected identity unavailable when it is not configured and requires an explicit expected SHA matching runtime SHA for live activation.
- Combined child environment now gives PENGU and V52 explicit heartbeat paths while both use the singleton `disdex-v96-v52-live.service` identity. V12 and Q102 retain standalone service identities.
- Python heartbeat writes are redacted, atomic, best-effort, and cleaned up on failure; publication errors do not mask trading exceptions or change order behavior.
- Q102 heartbeat publication loads persisted `state.lastReconciledAt` instead of hardcoding a null timestamp.
- Historical Q102 parity flags remain disabled and no unproven selector was enabled. The margin guard remains unchanged.

### Fix-round verification commands and exact outputs

```text
npm run strategy:runner-health:selftest
DISDEX_RUNNER_HEALTH_SELFTEST_PASS ordersSent=0 cancelSent=0 positionChangesSent=0

npm run strategy:disdex-v13d-v11eq-v96:supervisor:selftest
V96 + V52 margin-aware supervisor self-test: PASS

npm run strategy:v12-x1-all:selftest
V12_X1_ALL_SELFTEST_PASS {"strategyId":"V12_X1.00_ALL","bars":2}
ACCOUNT_ORDER_LOCK_TS_SELFTEST_PASS
UNIFIED_PORTFOLIO_ROUTING_SELFTEST_PASS
V12_X1_ALL_FROZEN_ARTIFACT_PARITY_SELFTEST_PASS
V12_RESIDENT_STOP_SELFTEST_PASS
V12_X1_ALL_RUNNER_SELFTEST_PASS

npm run strategy:pengu-dual-ls-v2:selftest
{"level":"info","message":"PENGU Dual LS shadow decision","strategyId":"PENGU_DUAL_LS_V2_FINAL","side":0,"reason":"PENGU/BTCの確定1時間足履歴が不足しているためFail Closedです。","referenceTs":0,"orderSent":0}
PENGU_DUAL_LS_V2_FINAL_SELFTEST_PASS
ordersSent=false
cancelSent=false
positionChangesSent=false

npm run strategy:quality102-causal-v1:runtime:selftest
QUALITY102_CAUSAL_V1_RUNTIME_SELFTEST_PASS

npm run strategy:quality102-causal-v1:runner:selftest
QUALITY102_CAUSAL_V1_RUNNER_SELFTEST_PASS {"realOrders":0,"testOrders":0,"syntheticOrders":0}
QUALITY102_CAUSAL_V1_LIVE_RUNNER_SELFTEST_PASS {"ordersSent":0,"syntheticOrders":0,"testOrders":0}

python3 scripts/disdex_v52_aster_only_live_engine.py --self-test
DISDEX_STRICT_PORTFOLIO_PLANNER_PY_SELFTEST_PASS
V52_STRICT_ASTER_ONLY_SELFTEST_PASS

python3 -m py_compile scripts/disdex_runner_heartbeat.py scripts/disdex_v52_aster_only_live_engine.py
no output; exit 0

npx tsc --noEmit
no output; exit 0

git diff --check
no diff-check errors; exit 0 (only normal LF/CRLF conversion warnings)
```

The Windows-only margin-guard limitation remains `ModuleNotFoundError: No module named 'fcntl'` if its POSIX self-test is attempted; it is recorded above for VPS/Linux verification and was not bypassed.

## Fix round 3

### Reviewer findings addressed

- Removed the direct `V52HeartbeatMixin` base from `MarginAwareV52AsterOnlyEngine`. The production margin-aware entrypoint still inherits the mixin through its existing strict V52 base chain, so heartbeat publication and margin-aware safety behavior remain active without the inconsistent MRO.
- Added `_assert_margin_aware_entrypoint_mro()` to the production margin-aware `--self-test`. It requires exactly one `V52HeartbeatMixin` in the resolved MRO and verifies the entrypoint remains a subclass of the mixin, so the exact entrypoint import/self-test catches the reviewed failure.
- Added `publishQuality102FatalHeartbeat()` and `buildQuality102FatalHeartbeat()`. The fatal path guards configuration resolution; if resolution fails, it writes a minimal atomic `UNKNOWN` record with `liveEnabled: false`, empty symbols, exact Q102 caps/metadata, independently sanitized runtime/expected SHA fields, and a fixed non-secret reason. Heartbeat-write failures remain contained, while the original error is still logged and the runner retains exit code `1`.
- Added focused Q102 coverage using an invalid `BTCUSDT` symbol configuration. The resolver is forced to throw, the fatal publisher does not reject, and the persisted record is asserted to be `UNKNOWN`, non-live, symbol-free, exact-cap, exact-metadata, and fixed-reason.

### Files changed in fix round 3

- `scripts/disdex_v52_margin_aware_live_engine.py`
- `scripts/disdex-quality102-causal-v1-live-runner.ts`
- `scripts/disdex-quality102-causal-v1-live-runner-selftest.ts`
- `.superpowers/sdd/2026-09-05-four-strategy-auto-recovery-hp/task-3-report.md`

### Focused RED/GREEN evidence

Before the fix, the exact production command failed during class definition:

```text
python3 scripts/disdex_v52_margin_aware_live_engine.py --self-test
TypeError: Cannot create a consistent method resolution order (MRO) for bases V52HeartbeatMixin, MarginAwareV52AsterOnlyEngine
```

The new Q102 test initially failed because `publishQuality102FatalHeartbeat` did not exist:

```text
npx tsx scripts/disdex-quality102-causal-v1-live-runner-selftest.ts
TypeError: ...publishQuality102FatalHeartbeat is not a function
```

After the fixes, both focused checks passed:

```text
npx tsx scripts/disdex-quality102-causal-v1-live-runner-selftest.ts
QUALITY102_CAUSAL_V1_LIVE_RUNNER_SELFTEST_PASS {"ordersSent":0,"syntheticOrders":0,"testOrders":0}

python3 scripts/disdex_v52_margin_aware_live_engine.py --self-test
V52_MARGIN_AWARE_ENTRYPOINT_MRO_SELFTEST_PASS
DISDEX_STRICT_PORTFOLIO_PLANNER_PY_SELFTEST_PASS
V52_STRICT_MARGIN_AWARE_SELFTEST_PASS
```

### Fix-round verification commands and exact results

```text
npx tsx --test tests/disdex_runner_health.test.ts
✔ fresh matching service/PID/cwd/SHA returns NOOP
✔ inactive service with no PID and no heartbeat returns RESTART
✔ stale heartbeat returns RESTART
✔ safety latches remain HOLD_FAIL_CLOSED and never restart
✔ Q102 fail-closed decision is runner-local
✔ shared reconciliation uncertainty affects every runner
✔ exhausted retry budget never authorizes a fourth restart
ℹ tests 7
ℹ pass 7
ℹ fail 0

npm run strategy:runner-health:selftest
DISDEX_RUNNER_HEALTH_SELFTEST_PASS ordersSent=0 cancelSent=0 positionChangesSent=0

npm run strategy:v12-x1-all:selftest
V12_X1_ALL_SELFTEST_PASS {"strategyId":"V12_X1.00_ALL","bars":2}
ACCOUNT_ORDER_LOCK_TS_SELFTEST_PASS
UNIFIED_PORTFOLIO_ROUTING_SELFTEST_PASS
V12_X1_ALL_FROZEN_ARTIFACT_PARITY_SELFTEST_PASS
V12_RESIDENT_STOP_SELFTEST_PASS
V12_X1_ALL_RUNNER_SELFTEST_PASS

npm run strategy:pengu-dual-ls-v2:selftest
PENGU_DUAL_LS_V2_FINAL_SELFTEST_PASS
ordersSent=false
cancelSent=false
positionChangesSent=false

npm run strategy:disdex-v13d-v11eq-v96:supervisor:selftest
V96 + V52 margin-aware supervisor self-test: PASS

npm run strategy:quality102-causal-v1:runtime:selftest
QUALITY102_CAUSAL_V1_RUNTIME_SELFTEST_PASS

npm run strategy:quality102-causal-v1:runner:selftest
QUALITY102_CAUSAL_V1_RUNNER_SELFTEST_PASS {"realOrders":0,"testOrders":0,"syntheticOrders":0}
QUALITY102_CAUSAL_V1_LIVE_RUNNER_SELFTEST_PASS {"ordersSent":0,"syntheticOrders":0,"testOrders":0}

npx tsx --test tests/quality102_causal_v1_portfolio.test.ts
ℹ tests 12
ℹ pass 12
ℹ fail 0

python3 scripts/disdex_v52_aster_only_live_engine.py --self-test
DISDEX_STRICT_PORTFOLIO_PLANNER_PY_SELFTEST_PASS
V52_STRICT_ASTER_ONLY_SELFTEST_PASS

python3 scripts/disdex_v52_margin_aware_live_engine.py --self-test
V52_MARGIN_AWARE_ENTRYPOINT_MRO_SELFTEST_PASS
DISDEX_STRICT_PORTFOLIO_PLANNER_PY_SELFTEST_PASS
V52_STRICT_MARGIN_AWARE_SELFTEST_PASS

python3 -m py_compile scripts/disdex_runner_heartbeat.py scripts/disdex_v52_heartbeat.py scripts/disdex_v52_aster_only_live_engine.py scripts/disdex_v52_margin_aware_live_engine.py scripts/disdex_v96_v52_margin_guard_runtime.py
PY_COMPILE_MODULE_PASS 5

npx tsc --noEmit
no output; exit 0

git diff --check
no diff-check errors; exit 0
```

The first `npm run strategy:quality102-causal-v1:portfolio:test` invocation and its final rerun both stopped in Node's Windows test worker with `Error: spawn EPERM` before executing tests. The equivalent direct command above passed all 12 tests; this is a process-launch limitation of the npm wrapper on this host, not a test assertion failure.

The unchanged margin-guard check remains environment-limited:

```text
python3 scripts/disdex_v96_v52_margin_guard_runtime.py --self-test
ModuleNotFoundError: No module named 'fcntl'
```

The fallback payload shape is intentionally minimal and contains no secrets:

```json
{
  "schema": "disdex-runner-heartbeat/v1",
  "runnerId": "QUALITY102_CAUSAL_V1",
  "runtimeSha": "0000000000000000000000000000000000000000",
  "expectedSha": "0000000000000000000000000000000000000000",
  "mode": "LIVE",
  "liveEnabled": false,
  "safetyState": "UNKNOWN",
  "lastTickAt": null,
  "lastReconciliationAt": null,
  "lastDecision": "fatal",
  "reason": "QUALITY102_CAUSAL_V1_FATAL_FAIL_CLOSED",
  "symbols": [],
  "caps": { "strategy": 0.5, "crypto": 2, "total": 2.5 },
  "quality102": {
    "selectorMode": "DERIVED_HIGH_VOL_ONLY",
    "historicalSelectorParity": false,
    "brkLiveEnabled": false
  }
}
```

### Concerns and preserved scope

The POSIX-only margin guard remains unchanged and must be rerun on the XServer/Linux VPS. The pre-existing user-owned `scripts/__pycache__/`, `scripts/account-readonly-inspect.tmp.ts`, and inaccessible temporary self-test directories were not edited, removed, staged, or committed. The round-3 Python compilation used a temporary worktree cache prefix and cleaned it afterward. No deployment, systemd action, exchange call, order/cancel/close action, or historical parity flag was enabled. The focused fix commit SHA is returned with the final response.
