# Quality102 Causal V1 LIVE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, verify, deploy, and independently arm a causal `QUALITY102_CAUSAL_V1` LIVE sleeve without representing it as the unrecovered historical Quality102 selector.

**Architecture:** Add a separate runtime identity, causal signal engine, atomic state store, and portfolio runner. The runner consumes only closed decision-time data, shares the account lock and strict Gross planner with existing strategies, and fails locally without stopping V12, PENGU V8, or V52. Deployment first runs in no-write mode and only enables LIVE after exact-SHA CI, reconciliation, and VPS preflight pass.

**Tech Stack:** TypeScript, Node.js, `tsx`, Node `assert`, Aster V3 client, systemd, GitHub Actions, XServer VPS.

**Spec:** `docs/superpowers/specs/2026-09-04-quality102-causal-v1-live-design.md`

## Global Constraints

- Production identity is `QUALITY102_CAUSAL_V1`; historical selector parity remains `false`.
- BRK is disabled because its upstream `strength` formula is not proven.
- Frozen historical timestamps and event CSVs cannot generate LIVE intents.
- Quality102 Gross is at most `0.50x`, combined crypto Gross at most `2.00x`, and total Gross at most `2.50x`.
- V12, PENGU V8, and V52 keep priority; only Quality102 may be reduced for a base-strategy conflict.
- Existing positions and orders cannot be force-modified during deployment.
- Synthetic and test LIVE orders are prohibited.
- All new behavior follows RED, GREEN, refactor with fresh verification evidence.
- VPS target is `root@professional-dismanager.net` using the configured Desktop key; Vercel is not a target.

---

### Task 1: Runtime Identity and Inert Configuration

**Files:**
- Create: `config/disdexQuality102CausalV1Runtime.ts`
- Create: `scripts/disdex-quality102-causal-v1-runtime-selftest.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Produces: `QUALITY102_CAUSAL_V1`, `Quality102CausalV1Mode`, `ResolvedQuality102CausalV1Runtime`, and `resolveQuality102CausalV1Runtime(env)`.
- The resolver caps Gross at `0.50`, defaults to `SHADOW` and disabled, and requires three independent booleans for LIVE.

- [ ] **Step 1: Write the failing runtime test**

```ts
import assert from "node:assert/strict";
import { resolveQuality102CausalV1Runtime } from "../config/disdexQuality102CausalV1Runtime";

const inert = resolveQuality102CausalV1Runtime({});
assert.equal(inert.mode, "SHADOW");
assert.equal(inert.enabled, false);
assert.equal(inert.liveTradingEnabled, false);
assert.equal(inert.liveExecutionEnabled, false);
assert.equal(inert.operatorArmed, false);
assert.equal(inert.historicalSelectorParity, false);

const live = resolveQuality102CausalV1Runtime({
  QUALITY102_CAUSAL_V1_MODE: "LIVE",
  QUALITY102_CAUSAL_V1_ENABLED: "true",
  QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED: "true",
  QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED: "true",
  QUALITY102_CAUSAL_V1_OPERATOR_ARMED: "true",
  QUALITY102_CAUSAL_V1_MAX_GROSS: "9",
});
assert.equal(live.maximumGross, 0.5);
assert.equal(live.historicalSelectorParity, false);
console.log("QUALITY102_CAUSAL_V1_RUNTIME_SELFTEST_PASS");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx scripts/disdex-quality102-causal-v1-runtime-selftest.ts`

Expected: FAIL because `disdexQuality102CausalV1Runtime` does not exist.

- [ ] **Step 3: Implement the inert resolver**

```ts
export type Quality102CausalV1Mode = "SHADOW" | "PAPER" | "LIVE";

export const QUALITY102_CAUSAL_V1 = Object.freeze({
  strategyId: "QUALITY102_CAUSAL_V1",
  maximumGross: 0.5,
  cryptoGrossCap: 2,
  totalGrossCap: 2.5,
  maximumPositions: 1,
  historicalSelectorParity: false,
  brkEnabled: false,
});

