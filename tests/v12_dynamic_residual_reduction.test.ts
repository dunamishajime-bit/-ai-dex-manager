import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { V12AsterLiveAdapter } from "@/lib/v12-aster-live-adapter";
import { reduceV12DynamicResidualForCoreConflict } from "@/lib/v12-dynamic-residual-live-reduction";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "@/lib/v12-x1-all-runner-state";

test("dynamic trim preserves Base and resizes protection to venue quantity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "v12-dynamic-trim-"));
    try {
        const statePath = join(dir, "runner.json");
        const store = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
        const now = Date.now();
        const positionId = "position-eth";
        const initial: V12X1AllRunnerState = {
            schema: "v12-x1-all-runner-state/v2",
            strategyId: "V12_X1.00_ALL",
            mode: "LIVE",
            updatedAt: now,
            active: {
                symbol: "ETHUSDT",
                side: "LONG",
                quantity: 1,
                gross: 1,
                baseQuantity: 0.6,
                baseGross: 0.6,
                dynamicQuantity: 0.4,
                dynamicGross: 0.4,
                positionId,
                entryPrice: 100,
                atrAtEntry: 2,
                entrySignalTs: now - 60_000,
                holdingBars: 2,
                peakPrice: 103,
                troughPrice: 98,
                protection: {
                    strategyId: "V12_X1.00_ALL",
                    symbol: "ETHUSDT",
                    side: "LONG",
                    positionId,
                    quantity: 1,
                    entryPrice: 100,
                    atrAtEntry: 2,
                    initialStop: 95,
                    lastAckStop: 96,
                    takeProfit: 110,
                    peakOrTrough: 103,
                    stopClientOrderId: "old-stop",
                    takeProfitClientOrderId: "old-tp",
                },
            },
        };
        initial.activePositions = [initial.active!];
        await store.save(initial);

        let venueQuantity = 1;
        const orders: Array<Record<string, unknown>> = [
            { symbol: "ETHUSDT", clientOrderId: "old-stop", status: "NEW", side: "SELL", type: "STOP_MARKET", reduceOnly: true, quantity: 1, executedQuantity: 0, stopPrice: 96 },
            { symbol: "ETHUSDT", clientOrderId: "old-tp", status: "NEW", side: "SELL", type: "TAKE_PROFIT_MARKET", reduceOnly: true, quantity: 1, executedQuantity: 0, stopPrice: 110 },
        ];
        const fake = {
            executor: {
                getMarketQuote: async () => ({
                    symbol: "ETHUSDT",
                    bidPrice: 99,
                    askPrice: 101,
                    bidQuantity: 10,
                    askQuantity: 10,
                    midPrice: 100,
                    spreadBps: 200,
                    updatedAt: now,
                }),
                normalizeMarketQuantity: async (symbol: string, quantity: number, price: number) => ({
                    symbol,
                    quantity,
                    quantityText: quantity.toString(),
                    minQuantity: 0.001,
                    maxQuantity: 1000,
                    stepSize: 0.001,
                    minNotional: 5,
                    notional: quantity * price,
                }),
            },
            executeDynamicTrim: async (input: { quantity: number; clientOrderId: string }) => {
                venueQuantity -= input.quantity;
                return {
                    requestId: input.clientOrderId,
                    clientOrderId: input.clientOrderId,
                    symbol: "ETHUSDT",
                    side: "SELL",
                    status: "FILLED",
                    requestedQuantity: input.quantity,
                    submittedQuantity: input.quantity,
                    executedQuantity: input.quantity,
                    averagePrice: 99,
                    quoteQuantity: input.quantity * 99,
                    reduceOnly: true,
                    executionUnknown: false,
                    reconciled: true,
                };
            },
            getPositions: async () => [{
                symbol: "ETHUSDT",
                quantity: venueQuantity,
                entryPrice: 100,
                markPrice: 100,
                unrealizedPnl: 0,
                pnlPct: 0,
                notionalUsd: venueQuantity * 100,
                positionSide: "LONG",
                leverage: 5,
                updatedAt: now,
            }],
            placeStopMarket: async (input: Record<string, unknown>) => {
                orders.push({ ...input, status: "NEW", type: "STOP_MARKET", executedQuantity: 0 });
                return { acknowledged: true };
            },
            placeTakeProfit: async (input: Record<string, unknown>) => {
                orders.push({ ...input, status: "NEW", type: "TAKE_PROFIT_MARKET", executedQuantity: 0 });
                return { acknowledged: true };
            },
            cancel: async (clientOrderId: string) => {
                const index = orders.findIndex((order) => order.clientOrderId === clientOrderId);
                if (index >= 0) orders.splice(index, 1);
            },
            openOrders: async () => orders,
            flattenReduceOnly: async () => undefined,
            normalizeStopPrice: async (_symbol: string, requested: number) => ({ price: requested }),
        } as unknown as V12AsterLiveAdapter;

        const result = await reduceV12DynamicResidualForCoreConflict({
            adapter: fake,
            requiredGross: 0.2,
            equity: 100,
            causeIdempotencyKey: "test-core-entry",
            statePath,
            now: () => now,
        });
        assert.equal(result.status, "reduced");
        assert.ok(Math.abs(result.trimmedGross - 0.2) < 1e-9);

        const after = await store.load();
        const active = after.activePositions?.[0];
        assert.ok(active);
        assert.ok(Math.abs(active.quantity - 0.8) < 1e-9);
        assert.ok(Math.abs(active.baseQuantity - 0.6) < 1e-9);
        assert.ok(Math.abs(active.baseGross - 0.6) < 1e-9);
        assert.ok(Math.abs(active.dynamicQuantity - 0.2) < 1e-9);
        assert.ok(Math.abs(active.dynamicGross - 0.2) < 1e-9);
        assert.ok(Math.abs(active.protection.quantity - 0.8) < 1e-9);
        assert.equal(after.pending, undefined);
        assert.ok(after.latestTrimOrderId);
        assert.equal(after.lastTrimReason, "test-core-entry");
        assert.equal(after.trimCount, 1);
        assert.equal(after.reconciliationStatus, "PASS");
        assert.equal(orders.some((order) => order.clientOrderId === "old-stop"), false);
        assert.equal(orders.some((order) => order.clientOrderId === "old-tp"), false);
        assert.equal(orders.filter((order) => order.type === "STOP_MARKET").length, 1);
        assert.equal(orders.filter((order) => order.type === "TAKE_PROFIT_MARKET").length, 1);
        assert.ok(orders.every((order) => Math.abs(Number(order.quantity) - 0.8) < 1e-9));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
