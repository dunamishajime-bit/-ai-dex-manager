import assert from "node:assert/strict";
import {
    type DirectAccountSnapshot,
    type DirectMarketQuote,
    type DirectOpenOrder,
    type DirectPosition,
    type DirectTradeCommand,
    type DirectTradeExecutor,
    type DirectTradeResult,
    type NormalizedOrderQuantity,
} from "../lib/direct-trade-executor";
import {
    MemoryLiveRunnerLock,
    MemoryLiveRunnerStateStore,
    type LiveRunnerState,
} from "../lib/live-runner-state";
import {
    Win80Ultra90LiveRunner,
    buildDefaultLiveRunnerConfig,
    type LiveStrategyMarketBundle,
} from "../lib/win80-ultra90-live-runner";
import type { ContinuousStrategyCandidate, ContinuousStrategyMonitor } from "../lib/cycle-strategy";

const NOW = 1_800_000_000_000;

function candidate(symbol: string, ultra = false): ContinuousStrategyCandidate {
    return {
        symbol,
        marketScore: ultra ? 94 : 84,
        confidence: ultra ? 0.95 : 0.86,
        eventPriority: ultra ? 95 : 75,
        triggerState: "Triggered",
        triggerProgressRatio: ultra ? 0.94 : 0.82,
        volumeRatio: ultra ? 1.4 : 1.1,
        resistanceStatus: "Open",
        executionStatus: "Pass",
        conditionalReferencePass: false,
        autoTradeExcludedReason: undefined,
        metrics: {
            rr: ultra ? 1.7 : 1.3,
            rsi1h: 55,
            rsi6h: 56,
            adx1h: 25,
            macd1h: 1,
            macd6h: 1,
        },
        autoTradeTarget: true,
        orderArmEligible: true,
    } as unknown as ContinuousStrategyCandidate;
}

function monitor(selected?: ContinuousStrategyCandidate): ContinuousStrategyMonitor {
    const rows = selected ? [selected] : [];
    return {
        dayKey: "2027-01-15",
        currentBlock: "0:00-6:00",
        monitoredAt: NOW,
        regimeUpdatedAt: NOW,
        candidateUpdatedAt: NOW,
        triggerUpdatedAt: NOW,
        stats: {
            rawUniverseCount: rows.length,
            monitoredUniverseCount: rows.length,
            prefilterPassCount: rows.length,
            scoredCount: rows.length,
            readyCount: 0,
            armedCount: 0,
            triggeredCount: rows.length,
            executedCount: 0,
            cooldownCount: 0,
            selectedCount: rows.length,
            selectionEligibleCount: rows.length,
            conditionalReferencePassCount: 0,
            waitingForSlotCount: 0,
            orderArmedCount: rows.length,
            selectedOrderBlockedCount: 0,
        },
        candidates: rows,
        selected: rows,
        fullSizeTargets: rows,
        halfSizeTargets: [],
        armed: [],
        triggered: rows,
        executed: [],
        cooldown: [],
        watchlist: [],
        blocked: [],
    };
}

function marketBundle(stale = false): LiveStrategyMarketBundle {
    const latest = stale ? NOW - 120_000 : NOW;
    return {
        generatedAt: NOW,
        latestMarketTimestamp: latest,
        exchangeSymbols: ["SUIUSDT", "BONKUSDT", "PENGUUSDT"],
        asterToStrategySymbol: {
            SUIUSDT: "SUI",
            BONKUSDT: "BONK",
            PENGUUSDT: "PENGU.SOL",
        },
        strategyToAsterSymbol: {
            SUI: "SUIUSDT",
            BONK: "BONKUSDT",
            "PENGU.SOL": "PENGUUSDT",
        },
        marketSnapshots: {
            SUI: { price: 10 },
            BONK: { price: 100 },
            "PENGU.SOL": { price: 5 },
        },
        priceHistory: {
            SUI: [{ ts: NOW - 3600_000, price: 9 }, { ts: NOW, price: 10 }],
            BONK: [{ ts: NOW - 3600_000, price: 100 }, { ts: NOW, price: 100 }],
            "PENGU.SOL": [{ ts: NOW - 3600_000, price: 4.5 }, { ts: NOW, price: 5 }],
        },
    };
}

