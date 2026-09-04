import assert from "node:assert/strict";

import { QUALITY102_CAUSAL_V1 } from "../config/disdexQuality102CausalV1Runtime";
import {
    Quality102CausalV1Runner,
    type Quality102CausalV1RunnerConfig,
} from "../lib/disdex-quality102-causal-v1-runner";
import {
    createQuality102CausalV1State,
    MemoryQuality102CausalV1StateStore,
    type Quality102CausalV1State,
} from "../lib/disdex-quality102-causal-v1-state";
import { MemoryLiveRunnerLock } from "../lib/live-runner-state";
import type {
    DirectAccountSnapshot,
    DirectMarketQuote,
    DirectOpenOrder,
    DirectPosition,
    DirectTradeCommand,
    DirectTradeExecutor,
    DirectTradeResult,
    NormalizedOrderQuantity,
} from "../lib/direct-trade-executor";
import type { Quality102CausalV1History, Quality102CausalV1Signal } from "../lib/disdex-quality102-causal-v1-signal";

const NOW = Date.UTC(2026, 8, 4, 12);
const SHA = "0123456789abcdef0123456789abcdef01234567";
const HISTORY: Quality102CausalV1History = {
    candlesBySymbol: {
        FETUSDT: Array.from({ length: 181 * 24 }, (_, index) => ({
            timestampMs: NOW - (181 * 24 - index) * 3_600_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            quoteVolume: 1000,
        })),
    },
};

class FakeExecutor implements DirectTradeExecutor {
    calls = { account: 0, positions: 0, orders: 0, quote: 0, normalize: 0, execute: 0, reconcile: 0 };
    account: DirectAccountSnapshot = { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: NOW - 1000 };
    positions: DirectPosition[] = [];
    openOrders: DirectOpenOrder[] = [];
    quote: DirectMarketQuote = { symbol: "FETUSDT", bidPrice: 99, askPrice: 101, bidQuantity: 100, askQuantity: 100, midPrice: 100, spreadBps: 200, updatedAt: NOW - 1000 };
    executeResult: DirectTradeResult = {
        requestId: "",
        clientOrderId: "",
        symbol: "FETUSDT",
        side: "BUY",
        status: "FILLED",
        requestedQuantity: 5,
        submittedQuantity: 5,
        executedQuantity: 5,
        averagePrice: 101,
        quoteQuantity: 505,
        executionUnknown: false,
        reconciled: false,
    };

    async getAccountSnapshot() { this.calls.account += 1; return this.account; }
    async getPositions() { this.calls.positions += 1; return this.positions; }
    async getOpenOrders() { this.calls.orders += 1; return this.openOrders; }
    async getMarketQuote(symbol: string) { this.calls.quote += 1; return { ...this.quote, symbol }; }
    async normalizeMarketQuantity(symbol: string, requestedQuantity: number, referencePrice: number): Promise<NormalizedOrderQuantity> {
        this.calls.normalize += 1;
        return { symbol, quantity: requestedQuantity, quantityText: String(requestedQuantity), minQuantity: 0, maxQuantity: 1e9, stepSize: 0.001, minNotional: 5, notional: requestedQuantity * referencePrice };
    }
    async executeMarket(command: DirectTradeCommand) {
        this.calls.execute += 1;
        this.executeResult = { ...this.executeResult, requestId: command.requestId, clientOrderId: command.clientOrderId, symbol: command.symbol, side: command.side, requestedQuantity: command.quantity, submittedQuantity: command.quantity, executedQuantity: command.quantity };
        if (!command.reduceOnly) {
            this.positions = [{ symbol: command.symbol, quantity: command.quantity, entryPrice: command.expectedPrice, markPrice: command.expectedPrice, unrealizedPnl: 0, pnlPct: 0, notionalUsd: command.quantity * command.expectedPrice, positionSide: "BOTH", leverage: 1, updatedAt: NOW - 500 }];
        } else {
            this.positions = [];
        }
        return this.executeResult;
    }
    async reconcileOrder(symbol: string, clientOrderId: string) {
        this.calls.reconcile += 1;
        return { ...this.executeResult, symbol, clientOrderId, status: "UNKNOWN" as const, executionUnknown: true, reconciled: true, executedQuantity: 0, error: "not found" };
    }
}

function config(overrides: Partial<Quality102CausalV1RunnerConfig> = {}): Quality102CausalV1RunnerConfig {
    return {
        mode: "LIVE",
        enabled: true,
        liveTradingEnabled: true,
        liveExecutionEnabled: true,
        operatorArmed: true,
        runtimeCommitSha: SHA,
        expectedRuntimeCommitSha: SHA,
        symbols: ["FETUSDT"],
        maximumGross: QUALITY102_CAUSAL_V1.maximumGross,
        cryptoGrossCap: QUALITY102_CAUSAL_V1.cryptoGrossCap,
        totalGrossCap: QUALITY102_CAUSAL_V1.totalGrossCap,
        maximumPositions: QUALITY102_CAUSAL_V1.maximumPositions,
        maxSlippageBps: 35,
        minimumOrderNotionalUsd: 5,
        maximumEntryDelayMs: 2 * 3_600_000,
        maximumDailyLossPct: 5,
        ...overrides,
    };
}

