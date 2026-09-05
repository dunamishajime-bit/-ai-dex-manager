import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
    decideRecovery,
    writeRunnerHeartbeat,
    type RunnerHeartbeat,
    type RunnerId,
} from "../lib/disdex-runner-health";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { buildSharedCryptoDailyRiskState } from "../lib/disdex-shared-crypto-daily-risk";
import { V12LiveExecutionEngine } from "../lib/v12-live-execution-engine";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import type { DirectAccountSnapshot, DirectMarketQuote, DirectOpenOrder, DirectPosition, DirectTradeResult } from "../lib/direct-trade-executor";
import type { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import {
    runWatchdog,
    type RunnerWatchdogConfig,
    type RunnerWatchdogSystem,
} from "../scripts/disdex-runner-watchdog";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUNNERS: RunnerId[] = ["V12", "PENGU_V8", "V52", "QUALITY102_CAUSAL_V1"];
const UNITS: Record<RunnerId, string> = {
    V12: `disdex-v12-x1-all@${SHA}.service`,
    PENGU_V8: "disdex-v96-v52-live.service",
    V52: "disdex-v96-v52-live.service",
    QUALITY102_CAUSAL_V1: `disdex-quality102-causal-v1@${SHA}.service`,
};

type Position = DirectPosition & { managedBy: string };
type Order = DirectOpenOrder & { managedBy: string };

class InMemoryAccountExchange {
    readonly positions: Position[] = [{ symbol: "PENGUUSDT", quantity: 1.25, entryPrice: 1, markPrice: 1, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 1.25, positionSide: "LONG", leverage: 1, updatedAt: 1_700_000_000_000, managedBy: "V52" }];
    readonly openOrders: Order[] = [{ symbol: "PENGUUSDT", clientOrderId: "v52-existing", side: "SELL", status: "NEW", reduceOnly: true, quantity: 1.25, executedQuantity: 0, managedBy: "V52" }];
    readonly counters = { submit: 0, cancel: 0, modify: 0, close: 0 };
    readonly account: DirectAccountSnapshot = { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: 1_700_000_000_000 };
    readonly quote: DirectMarketQuote = { symbol: "PENGUUSDT", bidPrice: 1, askPrice: 1, bidQuantity: 100, askQuantity: 100, midPrice: 1, spreadBps: 0, updatedAt: 1_700_000_000_000 };

    snapshot() {
        return { positions: structuredClone(this.positions), openOrders: structuredClone(this.openOrders), ownership: this.positions.map((position) => position.managedBy) };
    }

    adapter() {
        const exchange = this;
        const executor = {
            getAccountSnapshot: async () => exchange.account,
            getPositions: async () => exchange.positions,
            getOpenOrders: async () => exchange.openOrders,
            getMarketQuote: async () => exchange.quote,
            normalizeMarketQuantity: async () => ({ symbol: "PENGUUSDT", quantity: 1.25, quantityText: "1.25", minQuantity: 0, maxQuantity: 100, stepSize: 0.01, minNotional: 0, notional: 1.25 }),
            executeMarket: async (_command: unknown): Promise<DirectTradeResult> => { exchange.counters.submit += 1; throw new Error("fixture must not submit"); },
            reconcileOrder: async (_symbol: string, _clientOrderId: string): Promise<DirectTradeResult> => { throw new Error("fixture must not reconcile an unresolved order"); },
        };
        return {
            executor,
            credentialsReady: async () => true,
            getPositions: executor.getPositions,
            getOpenOrders: executor.getOpenOrders,
            getAccountSnapshot: executor.getAccountSnapshot,
            listV12Orders: async () => [],
            openOrders: async () => [],
            normalizeStopPrice: async (_symbol: string, price: number) => ({ price }),
            placeStopMarket: async () => { exchange.counters.submit += 1; throw new Error("fixture must not place a stop"); },
            placeTakeProfit: async () => { exchange.counters.submit += 1; throw new Error("fixture must not place take profit"); },
            cancel: async () => { exchange.counters.cancel += 1; throw new Error("fixture must not cancel"); },
            flattenReduceOnly: async () => { exchange.counters.close += 1; throw new Error("fixture must not close"); },
        } as unknown as V12AsterLiveAdapter;
    }
}

function heartbeat(runnerId: RunnerId, now: number, safetyState: RunnerHeartbeat["safetyState"] = "LIVE", workingDirectory = "/release") : RunnerHeartbeat {
    return {
        schema: "disdex-runner-heartbeat/v1",
        runnerId,
        serviceUnit: UNITS[runnerId],
        runtimeSha: SHA,
        expectedSha: SHA,
        workingDirectory,
        mode: "LIVE",
        liveEnabled: safetyState === "LIVE",
        safetyState,
        heartbeatAt: now,
        lastTickAt: now,
        lastReconciliationAt: now,
        lastDecision: safetyState === "LIVE" ? "WAIT" : safetyState,
        reason: safetyState === "LIVE" ? "healthy" : safetyState,
        symbols: [],
        caps: { strategy: null, crypto: null, total: null },
        restartAttempts: 0,
        updatedAt: now,
        ...(runnerId === "QUALITY102_CAUSAL_V1" ? { quality102: { selectorMode: "DERIVED_HIGH_VOL_ONLY", historicalSelectorParity: false, brkLiveEnabled: false } } : {}),
    };
}

class HealthySystem implements RunnerWatchdogSystem {
    readonly restarts: string[] = [];
    private currentUnit = "";
    async isActive() { return true; }
    async mainPid(unit: string) { this.currentUnit = unit; return 123; }
    async processCwd() { return "/release"; }
    async processCommand() {
        return this.currentUnit.startsWith("disdex-v12")
            ? "/usr/bin/node scripts/disdex-v12-x1-all-live-runner.ts --once"
            : this.currentUnit.startsWith("disdex-quality")
                ? "/usr/bin/node scripts/disdex-quality102-causal-v1-live-runner.ts --daemon"
                : "/bin/bash scripts/ops/disdex-v96-v52-live.sh";
    }
    async restart(unit: string) { this.restarts.push(unit); }
}

async function makeWatchdogFixture(safetyState: RunnerHeartbeat["safetyState"] = "LIVE") {
    const root = await mkdtemp(join(tmpdir(), "disdex-restart-reconciliation-"));
    const healthRoot = join(root, "health");
    const releaseRoot = join(root, "release");
    await mkdir(join(healthRoot, "heartbeats"), { recursive: true });
    await mkdir(join(healthRoot, "private"), { recursive: true });
    await mkdir(releaseRoot, { recursive: true });
    await writeFile(join(releaseRoot, ".disdex-release-sha"), `${SHA}\n`);
    const now = 1_700_000_000_000;
    for (const runnerId of RUNNERS) {
        await writeRunnerHeartbeat(join(healthRoot, "heartbeats", `${runnerId === "QUALITY102_CAUSAL_V1" ? "quality102-causal-v1" : runnerId.toLowerCase().replace("_v8", "-v8")}.json`), heartbeat(runnerId, now, runnerId === "QUALITY102_CAUSAL_V1" ? safetyState : "LIVE"));
    }
    const runners = Object.fromEntries(RUNNERS.map((runnerId) => [runnerId, {
        runnerId,
        serviceUnit: UNITS[runnerId],
        heartbeatPath: join(healthRoot, "heartbeats", `${runnerId === "QUALITY102_CAUSAL_V1" ? "quality102-causal-v1" : runnerId.toLowerCase().replace("_v8", "-v8")}.json`),
        expectedCwd: releaseRoot,
        expectedSha: SHA,
        intentionalStopMarkerPath: join(healthRoot, `${runnerId.toLowerCase()}.intentional-stop`),
    }])) as RunnerWatchdogConfig["runners"];
    return {
        root,
        now,
        config: { healthRoot, runners, heartbeatTimeoutMs: 300000, attemptWindowMs: 1800000, maxAttempts: 3, backoffMs: [15000, 60000, 300000], auditPath: join(healthRoot, "private", "audit.json"), statePath: join(healthRoot, "private", "state.json"), lockPath: join(healthRoot, "private", "lock") },
    } satisfies { root: string; now: number; config: RunnerWatchdogConfig };
}

test("restart re-enters real V12 preflight/reconciliation and preserves managed state without writes or a second lock owner", async () => {
    const exchange = new InMemoryAccountExchange();
    const before = exchange.snapshot();
    const root = await mkdtemp(join(tmpdir(), "disdex-v12-restart-boundary-"));
    try {
        const now = 1_700_000_000_000;
        const stateStore = new FileV12X1AllRunnerStateStore(join(root, "state.json"), "SHADOW");
        const riskPath = join(root, "risk.json");
        await writeFile(riskPath, JSON.stringify(buildSharedCryptoDailyRiskState({ accountScope: "ASTER_FUTURES", utcDay: new Date(now).toISOString().slice(0, 10), strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1"], lossPct: 0, maximumLossPct: 5, tripped: true, updatedAt: now, realizedPnl: 0, unrealizedPnl: 0, fees: 0, funding: 0, netDailyPnl: 0, referenceEquity: 1000, sourceComplete: true })));
        const marketData = { load: async () => Object.fromEntries(V12_X1_ALL.universe.map((symbol) => [symbol, Array.from({ length: 80 }, (_, index) => ({ ts: now - (80 - index) * 3_600_000, endTs: now - (80 - index) * 3_600_000, open: 1, high: 1, low: 1, close: 1, volume: 1, sourceCount: 2 as const }))])) };
        const makeEngine = () => new V12LiveExecutionEngine({ adapter: exchange.adapter(), marketData, stateStore, lock: new FileAccountOrderLock(join(root, "account-order.lock")), riskPath, now: () => now });
        assert.equal((await makeEngine().tick()).status, "risk-blocked");
        assert.equal((await makeEngine().tick()).status, "risk-blocked");
        assert.deepEqual(exchange.snapshot(), before);
        const firstOwner = await new FileAccountOrderLock(join(root, "account-order.lock")).acquire("restart-owner");
        assert.ok(firstOwner);
        const secondOwner = await new FileAccountOrderLock(join(root, "account-order.lock")).acquire("second-owner");
        assert.equal(secondOwner, null);
        await firstOwner.release();
        assert.deepEqual(exchange.counters, { submit: 0, cancel: 0, modify: 0, close: 0 });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("watchdog safety states remain fail-closed and never promote a runner to LIVE", async () => {
    for (const safetyState of ["MANUAL_REVIEW", "STALE_DATA", "KILL_SWITCH"] as const) {
        const fixture = await makeWatchdogFixture(safetyState);
        try {
            const result = await runWatchdog({ config: fixture.config, system: new HealthySystem(), now: fixture.now });
            assert.equal(result.decisions.QUALITY102_CAUSAL_V1.action, "HOLD_FAIL_CLOSED");
            assert.equal(result.decisions.QUALITY102_CAUSAL_V1.restartAuthorized, false);
            assert.deepEqual(result.decisions.QUALITY102_CAUSAL_V1.tradingEffects, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
            assert.equal(result.restartCalls.length, 0);
            const persisted = JSON.parse(await readFile(fixture.config.runners.QUALITY102_CAUSAL_V1.heartbeatPath, "utf8")) as RunnerHeartbeat;
            assert.equal(persisted.safetyState, safetyState);
            assert.notEqual(persisted.safetyState, "LIVE");
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    }
});

test("service wiring is non-secret, singleton-safe, and exact-release bound", async () => {
    const files = await Promise.all([
        readFile("ops/systemd/disdex-quality102-causal-v1@.service", "utf8"),
        readFile("ops/systemd/disdex-v12-x1-all@.service", "utf8"),
        readFile("ops/systemd/disdex-v96-v52-live.service", "utf8"),
        readFile("scripts/ops/install-disdex-runner-health.sh", "utf8"),
    ]);
    const [q102, v12, combined, installer] = files;
    assert.match(q102, /Environment=DISDEX_RUNNER_ID=QUALITY102_CAUSAL_V1/);
    assert.match(v12, /Environment=DISDEX_RUNNER_ID=V12/);
    assert.match(combined, /Environment=DISDEX_PENGU_RUNNER_ID=PENGU_V8/);
    assert.match(combined, /Environment=DISDEX_V52_RUNNER_ID=V52/);
    assert.match(v12, /Type=oneshot/);
    assert.match(v12, /--once/);
    assert.doesNotMatch(v12, /^Restart=/m);
    assert.match(v12, /ExecStartPre=\/usr\/bin\/grep -Fxq %i \/opt\/disdex\/releases\/%i\/.disdex-release-sha/);
    assert.match(q102, /Restart=on-failure/);
    assert.match(combined, /ExecStartPre=\/usr\/bin\/grep -Fxq @DISDEX_RUNNER_RELEASE_SHA@ @DISDEX_RUNNER_RELEASE_ROOT@\/.disdex-release-sha/);
    assert.equal((combined.match(/^ExecStart=/gm) || []).length, 1);
    assert.doesNotMatch(combined, /disdex-pengu-dual-ls-v2\.service/);
    assert.match(installer, /DISDEX_RUNNER_PENGU_V8_SERVICE_UNIT=disdex-v96-v52-live\.service/);
    assert.match(installer, /DISDEX_RUNNER_V52_SERVICE_UNIT=disdex-v96-v52-live\.service/);
    for (const value of [q102, v12, combined]) {
        assert.doesNotMatch(value, /DISDEX_RUNNER_(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)=/i);
    }
});

test("recovery decision itself cannot authorize LIVE promotion from a safety latch", () => {
    const decision = decideRecovery({ now: 1000, heartbeat: heartbeat("QUALITY102_CAUSAL_V1", 1000, "MANUAL_REVIEW"), serviceActive: true, mainPid: 123, processCwd: "/release", expectedCwd: "/release", expectedSha: SHA, restartAttempts: 0 });
    assert.equal(decision.action, "HOLD_FAIL_CLOSED");
    assert.equal(decision.restartAuthorized, false);
});