export function resolveQuality102CausalV1Runtime(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const bool = (name: string) => /^(1|true|yes|on)$/i.test(String(env[name] || ""));
  const rawMode = String(env.QUALITY102_CAUSAL_V1_MODE || "SHADOW").toUpperCase();
  const mode: Quality102CausalV1Mode = rawMode === "LIVE" || rawMode === "PAPER" ? rawMode : "SHADOW";
  const requestedGross = Number(env.QUALITY102_CAUSAL_V1_MAX_GROSS ?? QUALITY102_CAUSAL_V1.maximumGross);
  return {
    strategyId: QUALITY102_CAUSAL_V1.strategyId,
    mode,
    enabled: bool("QUALITY102_CAUSAL_V1_ENABLED"),
    liveTradingEnabled: bool("QUALITY102_CAUSAL_V1_LIVE_TRADING_ENABLED"),
    liveExecutionEnabled: bool("QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED"),
    operatorArmed: bool("QUALITY102_CAUSAL_V1_OPERATOR_ARMED"),
    maximumGross: Math.min(0.5, Math.max(0, Number.isFinite(requestedGross) ? requestedGross : 0.5)),
    cryptoGrossCap: 2,
    totalGrossCap: 2.5,
    maximumPositions: 1,
    historicalSelectorParity: false,
    brkEnabled: false,
  } as const;
}
```

- [ ] **Step 4: Add and run the package script**

Add `"strategy:quality102-causal-v1:runtime:selftest": "tsx scripts/disdex-quality102-causal-v1-runtime-selftest.ts"`.

Run: `npm run strategy:quality102-causal-v1:runtime:selftest`

Expected: `QUALITY102_CAUSAL_V1_RUNTIME_SELFTEST_PASS`.

- [ ] **Step 5: Commit**

```powershell
git add config/disdexQuality102CausalV1Runtime.ts scripts/disdex-quality102-causal-v1-runtime-selftest.ts package.json tsconfig.json
git commit -m "feat: define inert Quality102 causal v1 runtime"
```

### Task 2: Causal Signal Engine and Market Data Cutoff

**Files:**
- Create: `lib/disdex-quality102-causal-v1-signal.ts`
- Create: `lib/disdex-quality102-causal-v1-market-data.ts`
- Create: `scripts/disdex-quality102-causal-v1-signal-selftest.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Quality102Candle`, `computeQuality102HighVolFeatures`, `matchQuality102HighVolGrid`, `generateQuality102HighVolSignals`, `evaluateS34QualityGate`, and `routeQuality102OneSlot`.
- Produces: `Quality102CausalV1History`, `Quality102CausalV1Signal`, `buildQuality102CausalV1Signal(input)`, and `Quality102CausalV1AsterMarketDataProvider.load()`.

- [ ] **Step 1: Write causal-cutoff and family tests**

```ts
assert.throws(() => buildQuality102CausalV1Signal({ history: futureHistory, decisionTs: NOW }), /FUTURE_CANDLE/);
assert.throws(() => buildQuality102CausalV1Signal({ history: staleHistory, decisionTs: NOW }), /STALE_CANDLE/);
assert.throws(() => buildQuality102CausalV1Signal({ history: gappedHistory, decisionTs: NOW }), /NONCONTIGUOUS/);
assert.equal(buildQuality102CausalV1Signal({ history: brkOnlyHistory, decisionTs: NOW }).side, 0);
assert.notEqual(buildQuality102CausalV1Signal({ history: highVolHistory, decisionTs: NOW }).family, "BRK");
assert.equal(buildQuality102CausalV1Signal({ history: pbHistory, decisionTs: NOW }).family, "PB");
assert.equal(buildQuality102CausalV1Signal({ history: mrHistory, decisionTs: NOW }).family, "MR");
assert.equal(buildQuality102CausalV1Signal({ history: revHistory, decisionTs: NOW }).family, "REV");
```

Fixture builders use hourly candles ending strictly before `NOW`; each positive fixture changes one final closed candle so the corresponding causal rule crosses its boundary.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx scripts/disdex-quality102-causal-v1-signal-selftest.ts`

Expected: FAIL because the signal and provider modules do not exist.

- [ ] **Step 3: Implement strict history validation**