class FakeExecutor implements DirectTradeExecutor {
    cash = 1000;
    positions: DirectPosition[] = [];
    commands: DirectTradeCommand[] = [];
    orders = new Map<string, DirectTradeResult>();
    failNextBuy = false;
    unknownSellOnce = false;
    private unknownSellUsed = false;

    quotes: Record<string, DirectMarketQuote> = {
        SUIUSDT: { symbol: "SUIUSDT", bidPrice: 9.99, askPrice: 10, bidQuantity: 1000, askQuantity: 1000, midPrice: 9.995, spreadBps: 10, updatedAt: NOW },
        BONKUSDT: { symbol: "BONKUSDT", bidPrice: 99.9, askPrice: 100, bidQuantity: 1000, askQuantity: 1000, midPrice: 99.95, spreadBps: 10, updatedAt: NOW },
        PENGUUSDT: { symbol: "PENGUUSDT", bidPrice: 4.99, askPrice: 5, bidQuantity: 1000, askQuantity: 1000, midPrice: 4.995, spreadBps: 20, updatedAt: NOW },
    };

    async getAccountSnapshot(): Promise<DirectAccountSnapshot> {
        return { availableBalance: this.cash, walletBalance: this.cash, asset: "USDT", updatedAt: NOW };
    }

    async getPositions() {
        return structuredClone(this.positions);
    }

    async getOpenOrders(): Promise<DirectOpenOrder[]> {
        return [];
    }

    async getMarketQuote(symbol: string) {
        const quote = this.quotes[symbol];
        if (!quote) throw new Error(`Missing fake quote ${symbol}`);
        return quote;
    }

    async normalizeMarketQuantity(symbol: string, requestedQuantity: number, referencePrice: number): Promise<NormalizedOrderQuantity> {
        const quantity = Math.floor(requestedQuantity * 1000) / 1000;
        if (quantity <= 0 || quantity * referencePrice < 1) throw new Error("Fake min notional.");
        return { symbol, quantity, quantityText: String(quantity), minQuantity: 0.001, maxQuantity: 1_000_000, stepSize: 0.001, minNotional: 1, notional: quantity * referencePrice };
    }

    async executeMarket(command: DirectTradeCommand): Promise<DirectTradeResult> {
        this.commands.push(structuredClone(command));
        if (command.side === "BUY" && this.failNextBuy) {
            this.failNextBuy = false;
            throw new Error("Injected target buy failure");
        }
        const quote = await this.getMarketQuote(command.symbol);
        const fillPrice = command.side === "BUY" ? quote.askPrice : quote.bidPrice;
        const normalized = await this.normalizeMarketQuantity(command.symbol, command.quantity, fillPrice);
        const result: DirectTradeResult = {
            requestId: command.requestId,
            clientOrderId: command.clientOrderId,
            symbol: command.symbol,
            side: command.side,
            status: "FILLED",
            requestedQuantity: command.quantity,
            submittedQuantity: normalized.quantity,
            executedQuantity: normalized.quantity,
            averagePrice: fillPrice,
            quoteQuantity: normalized.quantity * fillPrice,
            executionUnknown: false,
            reconciled: false,
        };
        if (command.side === "SELL" && this.unknownSellOnce && !this.unknownSellUsed) {
            this.unknownSellUsed = true;
            this.orders.set(command.clientOrderId, result);
            return { ...result, status: "UNKNOWN", executedQuantity: 0, quoteQuantity: 0, executionUnknown: true, error: "Injected 503" };
        }
        this.applyFill(result);
        this.orders.set(command.clientOrderId, result);
        return result;
    }

