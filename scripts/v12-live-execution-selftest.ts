import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DirectPosition, DirectTradeResult } from "@/lib/direct-trade-executor";
import { FileAccountOrderLock } from "@/lib/disdex-account-order-lock";
import { buildSharedCryptoDailyRiskState, writeSharedCryptoDailyRisk } from "@/lib/disdex-shared-crypto-daily-risk";
import type { V12AsterLiveAdapter, V12AsterOrderView } from "@/lib/v12-aster-live-adapter";
import { V12LiveExecutionEngine } from "@/lib/v12-live-execution-engine";
import { planV12TrailingStop, type ResidentOrderView } from "@/lib/v12-resident-stop-lifecycle";
import { buildV12Signal, type V12Bar } from "@/lib/v12-x1-all";
import { FileV12X1AllRunnerStateStore, type V12PendingOrderState, type V12X1AllRunnerState } from "@/lib/v12-x1-all-runner-state";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

const NOW = Date.parse("2026-08-17T12:00:00Z");
const BAR_MS = 2 * 60 * 60_000;

function data(): Record<string, V12Bar[]> {
    const start = NOW - 140 * BAR_MS;
    const result: Record<string, V12Bar[]> = {};
    V12_X1_ALL.universe.forEach((symbol, symbolIndex) => {
        result[symbol] = Array.from({ length: 120 }, (_, index) => {
            const strength = 0.003 + symbolIndex * 0.00002;
            const close = 100 * Math.exp(strength * index);
            return {
                ts: start + index * BAR_MS,
                endTs: start + (index + 1) * BAR_MS,
                open: close * 0.999,
                high: close * 1.004,
                low: close * 0.996,
                close,
                volume: 1000,
                sourceCount: 2 as const,
                closed: true,
            };
        });
    });
    return result;
}

function position(symbol: string, quantity: number, entryPrice = 100): DirectPosition {
    return {
        symbol,
        quantity,
        entryPrice,
        markPrice: entryPrice,
        unrealizedPnl: 0,
        pnlPct: 0,
        notionalUsd: Math.abs(quantity) * entryPrice,
        positionSide: "BOTH",
        leverage: 1,
        updatedAt: NOW,
    };
}

function tradeResult(input: { clientOrderId: string; symbol: string; status?: DirectTradeResult["status"]; executedQuantity?: number; price?: number }): DirectTradeResult {
    const executedQuantity = input.executedQuantity ?? 1;
    const price = input.price ?? 100;
    return {
        requestId: input.clientOrderId,
        clientOrderId: input.clientOrderId,
        symbol: input.symbol,
        side: "BUY",
        status: input.status ?? "FILLED",
        requestedQuantity: executedQuantity,
        submittedQuantity: executedQuantity,
        executedQuantity,
        averagePrice: price,
        quoteQuantity: executedQuantity * price,
        executionUnknown: input.status === "UNKNOWN",
        reconciled: input.status !== "UNKNOWN",
    };
}

type FakeAdapter = V12AsterLiveAdapter & {
    positions: DirectPosition[];
    resident: Map<string, ResidentOrderView>;
    entryCalls: number;
    exitCalls: number;
    stopPlacements: number;
    tpPlacements: number;
    reconcileResult?: DirectTradeResult;
    pendingObservedBeforeSend: boolean;
    stateStore?: FileV12X1AllRunnerStateStore;
};