```ts
function assertClosedCausalHistory(rows: readonly Quality102Candle[], decisionTs: number) {
  if (rows.length < 181 * 24) throw new Error("QUALITY102_INSUFFICIENT_WALK_FORWARD_HISTORY");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.timestampMs >= decisionTs) throw new Error("QUALITY102_FUTURE_CANDLE");
    if (index && row.timestampMs - rows[index - 1].timestampMs !== QUALITY102_HOUR_MS) {
      throw new Error("QUALITY102_NONCONTIGUOUS_1H");
    }
  }
  if (decisionTs - rows.at(-1)!.timestampMs > 2 * QUALITY102_HOUR_MS) {
    throw new Error("QUALITY102_STALE_CANDLE");
  }
}
```

- [ ] **Step 4: Implement deterministic candidate generation**

Use closed candles through `decisionTs - 1`, train HIGH_VOL monthly rules on the preceding 180 days, and generate only the current decision candidate. Generate PB, MR, and REV through recovered causal conditions and `evaluateS34QualityGate`. Do not import `research_quality102_recovered_replay.py`, `quality102_mtm_entry_evidence.csv`, or any historical event timestamp. Hard-code `BRK` candidate generation to an empty array and expose `brkEnabled: false` in signal telemetry.

Return:

```ts
export interface Quality102CausalV1Signal {
  strategyId: "QUALITY102_CAUSAL_V1";
  referenceTs: number;
  side: -1 | 0 | 1;
  symbol?: string;
  family?: "HIGH_VOL" | "PB" | "MR" | "REV";
  requestedGross: number;
  reason: string;
  dataCutoffTs: number;
  brkEnabled: false;
}
```

- [ ] **Step 5: Implement the Aster provider**

Fetch the configured symbol universe plus BTC reference with `getKlines(symbol, "1h", limit)`, retain only candles whose close time is before `now`, reject duplicates and gaps, and return exchange timestamps unchanged. Cache for at most five minutes; never synthesize exchange freshness from the local clock.

- [ ] **Step 6: Run signal tests and existing pipeline tests**

Run:

```powershell
npm run strategy:quality102-causal-v1:signal:selftest
npm run strategy:strict-bt33404708902:pipeline:selftest
npm run strategy:strict-bt33404708902:causal-selector:selftest
```

Expected: all PASS and the new test reports `historicalSelectorParity=false`, `brkEnabled=false`.

- [ ] **Step 7: Commit**

```powershell
git add lib/disdex-quality102-causal-v1-signal.ts lib/disdex-quality102-causal-v1-market-data.ts scripts/disdex-quality102-causal-v1-signal-selftest.ts package.json
git commit -m "feat: generate causal Quality102 v1 signals"
```

### Task 3: Independent Atomic State and Restart Reconciliation

**Files:**
- Create: `lib/disdex-quality102-causal-v1-state.ts`
- Create: `scripts/disdex-quality102-causal-v1-state-selftest.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `Quality102CausalV1State`, `Quality102CausalV1PendingOrder`, `Quality102CausalV1StateStore`, `FileQuality102CausalV1StateStore`, and `MemoryQuality102CausalV1StateStore`.
- State version is `1`, identity is `QUALITY102_CAUSAL_V1`, and writes use temporary file plus rename with mode `0600`.

- [ ] **Step 1: Write malformed, atomic, and restart tests**

```ts
assert.equal(createQuality102CausalV1State("PAPER").strategyId, "QUALITY102_CAUSAL_V1");
await assert.rejects(() => malformedStore.load(), /QUALITY102_STATE_MALFORMED/);
await store.save(stateWithPending);
assert.deepEqual(await restartedStore.load(), stateWithPending);
assert.equal((await restartedStore.load()).pending?.phase, "submitted");
```

Also verify a state carrying strategy ID `QUALITY102` is rejected rather than migrated silently.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx scripts/disdex-quality102-causal-v1-state-selftest.ts`

Expected: FAIL because the state module does not exist.

- [ ] **Step 3: Implement state types and strict normalization**