    private applyFill(result: DirectTradeResult) {
        const current = this.positions.find((position) => position.symbol === result.symbol);
        if (result.side === "SELL") {
            if (!current) throw new Error("Fake source position missing.");
            current.quantity -= result.executedQuantity;
            current.notionalUsd = current.quantity * current.markPrice;
            this.cash += result.quoteQuantity;
            this.positions = this.positions.filter((position) => position.quantity > 1e-9);
        } else {
            this.cash -= result.quoteQuantity;
            if (current) {
                const total = current.quantity + result.executedQuantity;
                current.entryPrice = ((current.entryPrice * current.quantity) + result.quoteQuantity) / total;
                current.quantity = total;
                current.markPrice = result.averagePrice;
                current.notionalUsd = total * result.averagePrice;
            } else {
                this.positions.push({
                    symbol: result.symbol,
                    quantity: result.executedQuantity,
                    entryPrice: result.averagePrice,
                    markPrice: result.averagePrice,
                    unrealizedPnl: 0,
                    pnlPct: 0,
                    notionalUsd: result.quoteQuantity,
                    positionSide: "BOTH",
                    leverage: 1,
                    updatedAt: NOW,
                });
            }
        }
    }

    async reconcileOrder(symbol: string, clientOrderId: string): Promise<DirectTradeResult> {
        const result = this.orders.get(clientOrderId);
        if (!result) return { requestId: clientOrderId, clientOrderId, symbol, side: "BUY", status: "UNKNOWN", requestedQuantity: 0, submittedQuantity: 0, executedQuantity: 0, averagePrice: 0, quoteQuantity: 0, executionUnknown: true, reconciled: true };
        if (result.side === "SELL" && !this.positions.some((position) => position.symbol === result.symbol && position.quantity < 10)) {
            this.applyFill(result);
        }
        return { ...result, reconciled: true };
    }
}

function initialState(mode: "paper" | "live" = "paper"): LiveRunnerState {
    return { version: 1, strategyId: "WIN80_ULTRA90_TOP1_V1", mode, updatedAt: NOW, failures: [] };
}

function makeRunner(input: {
    executor: FakeExecutor;
    selected?: ContinuousStrategyCandidate;
    stale?: boolean;
    stateStore?: MemoryLiveRunnerStateStore;
    lock?: MemoryLiveRunnerLock;
    mode?: "paper" | "live";
    liveEnabled?: boolean;
    productionLiveEnabled?: boolean;
}) {
    return new Win80Ultra90LiveRunner({
        executor: input.executor,
        marketData: { load: async () => marketBundle(input.stale) },
        stateStore: input.stateStore || new MemoryLiveRunnerStateStore(initialState(input.mode)),
        lock: input.lock || new MemoryLiveRunnerLock(),
        now: () => NOW,
        selectStrategy: () => monitor(input.selected),
        config: buildDefaultLiveRunnerConfig({
            mode: input.mode || "paper",
            liveExecutionEnabled: input.liveEnabled,
            productionConfigLiveEnabled: input.productionLiveEnabled,
            symbols: ["SUIUSDT", "BONKUSDT", "PENGUUSDT"],
            maxMarketAgeMs: 30_000,
            cashReservePct: 0,
            maxInitialNotionalUsd: 1000,
            minOrderNotionalUsd: 1,
            maxConcurrentPositions: 2,
            maxTransactionRetries: 3,
        }),
    });
}

