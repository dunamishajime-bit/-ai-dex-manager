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
    orders: Array<{ method: string; path: string; body: string }>;
}) {
    const fetchImpl: typeof fetch = async (request, init) => {
        const url = String(request);
        const method = String(init?.method || "GET");
        const body = typeof init?.body === "string" ? init.body : "";
        const path = new URL(url).pathname;
        input.orders.push({ method, path, body });
        if (path === "/fapi/v3/exchangeInfo") return response(exchangeInfo(input.symbol));
        if (path === "/fapi/v3/ticker/bookTicker") {
            return response({ symbol: input.symbol, bidPrice: "99", bidQty: "1000", askPrice: "101", askQty: "1000", time: Date.now() });
        }
        if (path === "/fapi/v3/positionRisk") {
            if (!input.includeMarginRow) return response([]);
            return response([{
                symbol: input.symbol,
                positionAmt: "0",
                entryPrice: "0",
                markPrice: "100",
                liquidationPrice: "0",
                leverage: input.leverage,
                marginType: input.marginType,
            }]);
        }
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
    reason: string;
}) {
    const orders: Array<{ method: string; path: string; body: string }> = [];
    const client = makeClient({ ...input, orders });
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
        return { result, orders };
    } catch (error) {
        return { error, orders };
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

test("dynamic entries fail closed for mismatched leverage or isolated margin", async () => {
    const wrongLeverage = await entry({ symbol: "LINKUSDT", leverage: "1", marginType: "cross", includeMarginRow: true, reason: "V12_X1.00_ALL_ENTRY" });
    const isolated = await entry({ symbol: "AAVEUSDT", leverage: "5", marginType: "isolated", includeMarginRow: true, reason: "QUALITY102_CAUSAL_V1_ENTRY" });
    assert.match(String(wrongLeverage.error), /expected=5x-cross:actual=1x-cross/);
    assert.match(String(isolated.error), /expected=5x-cross:actual=5x-isolated/);
    assert.equal(wrongLeverage.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 0);
    assert.equal(isolated.orders.filter((row) => row.path === "/fapi/v3/order" && row.method === "POST").length, 0);
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

test("strategy Gross contracts remain unchanged while venue leverage is 5x", async () => {
    const { V12_X1_ALL } = await import("../config/v12X1AllRuntime");
    const { QUALITY102_CAUSAL_V1 } = await import("../config/disdexQuality102CausalV1Runtime");
    assert.equal(V12_X1_ALL.leverage, 1);
    assert.equal(V12_X1_ALL.perPositionEntryGrossCap, 1);
    assert.equal(V12_X1_ALL.aggregateEntryGrossCap, 1.5);
    assert.equal(QUALITY102_CAUSAL_V1.maximumGross, 1);
    assert.equal(QUALITY102_CAUSAL_V1.cryptoGrossCap, 2);
    assert.equal(QUALITY102_CAUSAL_V1.totalGrossCap, 2.5);
});