```ts
export interface Quality102CausalV1PendingOrder {
  idempotencyKey: string;
  clientOrderId: string;
  phase: "planned" | "submitted" | "manual_review";
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  reduceOnly: boolean;
  referenceTs: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export interface Quality102CausalV1State {
  version: 1;
  strategyId: "QUALITY102_CAUSAL_V1";
  mode: Quality102CausalV1Mode;
  runtimeCommitSha: string;
  updatedAt: number;
  lastProcessedReferenceTs?: number;
  lastCompletedIdempotencyKey?: string;
  position?: { symbol: string; side: -1 | 1; quantity: number; entryPrice: number; entryTs: number };
  pending?: Quality102CausalV1PendingOrder;
  lastReconciledAt?: number;
  failures: Array<{ occurredAt: number; message: string; idempotencyKey?: string }>;
}
```

Reject non-finite quantities/prices/timestamps, more than one position, unknown pending phases, mismatched strategy IDs, and runtime SHA mismatches in LIVE.

- [ ] **Step 4: Run the state test**

Run: `npm run strategy:quality102-causal-v1:state:selftest`

Expected: PASS with restart preserving pending state exactly.

- [ ] **Step 5: Commit**

```powershell
git add lib/disdex-quality102-causal-v1-state.ts scripts/disdex-quality102-causal-v1-state-selftest.ts package.json
git commit -m "feat: persist Quality102 causal v1 state"
```

### Task 4: Strict Planner Identity, Priority, and MTM Reduction

**Files:**
- Modify: `lib/disdex-strict-portfolio-planner.ts`
- Modify: `tests/strict_bt33404708902_contract.test.ts`
- Create: `tests/quality102_causal_v1_portfolio.test.ts`
- Modify: `package.json`

**Interfaces:**
- Extends `StrictStrategy` with `QUALITY102_CAUSAL_V1` while retaining historical `QUALITY102` as research-only and rejected.
- `planStrictPortfolio` accepts causal-v1 intents only when `quality102CausalV1Ready: true` is supplied by the runner after local gates.
- `markToMarketReducePosition` accepts `LIVE_MARKET_QUOTE` for causal-v1 and retains Binance Vision evidence requirements for historical research Quality102.

- [ ] **Step 1: Write Gross boundary and priority tests**

```ts
assert.equal(planAt({ crypto: 1.99, q102: 0.01 }).totals.cryptoGross, 2.00);
assert.equal(planAt({ crypto: 2.00, q102: 0.01 }).rejected[0].reason, "CRYPTO_GROSS_CAP");
assert.equal(planAt({ crypto: 2.01 }).status, "blocked");
assert.equal(planAt({ total: 2.49, q102: 0.01 }).totals.totalGross, 2.50);
assert.equal(planAt({ total: 2.50, q102: 0.01 }).rejected[0].reason, "TOTAL_GROSS_CAP");
assert.equal(planAt({ total: 2.51 }).status, "blocked");
assert.equal(planAt({ q102: 0.51 }).accepted[0].gross, 0.50);
```

Add simultaneous intent assertions that V12, PENGU, and V52 retain accepted quantities while Quality102 is residual-sized or rejected.

- [ ] **Step 2: Write Long and Short MTM reduction tests**

For entry `100`, mark `110`, reduced quantity `4`, fee `10bps` per side, assert Long realized PnL is `40 - 0.8`. For mark `90`, assert Long realized PnL is `-40 - 0.8`. Reverse signs for Short. Assert remaining quantity, unchanged entry basis, current mark, and resulting Gross after each reduction.

- [ ] **Step 3: Run tests and verify RED**

Run: `npx tsx --test tests/quality102_causal_v1_portfolio.test.ts`

Expected: FAIL because `QUALITY102_CAUSAL_V1` is not recognized or remains rejected.

- [ ] **Step 4: Implement causal-v1 planner support**

Treat `QUALITY102_CAUSAL_V1` as crypto and lowest priority. Keep historical `QUALITY102` rejected. Validate one slot and `0.50x`. For base entries, compute and apply causal-v1 MTM reduction before reserving the base order. Use `LIVE_MARKET_QUOTE` whose timestamp equals the decision timestamp and is within the configured maximum age. Recalculate equity and all Gross values after realized PnL and fees.