async function run() {
    {
        const executor = new FakeExecutor();
        const result = await makeRunner({ executor, selected: candidate("SUI") }).tick();
        assert.equal(result.status, "completed");
        assert.equal(executor.commands.length, 1);
        assert.equal(executor.commands[0].side, "BUY");
    }
    {
        const executor = new FakeExecutor();
        executor.positions = [{ symbol: "SUIUSDT", quantity: 10, entryPrice: 10, markPrice: 10, unrealizedPnl: 0, pnlPct: 0, notionalUsd: 100, positionSide: "BOTH", leverage: 1, updatedAt: NOW }];
        const result = await makeRunner({ executor, selected: candidate("SUI") }).tick();
        assert.equal(result.action, "HOLD_SAME");
        assert.equal(executor.commands.length, 0);
    }
    {
        const executor = new FakeExecutor();
        executor.positions = [{ symbol: "BONKUSDT", quantity: 10, entryPrice: 90, markPrice: 100, unrealizedPnl: 100, pnlPct: 11.11, notionalUsd: 1000, positionSide: "BOTH", leverage: 1, updatedAt: NOW }];
        const result = await makeRunner({ executor, selected: candidate("SUI") }).tick();
        assert.equal(result.action, "SPLIT_50");
        assert.equal(executor.commands.length, 2);
        assert.ok(Math.abs(executor.commands[0].quantity - 5) < 1e-9);
    }
    {
        const executor = new FakeExecutor();
        executor.positions = [{ symbol: "BONKUSDT", quantity: 10, entryPrice: 110, markPrice: 100, unrealizedPnl: -100, pnlPct: -9.09, notionalUsd: 1000, positionSide: "BOTH", leverage: 1, updatedAt: NOW }];
        const result = await makeRunner({ executor, selected: candidate("SUI") }).tick();
        assert.equal(result.action, "REJECT");
        assert.equal(executor.commands.length, 0);
    }
    {
        const executor = new FakeExecutor();
        executor.positions = [{ symbol: "BONKUSDT", quantity: 10, entryPrice: 110, markPrice: 100, unrealizedPnl: -100, pnlPct: -9.09, notionalUsd: 1000, positionSide: "BOTH", leverage: 1, updatedAt: NOW }];
        const result = await makeRunner({ executor, selected: candidate("PENGU.SOL", true) }).tick();
        assert.equal(result.action, "SWITCH_70");
        assert.ok(Math.abs(executor.commands[0].quantity - 7) < 1e-9);
    }
    {
        const executor = new FakeExecutor();
        executor.positions = [{ symbol: "BONKUSDT", quantity: 10, entryPrice: 90, markPrice: 100, unrealizedPnl: 100, pnlPct: 11.11, notionalUsd: 1000, positionSide: "BOTH", leverage: 1, updatedAt: NOW }];
        executor.failNextBuy = true;
        const store = new MemoryLiveRunnerStateStore(initialState());
        const runner = makeRunner({ executor, selected: candidate("SUI"), stateStore: store });
        const first = await runner.tick();
        assert.equal(first.status, "failed");
        assert.equal(executor.commands.filter((item) => item.side === "SELL").length, 1);
        const second = await runner.tick();
        assert.equal(second.status, "completed");
        assert.equal(executor.commands.filter((item) => item.side === "SELL").length, 1, "source sell must not repeat");
    }
    {
        const executor = new FakeExecutor();
        executor.positions = [{ symbol: "BONKUSDT", quantity: 10, entryPrice: 90, markPrice: 100, unrealizedPnl: 100, pnlPct: 11.11, notionalUsd: 1000, positionSide: "BOTH", leverage: 1, updatedAt: NOW }];
        executor.unknownSellOnce = true;
        const store = new MemoryLiveRunnerStateStore(initialState());
        const runner = makeRunner({ executor, selected: candidate("SUI"), stateStore: store });
        const first = await runner.tick();
        assert.equal(first.status, "held");
        const second = await runner.tick();
        assert.equal(second.status, "completed");
        assert.equal(executor.commands.filter((item) => item.side === "SELL").length, 1, "unknown sell must be reconciled, not resubmitted");
    }
    {
        const executor = new FakeExecutor();
        const result = await makeRunner({ executor, selected: candidate("SUI"), stale: true }).tick();
        assert.equal(result.status, "failed");
        assert.match(result.message, /Stale/);
    }
    {
        const executor = new FakeExecutor();
        const lock = new MemoryLiveRunnerLock();
        const held = await lock.acquire("external");
        assert.ok(held);
        const result = await makeRunner({ executor, selected: candidate("SUI"), lock }).tick();
        assert.equal(result.status, "locked");
        await held.release();
    }
    {
        const executor = new FakeExecutor();
        await assert.rejects(
            () => makeRunner({ executor, selected: candidate("SUI"), mode: "live", liveEnabled: true, productionLiveEnabled: false }).tick(),
            /Live runner is locked/,
        );
    }
    console.log("WIN80_ULTRA90_LIVE_RUNNER_SELFTEST_OK");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