function fakeAdapter(): FakeAdapter {
    const fake = {
        positions: [] as DirectPosition[],
        resident: new Map<string, ResidentOrderView>(),
        entryCalls: 0,
        exitCalls: 0,
        stopPlacements: 0,
        tpPlacements: 0,
        pendingObservedBeforeSend: false,
        executor: {
            getMarketQuote: async (symbol: string) => ({ symbol, bidPrice: 99.9, askPrice: 100.1, bidQuantity: 100, askQuantity: 100, midPrice: 100, spreadBps: 20, updatedAt: NOW }),
            normalizeMarketQuantity: async (symbol: string, requestedQuantity: number, referencePrice: number) => ({
                symbol,
                quantity: requestedQuantity,
                quantityText: String(requestedQuantity),
                minQuantity: 0.001,
                maxQuantity: 1_000_000,
                stepSize: 0.001,
                minNotional: 0,
                notional: requestedQuantity * referencePrice,
            }),
        },
        credentialsReady: async () => true,
        getAccountSnapshot: async () => ({ availableBalance: 1000, walletBalance: 1000, asset: "USDT", updatedAt: NOW }),
        getPositions: async () => fake.positions,
        getOpenOrders: async () => [],
        listV12Orders: async () => [...fake.resident.values()].filter((row) => row.clientOrderId.startsWith("v12-") && row.status !== "CANCELED").map((row) => ({
            symbol: fake.positions[0]?.symbol || "ETHUSDT",
            clientOrderId: row.clientOrderId,
            status: row.status || "NEW",
            side: row.side,
            type: row.type,
            reduceOnly: row.reduceOnly,
            quantity: Number(row.quantity || 0),
            executedQuantity: 0,
            stopPrice: row.stopPrice,
        })) as V12AsterOrderView[],
        normalizeStopPrice: async (_symbol: string, requested: number) => ({ price: requested, text: String(requested) }),
        openOrders: async (_symbol: string) => [...fake.resident.values()],
        placeStopMarket: async (input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }) => {
            fake.stopPlacements += 1;
            fake.resident.set(input.clientOrderId, { ...input, status: "NEW", type: "STOP_MARKET" });
            return { acknowledged: true };
        },
        placeTakeProfit: async (input: { symbol: string; side: "BUY" | "SELL"; quantity: number; stopPrice: number; clientOrderId: string; reduceOnly: true }) => {
            fake.tpPlacements += 1;
            fake.resident.set(input.clientOrderId, { ...input, status: "NEW", type: "TAKE_PROFIT_MARKET" });
            return { acknowledged: true };
        },
        cancel: async (clientOrderId: string) => {
            const row = fake.resident.get(clientOrderId);
            if (row) fake.resident.set(clientOrderId, { ...row, status: "CANCELED" });
        },
        flattenReduceOnly: async () => { fake.positions = []; },
        queryOrderSameId: async () => null,
        reconcileOrder: async (symbol: string, clientOrderId: string) => fake.reconcileResult ?? tradeResult({ clientOrderId, symbol }),
        executeEntry: async (input: { symbol: string; side: "LONG" | "SHORT"; quantity: number; expectedPrice: number; clientOrderId: string }) => {
            fake.entryCalls += 1;
            if (fake.stateStore) {
                const disk = await fake.stateStore.load();
                fake.pendingObservedBeforeSend = disk.pending?.clientOrderId === input.clientOrderId;
            }
            fake.positions = [...fake.positions, position(input.symbol, input.side === "LONG" ? input.quantity : -input.quantity, input.expectedPrice)];
            return tradeResult({ clientOrderId: input.clientOrderId, symbol: input.symbol, executedQuantity: input.quantity, price: input.expectedPrice });
        },
        executeExit: async (input: { symbol: string; clientOrderId: string; quantity: number }) => {
            fake.exitCalls += 1;
            fake.positions = fake.positions.filter((row) => row.symbol.toUpperCase() !== input.symbol.toUpperCase());
            return tradeResult({ clientOrderId: input.clientOrderId, symbol: input.symbol, executedQuantity: input.quantity });
        },
    } as unknown as FakeAdapter;
    return fake;
}

async function risk(path: string) {
    await writeSharedCryptoDailyRisk(path, buildSharedCryptoDailyRiskState({
        accountScope: "ASTER_FUTURES",
        utcDay: new Date(NOW).toISOString().slice(0, 10),
        strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL"],
        lossPct: 0,
        maximumLossPct: 5,
        tripped: false,
        updatedAt: NOW,
        realizedPnl: 0,
        unrealizedPnl: 0,
        fees: 0,
        funding: 0,
        netDailyPnl: 0,
        referenceEquity: 1000,
        sourceComplete: true,
    }));
}

async function makeHarness(root: string, name: string) {
    const stateStore = new FileV12X1AllRunnerStateStore(join(root, `${name}-state.json`), "LIVE");
    const lock = new FileAccountOrderLock(join(root, `${name}-account.lock`), 120_000);
    const riskPath = join(root, `${name}-risk.json`);
    await risk(riskPath);
    const marketData = data();
    const signal = buildV12Signal(marketData, marketData.BTC.length - 1);
    assert.ok(signal, "synthetic frozen V12 fixture must produce a real V12 signal");
    const adapter = fakeAdapter();
    adapter.stateStore = stateStore;
    const engine = new V12LiveExecutionEngine({ adapter, stateStore, lock, riskPath, marketData: { load: async () => marketData }, now: () => NOW, log: () => undefined });
    return { stateStore, lock, riskPath, marketData, signal, adapter, engine };
}

async function enterHarness(root: string, name: string) {
    const harness = await makeHarness(root, name);
    const result = await harness.engine.tick();
    assert.equal(result.status, "entered");
    const state = await harness.stateStore.load();
    assert.ok(state.active);
    return { ...harness, state };
}