- [ ] **Step 5: Run strict planner suites**

Run:

```powershell
npm run strategy:quality102-causal-v1:portfolio:test
npm run strategy:strict-bt33404708902:contract
npm run strategy:strict-bt33404708902:gross:selftest
```

Expected: all PASS; historical Quality102 remains `QUALITY102_LIVE_BLOCKED_FAIL_CLOSED`.

- [ ] **Step 6: Commit**

```powershell
git add lib/disdex-strict-portfolio-planner.ts tests/strict_bt33404708902_contract.test.ts tests/quality102_causal_v1_portfolio.test.ts package.json
git commit -m "feat: plan Quality102 causal v1 within strict gross"
```

### Task 5: Quality102 Portfolio Runner and Safe Execution

**Files:**
- Create: `lib/disdex-quality102-causal-v1-runner.ts`
- Create: `scripts/disdex-quality102-causal-v1-runner-selftest.ts`
- Create: `scripts/disdex-quality102-causal-v1-live-runner.ts`
- Modify: `package.json`
- Create: `tsconfig.quality102-causal-v1.json`

**Interfaces:**
- Consumes: market provider, `DirectTradeExecutor`, causal-v1 state store, `FileAccountOrderLock`, shared kill switch/daily-risk readers, and `planStrictPortfolio`.
- Produces: `Quality102CausalV1Runner.tick()` and CLI modes `--once`, `--daemon`, and `--self-test`.

- [ ] **Step 1: Write runner gate and non-interference tests**

```ts
assert.equal((await shadowRunner.tick()).status, "shadow");
assert.equal(executorCalls, 0);
await assert.rejects(() => liveRunnerWithoutArm.tick(), /OPERATOR_ARM_REQUIRED/);
assert.equal((await runnerWithStaleData.tick()).status, "blocked-local");
assert.equal((await runnerWithOpenOrder.tick()).status, "manual-review");
assert.equal((await runnerWithDuplicateSignal.tick()).status, "held");
assert.equal(baseStrategyStopCalls, 0);
```

Add UNKNOWN execution reconciliation: persist `submitted`, restart, call `reconcileOrder`, and block a second `executeMarket` call until FILLED/CANCELED/REJECTED is proven.

- [ ] **Step 2: Run the runner test and verify RED**

Run: `npx tsx scripts/disdex-quality102-causal-v1-runner-selftest.ts`

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement gate ordering**

`tick()` order is: load state; validate runtime SHA; reconcile pending; acquire shared account lock; check kill switch and daily latch; load closed market data; fetch account/positions/open orders; reject unknown ownership; reconcile Quality102 position; build signal; reject duplicate/old signal; obtain fresh quote; build strict plan; normalize quantity; persist `planned`; reserve shared Gross; persist `submitted`; execute; reconcile result; atomically persist completion; release reservation and lock.

SHADOW must not call account, quote, normalize, execute, or reconciliation methods. PAPER uses `SignedPaperDirectTradeExecutor`. LIVE requires enabled, live-trading, live-execution, and operator-arm flags plus exact `DISDEX_RUNTIME_COMMIT_SHA`.

- [ ] **Step 4: Implement deterministic order identity**

```ts
const idempotencyKey = createHash("sha256")
  .update(["QUALITY102_CAUSAL_V1", signal.referenceTs, signal.symbol, signal.side, targetGross.toFixed(12)].join("|"))
  .digest("hex");
const clientOrderId = `q102v1-${idempotencyKey}`.slice(0, 36);
```

No blind retry is allowed after an unknown submission. A local failure returns `blocked-local` and never manages another service.

- [ ] **Step 5: Implement CLI assembly**

Use `AsterV3Client`, `AsterDirectTradeExecutor`, `SignedPaperDirectTradeExecutor`, `Quality102CausalV1AsterMarketDataProvider`, `FileQuality102CausalV1StateStore`, and `FileAccountOrderLock`. The daemon waits until the next closed hour plus a configurable 5-second boundary delay and responds to SIGINT/SIGTERM through `createInterruptibleDelay`.

- [ ] **Step 6: Run runner, type, and no-write verification**

