import assert from "node:assert/strict";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterRealtimeMarketDataProvider } from "../lib/aster-realtime-market-data-provider";

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
                symbols: [{ symbol: "BTCUSDT", status: "TRADING" }],
            });
        }
        if (url.includes("/ticker/price")) {
            return jsonResponse([{ symbol: "BTCUSDT", price: "10.00", time: bookTimestamp - 500 }]);
        }
        if (url.includes("/ticker/bookTicker")) {
            return jsonResponse([{
                symbol: "BTCUSDT",
                bidPrice: "9.99",
                bidQty: "100",
                askPrice: "10.01",
                askQty: "120",
                time: bookTimestamp,
            }]);
        }
        if (url.includes("/ticker/24hr")) {
            return jsonResponse([{
                symbol: "BTCUSDT",
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
    const bundle = await provider.load(["BTCUSDT"]);
    assert.equal(bundle.latestMarketTimestamp, bookTimestamp);
    assert.equal(bundle.marketSnapshots.BTC?.price, 10);
    assert.equal(bundle.marketSnapshots.BTC?.txns1h, 10);
    assert.equal(bundle.marketSnapshots.BTC?.executionTxns1h, 10);
}

async function staleBookTimestampTest() {
    const bookTimestamp = Date.now() - 120_000;
    const provider = new AsterRealtimeMarketDataProvider(mockClient(bookTimestamp), {
        historyLimit: 100,
        historyCacheTtlMs: 60_000,
        maxMarketAgeMs: 30_000,
    });
    await assert.rejects(
        () => provider.load(["BTCUSDT"]),
        /did not produce any fresh complete strategy snapshots/,
    );
}

async function run() {
    await currentBookTimestampTest();
    await staleBookTimestampTest();
    console.log("ASTER_MARKET_DATA_PROVIDER_SELFTEST_OK");
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
