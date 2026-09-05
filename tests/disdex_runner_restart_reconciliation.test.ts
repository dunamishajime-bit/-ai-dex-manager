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
import { assertV12ExactReleasePreflight } from "../scripts/disdex-v12-x1-all-live-runner";
import type { DirectAccountSnapshot, DirectMarketQuote, DirectOpenOrder, DirectPosition, DirectTradeResult } from "../lib/direct-trade-executor";
import type { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import {
    isSystemdIntentionalStop,
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
type Order = DirectOpenOrder & { managedBy: string; type?: string; stopPrice?: number };

class InMemoryAccountExchange {
    readonly positions: Position[] = [{ symbol: "ETHUSDT", quantity: 1.25, entryPrice: 1, markPrice: 1, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 1.25, positionSide: "LONG", leverage: 1, updatedAt: 1_700_000_000_000, managedBy: "V12" }];
    readonly openOrders: Order[] = [
        { symbol: "ETHUSDT", clientOrderId: "v12-stop-existing", side: "SELL", status: "NEW", type: "STOP_MARKET", stopPrice: 0.9, reduceOnly: true, quantity: 1.25, executedQuantity: 0, managedBy: "V12" },
        { symbol: "ETHUSDT", clientOrderId: "v12-tp-existing", side: "SELL", status: "NEW", type: "TAKE_PROFIT_MARKET", stopPrice: 1.2, reduceOnly: true, quantity: 1.25, executedQuantity: 0, managedBy: "V12" },
    ];
    readonly counters = { submit: 0, cancel: 0, modify: 0, close: 0 };
    readonly lockOwners: string[] = [];
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
            listV12Orders: async () => exchange.openOrders,
            openOrders: async (symbol: string) => exchange.openOrders.filter((order) => order.symbol === symbol),
            normalizeStopPrice: async (_symbol: string, price: number) => ({ price }),
            placeStopMarket: async () => { exchange.counters.submit += 1; throw new Error("fixture must not place a stop"); },
            placeTakeProfit: async () => { exchange.counters.submit += 1; throw new Error("fixture must not place take profit"); },
            cancel: async () => { exchange.counters.cancel += 1; throw new Error("fixture must not cancel"); },
            flattenReduceOnly: async () => { exchange.counters.close += 1; throw new Error("fixture must not close"); },
        } as unknown as V12AsterLiveAdapter;
    }
}

class TrackingAccountOrderLock extends FileAccountOrderLock {
    activeOwners = 0;
    maximumOwners = 0;
    acquisitions = 0;