Run:

```powershell
npm run strategy:quality102-causal-v1:runner:selftest
npm run strategy:quality102-causal-v1:typecheck
$env:QUALITY102_CAUSAL_V1_MODE='SHADOW'; npm run strategy:quality102-causal-v1:once
```

Expected: tests and typecheck PASS; SHADOW reports `ordersSent=false` and makes no executor calls.

- [ ] **Step 7: Commit**

```powershell
git add lib/disdex-quality102-causal-v1-runner.ts scripts/disdex-quality102-causal-v1-runner-selftest.ts scripts/disdex-quality102-causal-v1-live-runner.ts package.json tsconfig.quality102-causal-v1.json
git commit -m "feat: add Quality102 causal v1 runner"
```

### Task 6: Production Service, Environment Contract, and CI

**Files:**
- Create: `ops/systemd/disdex-quality102-causal-v1@.service`
- Create: `ops/env/disdex-quality102-causal-v1.env.example`
- Create: `.github/workflows/quality102-causal-v1-live.yml`
- Create: `scripts/disdex-quality102-causal-v1-preflight.ts`
- Modify: `package.json`

**Interfaces:**
- Service runs one immutable release `%i`, writes only `/var/lib/disdex/quality102-causal-v1` and `/var/lib/disdex/shared`, and defaults to SHADOW/off.
- Preflight emits JSON with exact SHA, gates, data freshness, state reconciliation, Gross caps, and order counters.

- [ ] **Step 1: Write the preflight self-test**

Assert missing runtime SHA, malformed state, active pending order, stale data, failed reconciliation, Gross-cap mismatch, enabled BRK, or historical parity `true` returns nonzero. Assert a valid no-write fixture returns:

```json
{
  "strategyId": "QUALITY102_CAUSAL_V1",
  "historicalSelectorParity": false,
  "brkEnabled": false,
  "quality102GrossCap": 0.5,
  "cryptoGrossCap": 2,
  "totalGrossCap": 2.5,
  "reconciliation": "PASS",
  "ordersSent": 0
}
```

- [ ] **Step 2: Run preflight test and verify RED**

Run: `npx tsx scripts/disdex-quality102-causal-v1-preflight.ts --self-test`

Expected: FAIL because preflight is absent.

- [ ] **Step 3: Add inert service and environment templates**

The service sets `QUALITY102_CAUSAL_V1_MODE=SHADOW`, all enable flags `false`, uses `/usr/bin/npm run strategy:quality102-causal-v1:daemon`, restarts on failure with a 10-second delay, and has `NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectSystem=strict`, and explicit `ReadWritePaths`.

The environment template contains no credentials and documents the separate operator arm. It points at the shared account lock, shared crypto daily-risk state, and Quality102 state file.

- [ ] **Step 4: Add exact CI contract**

The workflow runs runtime, signal, state, portfolio, runner, and preflight tests; strict historical contract; V12 test; PENGU V8 test; V52 contract; TypeScript checks; `npm run build`; and `git diff --exit-code`. It uploads sanitized test reports only and never has environment secrets or LIVE flags.

- [ ] **Step 5: Run the complete local contract**

Run:

