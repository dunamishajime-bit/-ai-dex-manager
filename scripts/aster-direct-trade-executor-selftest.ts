import assert from "node:assert/strict";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";

const TEST_PRIVATE_KEY = `0x${"1".repeat(64)}` as `0x${string}`;
const TEST_USER = "0x2222222222222222222222222222222222222222";

function jsonResponse(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
    });
}

const exchangeInfo = {
    symbols: [{
        symbol: "SUIUSDT",
        status: "TRADING",
        quantityPrecision: 3,
        filters: [
            { filterType: "MARKET_LOT_SIZE", minQty: "0.001", maxQty: "10000", stepSize: "0.001" },
            { filterType: "MIN_NOTIONAL", notional: "5" },
        ],
    }],
};

async function normalOrderTest() {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        const method = String(init?.method || "GET");
        const body = typeof init?.body === "string" ? init.body : "";
        requests.push({ url, method, body });
        if (url.includes("/exchangeInfo")) return jsonResponse(exchangeInfo);
        if (url.includes("/ticker/bookTicker")) {
            return jsonResponse({ symbol: "SUIUSDT", bidPrice: "9.99", bidQty: "100", askPrice: "10.00", askQty: "100", time: Date.now() });
        }
        if (url.includes("/order") && method === "POST") {
            return jsonResponse({
                symbol: "SUIUSDT",
                orderId: 123,
                clientOrderId: "w80-test-normal",
                status: "FILLED",
                side: "BUY",
                origQty: "1.234",
                executedQty: "1.234",
                cumQuote: "12.34",
                avgPrice: "10",
            });
        }
        throw new Error(`Unexpected mock request: ${method} ${url}`);
    };
    const client = new AsterV3Client({
        fetchImpl,
        baseUrl: "https://mock.aster",
        userAddress: TEST_USER,
        privateKey: TEST_PRIVATE_KEY,
    });
    const executor = new AsterDirectTradeExecutor(client, { reconciliationDelayMs: 1 });
    const normalized = await executor.normalizeMarketQuantity("SUIUSDT", 1.2349, 10);
    assert.equal(normalized.quantityText, "1.234");
    const result = await executor.executeMarket({
        requestId: "normal",
        clientOrderId: "w80-test-normal",
        symbol: "SUIUSDT",
        side: "BUY",
        quantity: 1.2349,
        expectedPrice: 10,
        maxSlippageBps: 50,
        reason: "selftest",
    });
    assert.equal(result.status, "FILLED");
    assert.equal(result.submittedQuantity, 1.234);
    const post = requests.find((request) => request.method === "POST");
    assert.ok(post);
    const params = new URLSearchParams(post.body);
    assert.equal(params.get("symbol"), "SUIUSDT");
    assert.equal(params.get("newClientOrderId"), "w80-test-normal");
    assert.equal(params.get("user"), TEST_USER);
    assert.ok(params.get("signer")?.startsWith("0x"));
    assert.ok(/^\d{16,}$/.test(params.get("nonce") || ""));
    assert.ok(/^0x[0-9a-f]+$/i.test(params.get("signature") || ""));
}

async function unknownExecutionReconciliationTest() {
    let postCount = 0;
    let queryCount = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        const method = String(init?.method || "GET");
        if (url.includes("/exchangeInfo")) return jsonResponse(exchangeInfo);
        if (url.includes("/ticker/bookTicker")) {
            return jsonResponse({ symbol: "SUIUSDT", bidPrice: "9.99", bidQty: "100", askPrice: "10.00", askQty: "100", time: Date.now() });
        }
        if (url.includes("/order") && method === "POST") {
            postCount += 1;
            return jsonResponse({ code: -1007, msg: "Timeout waiting for response" }, 503);
        }
        if (url.includes("/order") && method === "GET") {
            queryCount += 1;
            const params = new URL(url).searchParams;
            assert.equal(params.get("origClientOrderId"), "w80-test-unknown");
            return jsonResponse({
                symbol: "SUIUSDT",
                orderId: 456,
                clientOrderId: "w80-test-unknown",
                status: "FILLED",
                side: "BUY",
                origQty: "1",
                executedQty: "1",
                cumQuote: "10",
                avgPrice: "10",
            });
        }
        throw new Error(`Unexpected mock request: ${method} ${url}`);
    };
    const client = new AsterV3Client({
        fetchImpl,
        baseUrl: "https://mock.aster",
        userAddress: TEST_USER,
        privateKey: TEST_PRIVATE_KEY,
    });
    const executor = new AsterDirectTradeExecutor(client, {
        reconciliationAttempts: 2,
        reconciliationDelayMs: 1,
    });
    const result = await executor.executeMarket({
        requestId: "unknown",
        clientOrderId: "w80-test-unknown",
        symbol: "SUIUSDT",
        side: "BUY",
        quantity: 1,
        expectedPrice: 10,
        maxSlippageBps: 50,
        reason: "selftest-503",
    });
    assert.equal(result.status, "FILLED");
    assert.equal(result.reconciled, true);
    assert.equal(result.executionUnknown, false);
    assert.equal(postCount, 1, "503 must not cause a blind order resubmit");
    assert.equal(queryCount, 1);
}

async function slippageGuardTest() {
    let postCount = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        const method = String(init?.method || "GET");
        if (url.includes("/exchangeInfo")) return jsonResponse(exchangeInfo);
        if (url.includes("/ticker/bookTicker")) {
            return jsonResponse({ symbol: "SUIUSDT", bidPrice: "9.99", bidQty: "100", askPrice: "10.10", askQty: "100", time: Date.now() });
        }
        if (url.includes("/order") && method === "POST") {
            postCount += 1;
            return jsonResponse({});
        }
        throw new Error(`Unexpected mock request: ${method} ${url}`);
    };
    const client = new AsterV3Client({
        fetchImpl,
        baseUrl: "https://mock.aster",
        userAddress: TEST_USER,
        privateKey: TEST_PRIVATE_KEY,
    });
    const executor = new AsterDirectTradeExecutor(client);
    await assert.rejects(
        () => executor.executeMarket({
            requestId: "slippage",
            clientOrderId: "w80-test-slippage",
            symbol: "SUIUSDT",
            side: "BUY",
            quantity: 1,
            expectedPrice: 10,
            maxSlippageBps: 20,
            reason: "selftest-slippage",
        }),
        /Slippage guard blocked/,
    );
    assert.equal(postCount, 0);
}

await normalOrderTest();
await unknownExecutionReconciliationTest();
await slippageGuardTest();
console.log("ASTER_DIRECT_TRADE_EXECUTOR_SELFTEST_OK");