    override async acquire(ownerId: string) {
        const handle = await super.acquire(ownerId);
        if (!handle) return null;
        this.acquisitions += 1;
        this.activeOwners += 1;
        this.maximumOwners = Math.max(this.maximumOwners, this.activeOwners);
        const release = handle.release;
        return { ...handle, release: async () => { await release(); this.activeOwners -= 1; } };
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
        await writeFile(riskPath, JSON.stringify(buildSharedCryptoDailyRiskState({ accountScope: "ASTER_FUTURES", utcDay: new Date(now).toISOString().slice(0, 10), strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1"], lossPct: 0, maximumLossPct: 5, tripped: false, updatedAt: now, realizedPnl: 0, unrealizedPnl: 0, fees: 0, funding: 0, netDailyPnl: 0, referenceEquity: 1000, sourceComplete: true })));
        const marketData = { load: async () => Object.fromEntries(V12_X1_ALL.universe.map((symbol) => [symbol, Array.from({ length: 80 }, (_, index) => ({ ts: now - (80 - index) * 3_600_000, endTs: now - (80 - index) * 3_600_000, open: 1, high: 1, low: 1, close: 1, volume: 1, sourceCount: 2 as const }))])) };
        const protection = { strategyId: "V12_X1.00_ALL" as const, symbol: "ETHUSDT", side: "LONG" as const, positionId: "v12-position-existing", quantity: 1.25, entryPrice: 1, atrAtEntry: 0.1, initialStop: 0.9, lastAckStop: 0.9, takeProfit: 1.2, peakOrTrough: 1, stopClientOrderId: "v12-stop-existing", takeProfitClientOrderId: "v12-tp-existing" };
        await stateStore.save({ schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "SHADOW", updatedAt: now, lastReferenceTs: now, active: { symbol: "ETHUSDT", side: "LONG", quantity: 1.25, gross: 0.00125, positionId: "v12-position-existing", entryPrice: 1, atrAtEntry: 0.1, entrySignalTs: now, holdingBars: 1, peakPrice: 1, troughPrice: 1, protection } });
        const lock = new TrackingAccountOrderLock(join(root, "account-order.lock"));
        const beforeState = await stateStore.load();
        const makeEngine = () => new V12LiveExecutionEngine({ adapter: exchange.adapter(), marketData, stateStore, lock, riskPath, now: () => now });
        assert.equal((await makeEngine().tick()).status, "held");
        assert.equal((await makeEngine().tick()).status, "held");
        const afterState = await stateStore.load();
        assert.deepEqual(exchange.snapshot(), before);
        assert.deepEqual({ ...afterState, updatedAt: beforeState.updatedAt }, beforeState);
        assert.equal(lock.acquisitions, 2);
        assert.equal(lock.maximumOwners, 1);
        assert.equal(lock.activeOwners, 0);
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
    assert.match(v12, /Type=simple/);
    assert.match(v12, /--daemon/);
    assert.match(v12, /^Restart=on-failure/m);
    assert.match(v12, /^RestartSec=15/m);
    assert.doesNotMatch(v12, /Intentional oneshot/);
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

test("an active configured V12 with a stale heartbeat remains restartable after daemon exit", async () => {
    const fixture = await makeWatchdogFixture();
    try {
        const system = new HealthySystem();
        const stale = heartbeat("V12", fixture.now - 10 * 60_000);
        await writeRunnerHeartbeat(fixture.config.runners.V12.heartbeatPath, stale);
        const result = await runWatchdog({ config: fixture.config, system, now: fixture.now });
        assert.equal(result.decisions.V12.action, "RESTART");
        assert.equal(result.decisions.V12.restartAuthorized, true);
        assert.ok(result.restartCalls.includes(UNITS.V12));
    } finally {
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test("default-disabled V12 heartbeat is explicit and never restartable", async () => {
    const fixture = await makeWatchdogFixture();
    const original = {
        runtime: process.env.DISDEX_RUNTIME_COMMIT_SHA,
        expected: process.env.DISDEX_EXPECTED_RUNTIME_SHA,
        unit: process.env.DISDEX_RUNNER_SERVICE_UNIT,
    };
    try {
        process.env.DISDEX_RUNTIME_COMMIT_SHA = SHA;
        process.env.DISDEX_EXPECTED_RUNTIME_SHA = SHA;
        process.env.DISDEX_RUNNER_SERVICE_UNIT = UNITS.V12;
        const { buildV12RunnerHeartbeat } = await import("../scripts/disdex-v12-x1-all-live-runner");
        const disabled = buildV12RunnerHeartbeat({ status: "disabled", reason: "V12 runtime disabled" }, fixture.now, { mode: "SHADOW", liveTradingEnabled: false, liveExecutionEnabled: false });
        assert.equal(disabled.liveEnabled, false);
        assert.equal(disabled.safetyState, "WAITING");
        assert.equal(disabled.mode, "SHADOW");
        await writeRunnerHeartbeat(fixture.config.runners.V12.heartbeatPath, disabled);
        const result = await runWatchdog({ config: fixture.config, system: new HealthySystem(), now: fixture.now + 10 * 60_000 });
        assert.equal(result.decisions.V12.action, "NOOP");
        assert.equal(result.decisions.V12.restartAuthorized, false);
        assert.deepEqual(result.decisions.V12.tradingEffects, { ordersSent: 0, cancelSent: 0, positionChangesSent: 0 });
        assert.ok(!result.restartCalls.includes(UNITS.V12));
    } finally {
        for (const [key, value] of Object.entries({ DISDEX_RUNTIME_COMMIT_SHA: original.runtime, DISDEX_EXPECTED_RUNTIME_SHA: original.expected, DISDEX_RUNNER_SERVICE_UNIT: original.unit })) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        await rm(fixture.root, { recursive: true, force: true });
    }
});

test("watchdog restart adapter runs exact-release preflight before constructing the real V12 engine", async () => {
    const exchange = new InMemoryAccountExchange();
    const before = exchange.snapshot();
    const root = await mkdtemp(join(tmpdir(), "disdex-v12-startup-harness-"));
    try {
        const releaseRoot = join(root, "release");
        await mkdir(releaseRoot, { recursive: true });
        await writeFile(join(releaseRoot, ".disdex-release-sha"), `${SHA}\n`);
        const fixture = await makeWatchdogFixture();
        const now = fixture.now;
        const stateStore = new FileV12X1AllRunnerStateStore(join(root, "state.json"), "SHADOW");
        const riskPath = join(root, "risk.json");
        await writeFile(riskPath, JSON.stringify(buildSharedCryptoDailyRiskState({ accountScope: "ASTER_FUTURES", utcDay: new Date(now).toISOString().slice(0, 10), strategyIds: ["V12_X1.00_ALL"], lossPct: 0, maximumLossPct: 5, tripped: false, updatedAt: now, realizedPnl: 0, unrealizedPnl: 0, fees: 0, funding: 0, netDailyPnl: 0, referenceEquity: 1000, sourceComplete: true })));
        const marketData = { load: async () => Object.fromEntries(V12_X1_ALL.universe.map((symbol) => [symbol, Array.from({ length: 80 }, (_, index) => ({ ts: now - (80 - index) * 3_600_000, endTs: now - (80 - index) * 3_600_000, open: 1, high: 1, low: 1, close: 1, volume: 1, sourceCount: 2 as const }))])) };
        const protection = { strategyId: "V12_X1.00_ALL" as const, symbol: "ETHUSDT", side: "LONG" as const, positionId: "v12-position-existing", quantity: 1.25, entryPrice: 1, atrAtEntry: 0.1, initialStop: 0.9, lastAckStop: 0.9, takeProfit: 1.2, peakOrTrough: 1, stopClientOrderId: "v12-stop-existing", takeProfitClientOrderId: "v12-tp-existing" };
        await stateStore.save({ schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "SHADOW", updatedAt: now, lastReferenceTs: now, active: { symbol: "ETHUSDT", side: "LONG", quantity: 1.25, gross: 0.00125, positionId: "v12-position-existing", entryPrice: 1, atrAtEntry: 0.1, entrySignalTs: now, holdingBars: 1, peakPrice: 1, troughPrice: 1, protection } });
        const beforeState = await stateStore.load();
        const lock = new TrackingAccountOrderLock(join(root, "account-order.lock"));
        const startup = async () => {
            await assertV12ExactReleasePreflight({ cwd: releaseRoot, expectedSha: SHA });
            return new V12LiveExecutionEngine({ adapter: exchange.adapter(), marketData, stateStore, lock, riskPath, now: () => now });
        };
        let started: V12LiveExecutionEngine | undefined;
        class RestartHarness extends HealthySystem {
            override async restart(unit: string) { this.restarts.push(unit); started = await startup(); await started.tick(); }
        }
        const system = new RestartHarness();
        await assertV12ExactReleasePreflight({ cwd: releaseRoot, expectedSha: SHA });
        const first = new V12LiveExecutionEngine({ adapter: exchange.adapter(), marketData, stateStore, lock, riskPath, now: () => now });
        assert.equal((await first.tick()).status, "held");
        await writeRunnerHeartbeat(fixture.config.runners.V12.heartbeatPath, heartbeat("V12", now - 10 * 60_000));
        const result = await runWatchdog({ config: { ...fixture.config, runners: { ...fixture.config.runners, V12: { ...fixture.config.runners.V12, expectedCwd: releaseRoot } } }, system, now });
        assert.ok(started);
        assert.equal(result.decisions.V12.restartAuthorized, true);
        assert.deepEqual(exchange.snapshot(), before);
        const afterState = await stateStore.load();
        assert.deepEqual({ ...afterState, updatedAt: beforeState.updatedAt }, beforeState);
        assert.equal(lock.maximumOwners, 1);
        assert.deepEqual(exchange.counters, { submit: 0, cancel: 0, modify: 0, close: 0 });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("clean systemd completion is not V12 daemon stop intent", () => {
    const clean = { ActiveState: "inactive", SubState: "dead", Result: "success", ExecMainCode: "1", ExecMainStatus: "0" };
    assert.equal(isSystemdIntentionalStop(UNITS.V12, clean), false);
    assert.equal(isSystemdIntentionalStop("disdex-quality102-causal-v1@" + SHA + ".service", clean), true);
});

test("recovery decision itself cannot authorize LIVE promotion from a safety latch", () => {
    const decision = decideRecovery({ now: 1000, heartbeat: heartbeat("QUALITY102_CAUSAL_V1", 1000, "MANUAL_REVIEW"), serviceActive: true, mainPid: 123, processCwd: "/release", expectedCwd: "/release", expectedSha: SHA, restartAttempts: 0 });
    assert.equal(decision.action, "HOLD_FAIL_CLOSED");
    assert.equal(decision.restartAuthorized, false);
});
