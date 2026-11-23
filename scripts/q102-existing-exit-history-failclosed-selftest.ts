import assert from "node:assert/strict";
import { Quality102CausalV1Runner, type Quality102CausalV1RunnerConfig } from "../lib/disdex-quality102-causal-v1-runner";
import { createQuality102CausalV1State, MemoryQuality102CausalV1StateStore } from "../lib/disdex-quality102-causal-v1-state";
import { MemoryLiveRunnerLock } from "../lib/live-runner-state";
import { QUALITY102_CAUSAL_V1 } from "../config/disdexQuality102CausalV1Runtime";
import type { DirectTradeCommand, DirectTradeExecutor, DirectPosition, DirectTradeResult } from "../lib/direct-trade-executor";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// All orders below are synthetic memory-only responses; no venue SDK is used.
const NOW = Date.UTC(2026, 8, 4, 12);
const SHA = "1".repeat(40);

function config(): Quality102CausalV1RunnerConfig {
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
        maximumDailyLossPct: 7.5,
    };
}

class FakeExecutor implements DirectTradeExecutor {
    calls = 0;
    lastCommand?: DirectTradeCommand;
    positions: DirectPosition[] = [];
    async getAccountSnapshot() {
        return { availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: NOW - 1000 };
    }
    async getPositions() { return this.positions; }
    async getOpenOrders() { return []; }
    async getMarketQuote(symbol: string) {
        return { symbol, bidPrice: 79.9, askPrice: 80.1, bidQuantity: 200, askQuantity: 200, midPrice: 80,
            spreadBps: 25, updatedAt: NOW - 1000 };
    }
    async normalizeMarketQuantity(symbol: string, quantity: number, price: number) {
        return { symbol, quantity, quantityText: String(quantity), minQuantity: 0, maxQuantity: 1000,
            stepSize: 0.001, minNotional: 5, notional: quantity * price };
    }
    async executeMarket(command: DirectTradeCommand): Promise<DirectTradeResult> {
        this.calls += 1; this.lastCommand = command;
        this.positions = [];
        return { requestId: command.requestId, clientOrderId: command.clientOrderId, symbol: command.symbol,
            side: command.side, status: "FILLED", requestedQuantity: command.quantity,
            submittedQuantity: command.quantity, executedQuantity: command.quantity,
            averagePrice: command.expectedPrice, quoteQuantity: command.quantity * command.expectedPrice,
            executionUnknown: false, reconciled: true };
    }
    async reconcileOrder() { throw Error("NO_RECONCILIATION_EXPECTED"); }
}

function makeRunner(fake: FakeExecutor, openPosition: boolean) {
    const initial = createQuality102CausalV1State("LIVE", SHA);
    initial.initialDaemonReconciliation = { runtimeCommitSha: SHA, completedAt: NOW - 1000 };
    if (openPosition) {
        initial.position = {
            symbol: "FETUSDT", side: 1, quantity: 1, entryPrice: 100,
            entryTs: NOW - 3_600_000, hardStop: 0.1,
            bestPrice: 100, trailActive: false, family: "HIGH_VOL",
            exitPolicy: "FIXED_HOLD_STOP", maxHoldHours: 72,
        };
        fake.positions = [{ symbol: "FETUSDT", quantity: 1, entryPrice: 100, markPrice: 80,
            unrealizedPnl: -20, pnlPct: -0.20, notionalUsd: 80,
            positionSide: "LONG", leverage: 1, updatedAt: NOW - 1000 }];
    }
    return new Quality102CausalV1Runner({
        marketData: { load: async () => { throw new Error("SYNTHETIC_H1_FEED_UNAVAILABLE"); } },
        executor: fake,
        stateStore: new MemoryQuality102CausalV1StateStore(initial, "LIVE", SHA),
        lock: new MemoryLiveRunnerLock(),
        config: config(),
        now: () => NOW,
        riskReader: async () => undefined,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
}

async function main() {
    const openFake = new FakeExecutor();
    const active = makeRunner(openFake, true);
    const exit = await active.tick();
    assert.equal(exit.status, "completed", JSON.stringify(exit));
    assert.equal(openFake.calls, 1, "Existing hard-stop exit must remain reachable with missing H1 history");
    assert.equal(openFake.lastCommand?.reduceOnly, true, "No exposure-increasing order allowed");
    assert.equal(openFake.lastCommand?.side, "SELL");

    const flatFake = new FakeExecutor();
    const flat = makeRunner(flatFake, false);
    const blocked = await flat.tick();
    assert.equal(blocked.status, "blocked-local", JSON.stringify(blocked));
    assert.equal(flatFake.calls, 0, "Missing H1 history must prohibit new entries");

    const code = readFileSync(resolve("lib/disdex-quality102-causal-v1-runner.ts"), "utf-8");
    assert.match(code, /const stopResult = await this\.reconcileStopFill\(state\)/);
    assert.match(code, /if \(!state\.position\) throw error/);
    assert.match(code, /const adoptedReason = history/);
    console.log("Q102_HISTORY_FAILURE_EXISTING_REDUCE_ONLY_EXIT_PASS");
    console.log("Q102_HISTORY_FAILURE_FLAT_ENTRY_FAIL_CLOSED_PASS");
    console.log("liveOrdersSent=0 cancelsSent=0 positionsChanged=0");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