function state(mode: "LIVE" | "SHADOW" = "LIVE", pending?: Quality102CausalV1State["pending"]): Quality102CausalV1State {
    return { ...createQuality102CausalV1State(mode, mode === "LIVE" ? SHA : ""), ...(pending ? { pending } : {}) };
}

function signal(overrides: Partial<Quality102CausalV1Signal> = {}): Quality102CausalV1Signal {
    return {
        strategyId: "QUALITY102_CAUSAL_V1",
        referenceTs: NOW - 3_600_000,
        side: 1,
        symbol: "FETUSDT",
        family: "HIGH_VOL",
        requestedGross: 0.5,
        reason: "NATURAL_SIGNAL",
        dataCutoffTs: NOW - 3_600_000,
        hardStop: 0.1,
        maxHoldHours: 72,
        brkEnabled: false,
        ...overrides,
    };
}

function deps(executor: FakeExecutor, initial: Quality102CausalV1State, cfg: Partial<Quality102CausalV1RunnerConfig> = {}, customSignal = signal) {
    let loads = 0;
    return {
        runner: new Quality102CausalV1Runner({
            marketData: { load: async () => { loads += 1; return HISTORY; } },
            executor,
            stateStore: new MemoryQuality102CausalV1StateStore(initial, initial.mode, SHA),
            lock: new MemoryLiveRunnerLock(),
            config: config(cfg),
            now: () => NOW,
            riskReader: async () => undefined,
            signalBuilder: () => customSignal(),
            logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        }),
        loads,
    };
}

async function run(): Promise<void> {
    {
        const fake = new FakeExecutor();
        const built = deps(fake, state("SHADOW"), { mode: "SHADOW", enabled: true, liveTradingEnabled: false, liveExecutionEnabled: false, operatorArmed: false });
        const result = await built.runner.tick();
        assert.equal(result.status, "shadow");
        assert.equal(fake.calls.account + fake.calls.positions + fake.calls.orders + fake.calls.quote + fake.calls.normalize + fake.calls.execute + fake.calls.reconcile, 0);
    }

    {
        const fake = new FakeExecutor();
        const built = deps(fake, state(), { operatorArmed: false });
        await assert.rejects(() => built.runner.tick(), /OPERATOR_ARM_REQUIRED/);
        assert.equal(fake.calls.execute, 0);
    }

    {
        const fake = new FakeExecutor();
        fake.account = { ...fake.account, updatedAt: NOW - 10 * 60_000 };
        const built = deps(fake, state());
        const result = await built.runner.tick();
        assert.equal(result.status, "blocked-local");
        assert.match(result.message, /STALE_OR_INVALID/);
        assert.equal(fake.calls.execute, 0);
    }

    {
        const fake = new FakeExecutor();
        fake.quote = { ...fake.quote, bidQuantity: 0 };
        const built = deps(fake, state());
        const result = await built.runner.tick();
        assert.equal(result.status, "blocked-local");
        assert.match(result.message, /entry quote is stale or invalid/i);
        assert.equal(fake.calls.execute, 0);
    }

    {
        const fake = new FakeExecutor();
        const pending = { idempotencyKey: "pending", clientOrderId: "q102v1-pending", phase: "submitted" as const, symbol: "FETUSDT", side: "BUY" as const, quantity: 5, reduceOnly: false, referenceTs: NOW - 3_600_000, createdAt: NOW - 1000, updatedAt: NOW - 1000, hardStop: 0.1 };
        const built = deps(fake, state("LIVE", pending));
        const result = await built.runner.tick();
        assert.equal(result.status, "manual-review");
        assert.equal(fake.calls.reconcile, 1);
        assert.equal(fake.calls.execute, 0);
    }

    {
        const fake = new FakeExecutor();
        const built = deps(fake, state());
        const result = await built.runner.tick();
        assert.equal(result.status, "completed");
        assert.equal(result.ordersSent, 1);
        assert.equal(fake.calls.execute, 1);
        const saved = await (built.runner as unknown as { dependencies: { stateStore: { load(): Promise<Quality102CausalV1State> } } }).dependencies.stateStore.load();
        assert.equal(saved.position?.symbol, "FETUSDT");
        assert.equal(saved.position?.hardStop, 0.1);
        assert.equal(saved.position?.trailActive, false);
    }

    {
        const fake = new FakeExecutor();
        fake.executeResult = { ...fake.executeResult, executionUnknown: true, error: "venue response was ambiguous" };
        const built = deps(fake, state());
        const result = await built.runner.tick();
        assert.equal(result.status, "manual-review");
        assert.equal(fake.calls.execute, 1);
        const saved = await (built.runner as unknown as { dependencies: { stateStore: { load(): Promise<Quality102CausalV1State> } } }).dependencies.stateStore.load();
        assert.equal(saved.pending?.phase, "manual_review");
    }

    {
        const fake = new FakeExecutor();
        const built = deps(fake, state(), { runtimeCommitSha: "f".repeat(40) });
        await assert.rejects(() => built.runner.tick(), /RUNTIME_SHA_MISMATCH/);
    }

    console.log("QUALITY102_CAUSAL_V1_RUNNER_SELFTEST_PASS", JSON.stringify({ realOrders: 0, testOrders: 0, syntheticOrders: 0 }));
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