async function main() {
    const root = await mkdtemp(join(tmpdir(), "v12-live-execution-"));
    try {
        // Normal entry: durable pending must exist before the exchange send.
        const normal = await enterHarness(root, "normal");
        assert.equal(normal.adapter.entryCalls, 2);
        assert.equal(normal.adapter.pendingObservedBeforeSend, true, "durable pending must be saved before order send");
        assert.equal(normal.state.pending, undefined);
        assert.ok(normal.state.active?.protection.stopClientOrderId);
        assert.ok(normal.state.active?.protection.takeProfitClientOrderId);

        // Ordinary restart with a live protected V12 position must reconcile and
        // must never submit the entry again.
        const restarted = new V12LiveExecutionEngine({
            adapter: normal.adapter,
            stateStore: normal.stateStore,
            lock: normal.lock,
            riskPath: normal.riskPath,
            marketData: { load: async () => normal.marketData },
            now: () => NOW,
            log: () => undefined,
        });
        const restartResult = await restarted.tick();
        assert.equal(restartResult.status, "held");
        assert.equal(normal.adapter.entryCalls, 2, "restart must not duplicate a completed entry");

        // Crash after exchange send but before local fill-state persistence: the
        // pending record and same clientOrderId recover the fill without resend.
        const crash = await makeHarness(root, "crash-after-send");
        const pendingId = "v12-entry-crash-recovery";
        const pending: V12PendingOrderState = {
            idempotencyKey: pendingId,
            action: "ENTRY",
            clientOrderId: pendingId,
            symbol: `${crash.signal!.symbol}USDT`,
            side: crash.signal!.side,
            quantity: 0.5,
            signalTs: crash.signal!.referenceTs,
            expectedPrice: 100,
            requestedGross: 0.05,
            atrAtEntry: crash.signal!.atr,
            createdAt: NOW,
        };
        const crashState: V12X1AllRunnerState = { schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: NOW, pending };
        await crash.stateStore.save(crashState);
        crash.adapter.positions = [position(pending.symbol, pending.side === "LONG" ? pending.quantity : -pending.quantity, 100)];
        crash.adapter.reconcileResult = tradeResult({ clientOrderId: pendingId, symbol: pending.symbol, executedQuantity: pending.quantity, price: 100 });
        const recovered = await crash.engine.tick();
        assert.equal(recovered.status, "entered");
        assert.equal(crash.adapter.entryCalls, 0, "pending recovery must query the original ID instead of resubmitting");
        assert.equal((await crash.stateStore.load()).pending, undefined);

        // Crash after STOP_UPDATE pending save but before the exchange send: the
        // same deterministic replacement ID is submitted exactly once on restart.
        const stopBeforeSend = await enterHarness(root, "stop-before-send");
        const stopState = (await stopBeforeSend.stateStore.load()).active!;
        const plannedBeforeSend = await planV12TrailingStop(stopBeforeSend.adapter, stopState.protection, stopState.entryPrice + stopState.atrAtEntry * 8);
        assert.ok(plannedBeforeSend.plan, "fixture must request a trailing STOP replacement");
        const planBeforeSend = plannedBeforeSend.plan!;
        const pendingStopBeforeSend: V12PendingOrderState = {
            idempotencyKey: planBeforeSend.clientOrderId,
            action: "STOP_UPDATE",
            clientOrderId: planBeforeSend.clientOrderId,
            symbol: stopState.symbol,
            side: stopState.side,
            quantity: stopState.quantity,
            signalTs: stopBeforeSend.marketData.BTC.at(-1)!.endTs,
            reason: "TRAILING_STOP_UPDATE",
            createdAt: NOW,
            positionId: stopState.positionId,
            stopPrice: planBeforeSend.stopPrice,
            previousStopClientOrderId: planBeforeSend.previousStopClientOrderId,
            nextPeakOrTrough: planBeforeSend.nextPeakOrTrough,
        };
        await stopBeforeSend.stateStore.save({ ...await stopBeforeSend.stateStore.load(), active: { ...stopState, protection: plannedBeforeSend.state }, pending: pendingStopBeforeSend });
        const beforeSendPlacements = stopBeforeSend.adapter.stopPlacements;
        const recoveredBeforeSend = await stopBeforeSend.engine.tick();
        assert.equal(recoveredBeforeSend.status, "held");
        assert.equal(stopBeforeSend.adapter.stopPlacements, beforeSendPlacements + 1, "pending STOP_UPDATE must submit its deterministic replacement once");
        const afterStopBeforeSend = await stopBeforeSend.stateStore.load();
        assert.equal(afterStopBeforeSend.pending, undefined);
        assert.equal(afterStopBeforeSend.active?.protection.stopClientOrderId, planBeforeSend.clientOrderId);
        assert.equal(stopBeforeSend.adapter.resident.get(planBeforeSend.previousStopClientOrderId!)?.status, "CANCELED");

        // Crash after Aster accepted the replacement STOP but before local state
        // save: restart must discover/reuse it and must not submit a duplicate.
        const stopAfterSend = await enterHarness(root, "stop-after-send");
        const stopAfterState = (await stopAfterSend.stateStore.load()).active!;
        const plannedAfterSend = await planV12TrailingStop(stopAfterSend.adapter, stopAfterState.protection, stopAfterState.entryPrice + stopAfterState.atrAtEntry * 9);
        assert.ok(plannedAfterSend.plan);
        const planAfterSend = plannedAfterSend.plan!;
        const pendingStopAfterSend: V12PendingOrderState = {
            idempotencyKey: planAfterSend.clientOrderId,
            action: "STOP_UPDATE",
            clientOrderId: planAfterSend.clientOrderId,
            symbol: stopAfterState.symbol,
            side: stopAfterState.side,
            quantity: stopAfterState.quantity,
            signalTs: stopAfterSend.marketData.BTC.at(-1)!.endTs,
            reason: "TRAILING_STOP_UPDATE",
            createdAt: NOW,
            positionId: stopAfterState.positionId,
            stopPrice: planAfterSend.stopPrice,
            previousStopClientOrderId: planAfterSend.previousStopClientOrderId,
            nextPeakOrTrough: planAfterSend.nextPeakOrTrough,
        };
        await stopAfterSend.stateStore.save({ ...await stopAfterSend.stateStore.load(), active: { ...stopAfterState, protection: plannedAfterSend.state }, pending: pendingStopAfterSend });
        stopAfterSend.adapter.resident.set(planAfterSend.clientOrderId, {
            clientOrderId: planAfterSend.clientOrderId,
            status: "NEW",
            side: stopAfterState.side === "LONG" ? "SELL" : "BUY",
            type: "STOP_MARKET",
            reduceOnly: true,
            quantity: stopAfterState.quantity,
            stopPrice: planAfterSend.stopPrice,
        });
        const afterSendPlacements = stopAfterSend.adapter.stopPlacements;
        const recoveredAfterSend = await stopAfterSend.engine.tick();
        assert.equal(recoveredAfterSend.status, "held");
        assert.equal(stopAfterSend.adapter.stopPlacements, afterSendPlacements, "accepted deterministic replacement STOP must not be resubmitted after crash");
        const afterStopAfterSend = await stopAfterSend.stateStore.load();
        assert.equal(afterStopAfterSend.pending, undefined);
        assert.equal(afterStopAfterSend.active?.protection.stopClientOrderId, planAfterSend.clientOrderId);
        assert.equal(stopAfterSend.adapter.resident.get(planAfterSend.previousStopClientOrderId!)?.status, "CANCELED");

        // UNKNOWN is never retried with another ID; it becomes sticky manual review.
        const unknown = await makeHarness(root, "unknown");
        await unknown.stateStore.save({ ...crashState, pending: { ...pending, clientOrderId: "v12-entry-unknown", idempotencyKey: "v12-entry-unknown" } });
        unknown.adapter.reconcileResult = tradeResult({ clientOrderId: "v12-entry-unknown", symbol: pending.symbol, status: "UNKNOWN", executedQuantity: 0 });
        const unknownResult = await unknown.engine.tick();
        assert.equal(unknownResult.status, "manual-review");
        assert.equal(unknown.adapter.entryCalls, 0);
        assert.match((await unknown.stateStore.load()).manualReview || "", /V12_PENDING_ENTRY_UNKNOWN/);

        // Position-only mismatch must never be auto-adopted or auto-closed.
        const mismatch = await makeHarness(root, "position-only");
        mismatch.adapter.positions = [position(`${mismatch.signal!.symbol}USDT`, 0.25, 100)];
        const mismatchResult = await mismatch.engine.tick();
        assert.equal(mismatchResult.status, "manual-review");
        assert.equal(mismatch.adapter.entryCalls, 0);
        assert.equal(mismatch.adapter.exitCalls, 0);
        assert.match((await mismatch.stateStore.load()).manualReview || "", /V12_POSITION_ONLY_MISMATCH/);

        console.log("V12_LIVE_EXECUTION_SELFTEST_PASS", JSON.stringify({ ordersSent: 0, realExchangeCalls: 0 }));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
