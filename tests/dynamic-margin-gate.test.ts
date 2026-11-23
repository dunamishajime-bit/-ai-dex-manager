import assert from "node:assert/strict";
import { test } from "node:test";

import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";

const PRIVATE_KEY = `0x${"1".repeat(64)}` as `0x${string}`;
const USER = "0x2222222222222222222222222222222222222222";

function response(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function exchangeInfo(symbol: string) {
    return {
        symbols: [{
            symbol,
            status: "TRADING",
            quantityPrecision: 3,
            filters: [
                { filterType: "MARKET_LOT_SIZE", minQty: "0.001", maxQty: "1000000", stepSize: "0.001" },
                { filterType: "MIN_NOTIONAL", notional: "5" },
            ],
        }],
    };
}

function makeClient(input: {
    symbol: string;
    leverage?: string;
    marginType?: string;
    includeMarginRow?: boolean;
    positionAmt?: string;
    openOrders?: boolean;
    failMarginTypeMutation?: boolean;
    failLeverageMutation?: boolean;
    failReadbackAfterMutation?: boolean;
    readbackLeverage?: string;
    readbackMarginType?: string;
    orders: Array<{ method: string; path: string; body: string }>;
    mutations: Array<{ path: string; body: string }>;
}) {
    let leverage = input.leverage;
    let marginType = input.marginType;
    let mutationCount = 0;
    const fetchImpl: typeof fetch = async (request, init) => {
        const url = String(request);
        const method = String(init?.method || "GET");
        const body = typeof init?.body === "string" ? init.body : "";
        const path = new URL(url).pathname;
        input.orders.push({ method, path, body });
        if (method === "POST" && (path === "/fapi/v3/marginType" || path === "/fapi/v3/leverage")) {
            input.mutations.push({ path, body });
            mutationCount += 1;
            if (path === "/fapi/v3/marginType") {
                if (input.failMarginTypeMutation) return response({ code: -4000, msg: "margin mutation failed" }, 400);
                marginType = "cross";
            } else {
                if (input.failLeverageMutation) return response({ code: -4000, msg: "leverage mutation failed" }, 400);
                leverage = "5";
            }
            return response({ symbol: input.symbol, status: "OK" });
        }
        if (path === "/fapi/v3/exchangeInfo") return response(exchangeInfo(input.symbol));
        if (path === "/fapi/v3/ticker/bookTicker") {
            return response({ symbol: input.symbol, bidPrice: "99", bidQty: "1000", askPrice: "101", askQty: "1000", time: Date.now() });
        }
        if (path === "/fapi/v3/positionRisk") {
            if (!input.includeMarginRow) return response([]);
            if (input.failReadbackAfterMutation && mutationCount > 0) throw new Error("position-risk read-back failed");
            return response([{
                symbol: input.symbol,
                positionAmt: input.positionAmt || "0",
                entryPrice: "0",
                markPrice: "100",
                liquidationPrice: "0",
                leverage: mutationCount > 0 && input.readbackLeverage !== undefined ? input.readbackLeverage : leverage,
                marginType: mutationCount > 0 && input.readbackMarginType !== undefined ? input.readbackMarginType : marginType,
            }]);
        }
        if (path === "/fapi/v3/openOrders") return response(input.openOrders ? [{ symbol: input.symbol, status: "NEW" }] : []);
        if (path === "/fapi/v3/order" && method === "POST") {
            return response({
                symbol: input.symbol,
                orderId: 123,
                clientOrderId: "test-order",
                status: "FILLED",
                side: "BUY",
                origQty: "1",
                executedQty: "1",
                cumQuote: "101",
                avgPrice: "101",
            });
        }
        throw new Error(`Unexpected mock request: ${method} ${path}`);
    };
    return new AsterV3Client({
        fetchImpl,
        baseUrl: "https://mock.aster",
        userAddress: USER,
        privateKey: PRIVATE_KEY,
    });
}

async function entry(input: {
    symbol: string;
    leverage?: string;
    marginType?: string;
    includeMarginRow?: boolean;
    positionAmt?: string;
    openOrders?: boolean;
    failMarginTypeMutation?: boolean;
    failLeverageMutation?: boolean;
    failReadbackAfterMutation?: boolean;
    readbackLeverage?: string;
    readbackMarginType?: string;
    reason: string;
}) {
    const orders: Array<{ method: string; path: string; body: string }> = [];
    const mutations: Array<{ path: string; body: string }> = [];
    const client = makeClient({ ...input, orders, mutations });
    const executor = new AsterDirectTradeExecutor(client, { reconciliationDelayMs: 1 });
    try {
        const result = await executor.executeMarket({
            requestId: `${input.reason}-request`,
            clientOrderId: `${input.reason}-order`,
            symbol: input.symbol,
            side: "BUY",
            quantity: 1,
            expectedPrice: 101,
            maxSlippageBps: 100,
            reason: input.reason,
            requireVenueMargin5xCross: true,
        });
        return { result, orders, mutations };
    } catch (error) {
        return { error, orders, mutations };
    }
}

test("V12 dynamic DOGE entry sends zero orders unless venue is confirmed 5x Cross", async () => {
    const blocked = await entry({ symbol: "DOGEUSDT", reason: "V12_X1.00_ALL_ENTRY" });
    assert.match(String(blocked.error), /ASTER_VENUE_MARGIN_UNCONFIRMED:DOGEUSDT/);
    assert.equal(blocked.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 0);
});

test("Q102 dynamic AVAX entry sends zero orders unless venue is confirmed 5x Cross", async () => {
    const blocked = await entry({ symbol: "AVAXUSDT", reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    assert.match(String(blocked.error), /ASTER_VENUE_MARGIN_UNCONFIRMED:AVAXUSDT/);
    assert.equal(blocked.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 0);
});

test("dynamic entries prepare mismatched leverage or isolated margin before exposure", async () => {
    const wrongLeverage = await entry({ symbol: "LINKUSDT", leverage: "1", marginType: "cross", includeMarginRow: true, reason: "V12_X1.00_ALL_ENTRY" });
    const isolated = await entry({ symbol: "AAVEUSDT", leverage: "5", marginType: "isolated", includeMarginRow: true, reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    assert.equal(wrongLeverage.error, undefined);
    assert.equal(isolated.error, undefined);
    assert.deepEqual(wrongLeverage.mutations.map((row) => row.path), ["/fapi/v3/leverage"]);
    assert.deepEqual(isolated.mutations.map((row) => row.path), ["/fapi/v3/marginType"]);
    assert.equal(wrongLeverage.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 1);
    assert.equal(isolated.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 1);
});

test("1x Cross is mutated to 5x before a V12 entry", async () => {
    const prepared = await entry({ symbol: "DOGEUSDT", leverage: "1", marginType: "cross", includeMarginRow: true, reason: "V12_X1.00_ALL_ENTRY" });
    assert.equal(prepared.error, undefined);
    assert.deepEqual(prepared.mutations.map((row) => row.path), ["/fapi/v3/leverage"]);
    assert.match(prepared.mutations[0]?.body || "", /leverage=5/);
    assert.equal(prepared.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 1);
});

test("5x Isolated is changed to Cross before a Q102 entry", async () => {
    const prepared = await entry({ symbol: "AVAXUSDT", leverage: "5", marginType: "isolated", includeMarginRow: true, reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    assert.equal(prepared.error, undefined);
    assert.deepEqual(prepared.mutations.map((row) => row.path), ["/fapi/v3/marginType"]);
    assert.match(prepared.mutations[0]?.body || "", /marginType=CROSSED/);
    assert.equal(prepared.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 1);
});

test("1x Isolated requires both venue mutations and a successful 5x Cross read-back", async () => {
    const prepared = await entry({ symbol: "LINKUSDT", leverage: "1", marginType: "isolated", includeMarginRow: true, reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    assert.equal(prepared.error, undefined);
    assert.deepEqual(prepared.mutations.map((row) => row.path), ["/fapi/v3/marginType", "/fapi/v3/leverage"]);
    assert.equal(prepared.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 1);
});

test("venue mutation failures and read-back failure send zero exposure orders", async () => {
    const leverageFailure = await entry({ symbol: "DOGEUSDT", leverage: "1", marginType: "cross", includeMarginRow: true, failLeverageMutation: true, reason: "V12_X1.00_ALL_ENTRY" });
    const marginFailure = await entry({ symbol: "AVAXUSDT", leverage: "5", marginType: "isolated", includeMarginRow: true, failMarginTypeMutation: true, reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    const readbackFailure = await entry({ symbol: "LINKUSDT", leverage: "1", marginType: "cross", includeMarginRow: true, failReadbackAfterMutation: true, reason: "V12_X1.00_ALL_ENTRY" });
    const readbackMismatch = await entry({ symbol: "AAVEUSDT", leverage: "1", marginType: "isolated", includeMarginRow: true, readbackLeverage: "4", readbackMarginType: "isolated", reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    for (const blocked of [leverageFailure, marginFailure, readbackFailure, readbackMismatch]) {
        assert.ok(blocked.error);
        assert.equal(blocked.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 0);
    }
    assert.deepEqual(readbackMismatch.mutations.map((row) => row.path), ["/fapi/v3/marginType", "/fapi/v3/leverage"]);
});

test("non-flat positions or unresolved open orders prohibit venue mutation and new exposure", async () => {
    const nonFlat = await entry({ symbol: "DOGEUSDT", leverage: "1", marginType: "cross", includeMarginRow: true, positionAmt: "10", reason: "V12_X1.00_ALL_ENTRY" });
    const openOrder = await entry({ symbol: "AVAXUSDT", leverage: "1", marginType: "cross", includeMarginRow: true, openOrders: true, reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    for (const blocked of [nonFlat, openOrder]) {
        assert.ok(blocked.error);
        assert.equal(blocked.mutations.length, 0);
        assert.equal(blocked.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 0);
    }
});

test("already 5x Cross skips mutation and proceeds to entry", async () => {
    const ready = await entry({ symbol: "AAVEUSDT", leverage: "5", marginType: "cross", includeMarginRow: true, reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    assert.equal(ready.error, undefined);
    assert.equal(ready.mutations.length, 0);
    assert.equal(ready.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 1);
});

test("V12/Q102 entry proceeds only after exact 5x Cross read-back", async () => {
    const v12 = await entry({ symbol: "DOGEUSDT", leverage: "5", marginType: "cross", includeMarginRow: true, reason: "V12_X1.00_ALL_ENTRY" });
    const q102 = await entry({ symbol: "AVAXUSDT", leverage: "5", marginType: "cross", includeMarginRow: true, reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    assert.equal(v12.result?.status, "FILLED");
    assert.equal(q102.result?.status, "FILLED");
    assert.equal(v12.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 1);
    assert.equal(q102.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 1);
});

test("V12 adapter marks a dynamic entry as venue-margin protected", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile("lib/v12-aster-live-adapter.ts", "utf8"));
    assert.match(source, /requireVenueMargin5xCross:\s*true/);
});

test("Q102 runner marks a dynamic entry as venue-margin protected", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile("lib/disdex-quality102-causal-v1-runner.ts", "utf8"));
    assert.match(source, /requireVenueMargin5xCross:\s*!pending\.reduceOnly/);
});

test("venue preparation precedes fresh Margin Guard for protected exposure", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile("lib/direct-trade-executor.ts", "utf8"));
    const executeBlock = source.slice(source.indexOf("async executeMarket(command: DirectTradeCommand)"));
    assert.ok(executeBlock.indexOf("ensureVenueMargin5xCross(symbol)") < executeBlock.indexOf("runFreshMarginGuardBeforeExposureOrder(symbol)"));
});

test("strategy Gross contracts remain separate from venue leverage 5x", async () => {
    const { V12_X1_ALL } = await import("../config/v12X1AllRuntime");
    const { QUALITY102_CAUSAL_V1 } = await import("../config/disdexQuality102CausalV1Runtime");
    assert.equal(V12_X1_ALL.leverage, 1);
    assert.equal(V12_X1_ALL.perPositionEntryGrossCap, 1);
    assert.equal(V12_X1_ALL.aggregateEntryGrossCap, 2);
    assert.equal(V12_X1_ALL.dynamicResidualAggregateGrossCap, 2);
    assert.equal(QUALITY102_CAUSAL_V1.maximumGross, 3);
    assert.equal(QUALITY102_CAUSAL_V1.cryptoGrossCap, 3);
    assert.equal(QUALITY102_CAUSAL_V1.totalGrossCap, 4.25);
});
