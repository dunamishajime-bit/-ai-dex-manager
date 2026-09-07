import assert from "node:assert/strict";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterRealtimeMarketDataProvider } from "../lib/aster-realtime-market-data-provider";
import { V12AsterMarketDataProvider } from "../lib/v12-aster-market-data-provider";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";

function jsonResponse(payload: unknown) {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

function mockClient(bookTimestamp: number) {
    const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("/exchangeInfo")) {
            return jsonResponse({
                symbols: [{ symbol: "BNBUSDT", status: "TRADING" }],
            });
        }
        if (url.includes("/ticker/price")) {
            return jsonResponse([{ symbol: "BNBUSDT", price: "10.00", time: bookTimestamp - 500 }]);
        }
        if (url.includes("/ticker/bookTicker")) {
            return jsonResponse([{
                symbol: "BNBUSDT",
                bidPrice: "9.99",
                bidQty: "100",
                askPrice: "10.01",
                askQty: "120",
                time: bookTimestamp,
            }]);
        }
        if (url.includes("/ticker/24hr")) {
            return jsonResponse([{
                symbol: "BNBUSDT",
                lastPrice: "10.00",
                priceChangePercent: "2.5",
                quoteVolume: "2400000",
                count: 240,
                closeTime: Date.now(),
            }]);
        }
        if (url.includes("/klines")) {
            return jsonResponse([
                [bookTimestamp - 7_200_000, "9", "9.5", "8.8", "9.2", "100", bookTimestamp - 3_600_001, "920", 10, "50", "460", "0"],
                [bookTimestamp - 3_600_000, "9.2", "10.2", "9.1", "10", "120", bookTimestamp - 1, "1200", 12, "60", "600", "0"],
            ]);
        }
        throw new Error(`Unexpected provider request: ${url}`);
    };
    return new AsterV3Client({
        baseUrl: "https://mock.aster",
        fetchImpl,
    });
}

async function currentBookTimestampTest() {
    const bookTimestamp = Date.now() - 1000;
    const provider = new AsterRealtimeMarketDataProvider(mockClient(bookTimestamp), {
        historyLimit: 100,
        historyCacheTtlMs: 60_000,
        maxMarketAgeMs: 30_000,
    });
    const bundle = await provider.load(["BNBUSDT"]);
    assert.equal(bundle.latestMarketTimestamp, bookTimestamp);
    assert.equal(bundle.marketSnapshots.BNB?.price, 10);
    assert.equal(bundle.marketSnapshots.BNB?.txns1h, 10);
    assert.equal(bundle.marketSnapshots.BNB?.executionTxns1h, 10);
}

async function staleBookTimestampTest() {
    const bookTimestamp = Date.now() - 120_000;
    const provider = new AsterRealtimeMarketDataProvider(mockClient(bookTimestamp), {
        historyLimit: 100,
        historyCacheTtlMs: 60_000,
        maxMarketAgeMs: 30_000,
    });
    await assert.rejects(
        () => provider.load(["BNBUSDT"]),
        /did not produce any fresh complete strategy snapshots/,
    );
}

async function klineRangeCompatibilityTest() {
    const urls: URL[] = [];
    const client = new AsterV3Client({
        baseUrl: "https://mock.aster",
        fetchImpl: async (input) => {
            urls.push(new URL(String(input)));
            return jsonResponse([]);
        },
    });
    await client.getKlines("BTCUSDT", "1h", 200);
    await client.getKlines("BTCUSDT", "1h", 500, { startTime: 1000, endTime: 2000 });
    assert.equal(urls[0].searchParams.has("startTime"), false);
    assert.equal(urls[0].searchParams.has("endTime"), false);
    assert.equal(urls[1].searchParams.get("startTime"), "1000");
    assert.equal(urls[1].searchParams.get("endTime"), "2000");
}