```powershell
npm run strategy:quality102-causal-v1:contract
npm run strategy:v12-x1-all:selftest
npm run strategy:pengu-dual-ls-v2:selftest
npm run strategy:disdex-v52:contract
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits `0`; all self-tests report zero real/test/synthetic orders.

- [ ] **Step 6: Commit and push**

```powershell
git add ops/systemd/disdex-quality102-causal-v1@.service ops/env/disdex-quality102-causal-v1.env.example .github/workflows/quality102-causal-v1-live.yml scripts/disdex-quality102-causal-v1-preflight.ts package.json
git commit -m "ci: verify Quality102 causal v1 live contract"
git push -u origin codex/quality102-live-connection-20260904
```

- [ ] **Step 7: Verify GitHub Actions at the exact SHA**

Run `gh run list --branch codex/quality102-live-connection-20260904 --limit 5`, then `gh run watch <run-id> --exit-status` and `gh run view <run-id> --json headSha,status,conclusion,jobs`.

Expected: `headSha` equals local `git rev-parse HEAD` and conclusion is `success`.

### Task 7: XServer Deployment, No-Write Preflight, and LIVE Arm

**Files:**
- VPS immutable release: `/home/deploy/disdex-trading/releases/<sha>`
- VPS service: `/etc/systemd/system/disdex-quality102-causal-v1@.service`
- VPS environment: `/etc/disdex/disdex-quality102-causal-v1.env`
- VPS state: `/var/lib/disdex/quality102-causal-v1/runner-live.json`

**Interfaces:**
- Consumes: exact GREEN Git SHA and existing VPS secret environment references.
- Produces: active Quality102 service whose first order can only arise from a natural post-activation signal.

- [ ] **Step 1: Capture read-only VPS baseline**

Use SSH to record disk usage, current release links, active V12/PENGU/V52 units, current positions, open orders, account equity, shared kill switch, daily-risk latch, account lock, and existing Quality102 units. Do not print private keys or secret environment values.

- [ ] **Step 2: Stage the immutable release**

Create `/home/deploy/disdex-trading/releases/<full-sha>`, copy the tracked repository files, install locked dependencies, and verify `git rev-parse HEAD` or the release manifest equals the CI SHA. Do not alter existing service release paths.

- [ ] **Step 3: Install in no-write mode**

Install the service and environment with mode `SHADOW`, all three LIVE flags `false`, and operator arm `false`. Run `systemctl daemon-reload`, start only the new Quality102 unit, and leave V12/PENGU/V52 untouched.

- [ ] **Step 4: Run VPS preflight and reconciliation**

Run the exact release preflight and one SHADOW tick. Verify service `active`, `NRestarts=0`, release SHA match, state ownership/permissions, market-data freshness, account reconciliation, no duplicate/open Quality102 order, Quality102 `0.50`, Crypto `2.00`, Total `2.50`, BRK disabled, historical parity false, and order counters all zero.

- [ ] **Step 5: Arm the independent LIVE sleeve**

Only after Step 4 passes, set mode `LIVE`, enabled `true`, live-trading `true`, live-execution `true`, and operator-arm `true` in `/etc/disdex/disdex-quality102-causal-v1.env`. Preserve existing credential references without printing them. Restart only `disdex-quality102-causal-v1@<sha>.service`.

- [ ] **Step 6: Verify post-activation state**

Confirm active/running, exact SHA, `NRestarts=0`, reconciliation PASS, kill switch clear, daily latch clear, one runner only, no unresolved pending order, Gross settings `0.50/2.00/2.50`, and zero synthetic/test orders. Do not force a signal or send a probe order.

- [ ] **Step 7: Compare account state with baseline**

Confirm deployment itself did not close, resize, or create any position/order. A naturally occurring post-activation signal is reported separately with its causal timestamp and gate audit if one occurs.

- [ ] **Step 8: Record deployment evidence**

Create `audit/quality102-causal-v1-live-deployment-20260904.md` containing branch, SHA, CI run ID, service status, release path, sanitized preflight, Gross values, reconciliation, activation time, and order counters. Commit and push the audit without secrets.

---

## Final Verification Matrix

The final report must state exact evidence for:

```text
STRATEGY_ID=QUALITY102_CAUSAL_V1
HISTORICAL_SELECTOR_PARITY=FALSE
BRK_LIVE_ENABLED=FALSE
QUALITY102_GROSS_CAP=0.50
CRYPTO_GROSS_CAP=2.00
TOTAL_GROSS_CAP=2.50
BASE_STRATEGY_PRIORITY=PRESERVED
ZERO_PNL_REDUCTION=FALSE
STRICT_MTM_REDUCTION=TRUE
LOOKAHEAD_DETECTED=FALSE
RECONCILIATION=PASS
UNIT_TESTS=PASS
REGRESSION_TESTS=PASS
CI=SUCCESS
TEST_LIVE_ORDERS=0
SYNTHETIC_LIVE_ORDERS=0
DEPLOYMENT_FORCED_POSITION_CHANGES=0
QUALITY102_CAUSAL_V1_LIVE=TRUE
```