async function readOnlyRateLimitRetryTest() {
    let calls = 0;
    const client = new AsterV3Client({
        baseUrl: "https://mock.aster",
        readOnlyRateLimitMaxRetries: 2,
        readOnlyRateLimitBackoffBaseMs: 1,
        readOnlyRateLimitBackoffMaxMs: 5,
        fetchImpl: async () => {
            calls += 1;
            if (calls < 3) return new Response(JSON.stringify({ code: -1003, msg: "Too many requests" }), { status: 429, headers: { "retry-after": "0" } });
            return jsonResponse([]);
        },
    });
    assert.deepEqual(await client.getKlines("BTCUSDT", "1h", 200), []);
    assert.equal(calls, 3);

    let legacyCalls = 0;
    const legacyResponseClient = new AsterV3Client({
        baseUrl: "https://mock.aster",
        readOnlyRateLimitMaxRetries: 1,
        readOnlyRateLimitBackoffBaseMs: 1,
        readOnlyRateLimitBackoffMaxMs: 5,
        fetchImpl: async () => {
            legacyCalls += 1;
            if (legacyCalls === 1) return new Response(JSON.stringify({ code: -1003, msg: "Too many requests" }), { status: 400 });
            return jsonResponse([]);
        },
    });
    assert.deepEqual(await legacyResponseClient.getKlines("BTCUSDT", "1h", 200), []);
    assert.equal(legacyCalls, 2);

    let mutationCalls = 0;
    const mutationClient = new AsterV3Client({
        baseUrl: "https://mock.aster",
        privateKey: `0x${"0".repeat(63)}1`,
        userAddress: `0x${"0".repeat(40)}`,
        readOnlyRateLimitMaxRetries: 2,
        readOnlyRateLimitBackoffBaseMs: 1,
        readOnlyRateLimitBackoffMaxMs: 5,
        fetchImpl: async () => {
            mutationCalls += 1;
            return new Response(JSON.stringify({ code: -1003, msg: "Too many requests" }), { status: 400 });
        },
    });
    await assert.rejects(
        () => mutationClient.placeMarketOrder({ symbol: "BTCUSDT", side: "BUY", quantity: "0.001", reduceOnly: false, newClientOrderId: "unit-test-only" }),
        /Too many requests/,
    );
    assert.equal(mutationCalls, 1);
}

async function v12HistoryRequestsAreSerializedTest() {
    const now = 1_700_000_000_000;
    const firstTs = Math.floor((now - 1) / 3_600_000) * 3_600_000 - 200 * 3_600_000;
    const rows: AsterKline[] = Array.from({ length: 200 }, (_, index) => {
        const ts = firstTs + index * 3_600_000;
        return [ts, "100", "101", "99", "100", "10", ts + 3_600_000 - 1, "1000", 10, "5", "500", "0"];
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const requested: string[] = [];
    const client = new AsterV3Client({
        baseUrl: "https://mock.aster",
        fetchImpl: async (input) => {
            inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
            requested.push(new URL(String(input)).searchParams.get("symbol") || "");
            await new Promise<void>((resolve) => setTimeout(resolve, 1));
            inFlight -= 1;
            return jsonResponse(rows);
        },
    });
    const provider = new V12AsterMarketDataProvider(client, { hourlyLimit: 200, requestSpacingMs: 0, now: () => now });
    const loaded = await provider.load();
    assert.equal(Object.keys(loaded).length, V12_X1_ALL.universe.length);
    assert.equal(maxInFlight, 1);
    assert.deepEqual(requested, V12_X1_ALL.universe.map((symbol) => `${symbol}USDT`));
}

async function run() {
    await currentBookTimestampTest();
    await staleBookTimestampTest();
    await klineRangeCompatibilityTest();
    await readOnlyRateLimitRetryTest();
    await v12HistoryRequestsAreSerializedTest();
    console.log("ASTER_MARKET_DATA_PROVIDER_SELFTEST_OK");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
