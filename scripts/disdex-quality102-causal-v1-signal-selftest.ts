import assert from "node:assert/strict";
import { QUALITY102_CAUSAL_V1 } from "../config/disdexQuality102CausalV1Runtime";
import { AsterV3Client, type AsterKline } from "../lib/aster-v3-client";
import { Quality102CausalV1AsterMarketDataProvider } from "../lib/disdex-quality102-causal-v1-market-data";
import { buildQuality102CausalV1Signal, type Quality102CausalV1History } from "../lib/disdex-quality102-causal-v1-signal";
import type { Quality102Candle } from "../lib/disdex-quality102-causal-pipeline";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 4, 12);
const MINIMUM_HISTORY_HOURS = 181 * 24;
const SIGNAL_HISTORY_HOURS = 225 * 24;

function candle(timestampMs: number, close = 100, open = close): Quality102Candle {
    return { timestampMs, open, high: Math.max(open, close) * 1.01, low: Math.min(open, close) * 0.99, close, quoteVolume: 1_000 };
}

function rows(count = MINIMUM_HISTORY_HOURS): Quality102Candle[] {
    const first = NOW - count * HOUR;
    return Array.from({ length: count }, (_, index) => candle(first + index * HOUR));
}

function history(symbol: string, candles: Quality102Candle[]): Quality102CausalV1History {
    return { candlesBySymbol: { [symbol]: candles } };
}

function setBar(candles: Quality102Candle[], index: number, close: number, open = close): void {
    candles[index] = candle(candles[index].timestampMs, close, open);
}

function addLongTrainingWinner(candles: Quality102Candle[], signalIndex: number): void {
    setBar(candles, signalIndex - 336, 90);
    setBar(candles, signalIndex - 24, 120);
    for (let index = signalIndex - 23; index < signalIndex; index += 1) setBar(candles, index, 120 - (index - (signalIndex - 24)) * 0.8);
    setBar(candles, signalIndex, 100, 99);
    for (let index = signalIndex + 1; index < signalIndex + 72; index += 1) setBar(candles, index, 100);
    setBar(candles, signalIndex + 72, 112);
}

function highVolRows(): Quality102Candle[] {
    const candles = rows(SIGNAL_HISTORY_HOURS);
    for (const signalIndex of [650, 1_250, 1_850, 2_450, 3_050, 3_650]) addLongTrainingWinner(candles, signalIndex);
    const current = candles.length - 1;
    setBar(candles, current - 336, 90);
    setBar(candles, current - 24, 120);
    for (let index = current - 23; index < current; index += 1) setBar(candles, index, 120 - (index - (current - 24)) * 0.8);
    setBar(candles, current, 100, 99);
    return candles;
}

function activePenguRows(): Quality102Candle[] {
    const candles = highVolRows();
    const signalIndex = candles.length - 2;
    setBar(candles, signalIndex - 336, 90);
    setBar(candles, signalIndex - 24, 120);
    for (let index = signalIndex - 23; index < signalIndex; index += 1) setBar(candles, index, 120 - (index - (signalIndex - 24)) * 0.8);
    setBar(candles, signalIndex, 100, 99);
    setBar(candles, signalIndex + 1, 100);
    return candles;
}

function cutoffTests(): void {
    const valid = rows();
    const future = valid.map((row) => ({ ...row }));
    future[future.length - 1].timestampMs = NOW;
    assert.throws(() => buildQuality102CausalV1Signal({ history: history("FETUSDT", future), decisionTs: NOW }), /FUTURE_CANDLE/);

    const stale = valid.map((row) => ({ ...row, timestampMs: row.timestampMs - 2 * HOUR }));
    assert.throws(() => buildQuality102CausalV1Signal({ history: history("FETUSDT", stale), decisionTs: NOW }), /STALE_CANDLE/);

    const gapped = valid.map((row) => ({ ...row }));
    gapped[100].timestampMs += HOUR;
    assert.throws(() => buildQuality102CausalV1Signal({ history: history("FETUSDT", gapped), decisionTs: NOW }), /NONCONTIGUOUS/);

    assert.throws(() => buildQuality102CausalV1Signal({ history: history("FETUSDT", valid.slice(1)), decisionTs: NOW }), /INSUFFICIENT_WALK_FORWARD_HISTORY/);
}

function signalTests(): void {
    const valid = rows();
    const sourceIncompleteFamilyShapes = [
        [[72, 95], [12, 109], [0, 105]],
        [[14, 102], [0, 100]],
        [[24, 100], [12, 95], [0, 98]],
        [[24, 100], [0, 104]],
    ] as const;
    for (const edits of sourceIncompleteFamilyShapes) {
        const candidate = valid.map((row) => ({ ...row }));
        for (const [hoursAgo, close] of edits) setBar(candidate, candidate.length - 1 - hoursAgo, close);
        const signal = buildQuality102CausalV1Signal({ history: history("FETUSDT", candidate), decisionTs: NOW });
        assert.equal(signal.side, 0);
        assert.equal(signal.family, undefined);
        assert.equal(signal.brkEnabled, false);
    }

    const highVol = highVolRows();
    const signal = buildQuality102CausalV1Signal({ history: history("AVAXUSDT", highVol), decisionTs: NOW });
    assert.equal(signal.family, "HIGH_VOL");
    assert.equal(signal.side, 1);
    assert.equal(signal.symbol, "AVAXUSDT");
    assert.equal(signal.dataCutoffTs, NOW - HOUR);
    assert.equal(signal.referenceTs, NOW - HOUR);
    assert.equal(signal.requestedGross, QUALITY102_CAUSAL_V1.maximumGross);
    assert.equal(signal.brkEnabled, false);

    const tied = buildQuality102CausalV1Signal({ history: { candlesBySymbol: { ZZZUSDT: highVol, AAAUSDT: highVol } }, decisionTs: NOW });
    assert.equal(tied.symbol, "AAAUSDT");

    const activePengu = activePenguRows();
    const correlatedScanner = activePengu.map((row) => ({ ...row }));
    setBar(correlatedScanner, correlatedScanner.length - 1, correlatedScanner.at(-1)!.close, 99);
    const correlatedWithActivePengu = buildQuality102CausalV1Signal({
        history: { candlesBySymbol: { PENGUUSDT: activePengu, AVAXUSDT: correlatedScanner } },
        decisionTs: NOW,
    });
    assert.equal(correlatedWithActivePengu.side, 0);
}

function kline(openTime: number): AsterKline {
    return [openTime, "100", "101", "99", "100", "10", openTime + HOUR - 1, "1000", 5, "5", "500", "0"];
}

function pagedClient(transform: (rows: AsterKline[], symbol: string, page: number) => AsterKline[] = (value) => value) {
    const urls: URL[] = [];
    const pages = new Map<string, number>();
    const client = new AsterV3Client({
        baseUrl: "https://mock.aster",
        fetchImpl: async (input) => {
            const url = new URL(String(input));
            urls.push(url);
            const symbol = String(url.searchParams.get("symbol"));
            const start = Number(url.searchParams.get("startTime"));
            const end = Number(url.searchParams.get("endTime"));
            const limit = Number(url.searchParams.get("limit"));
            assert.ok(Number.isFinite(start) && Number.isFinite(end));
            const payload: AsterKline[] = [];
            for (let timestamp = start; timestamp <= end && payload.length < limit; timestamp += HOUR) payload.push(kline(timestamp));
            const page = pages.get(symbol) ?? 0;
            pages.set(symbol, page + 1);
            return new Response(JSON.stringify(transform(payload, symbol, page)), { status: 200 });
        },
    });
    return { client, urls };
}

async function providerTests(): Promise<void> {
    let clock = NOW;
    const paged = pagedClient();
    const provider = new Quality102CausalV1AsterMarketDataProvider(paged.client, {
        symbols: ["fetusdt", "FETUSDT"], historyHours: MINIMUM_HISTORY_HOURS, pageLimit: 500, cacheTtlMs: 999_999, now: () => clock,
    });
    const loaded = await provider.load();
    const fet = loaded.candlesBySymbol.FETUSDT;
    assert.deepEqual(Object.keys(loaded.candlesBySymbol), ["BTCUSDT", "FETUSDT"]);
    assert.equal(fet.length, MINIMUM_HISTORY_HOURS);
    assert.equal(fet[0].timestampMs, NOW - MINIMUM_HISTORY_HOURS * HOUR);
    assert.equal(fet.at(-1)?.timestampMs, NOW - HOUR);
    assert.ok(paged.urls.length > 2);
    assert.ok(paged.urls.every((url) => Number(url.searchParams.get("endTime")) < NOW));
    const requestCount = paged.urls.length;
    assert.equal((await provider.load()).candlesBySymbol.FETUSDT, fet);
    assert.equal(paged.urls.length, requestCount);
    clock += 5 * 60_000;
    assert.notEqual((await provider.load()).candlesBySymbol.FETUSDT, fet);
    assert.equal(paged.urls.length, requestCount * 2);

    const duplicate = pagedClient((payload, symbol, page) => symbol === "FETUSDT" && page === 0 ? [...payload.slice(0, 2), payload[1], ...payload.slice(2)] : payload);
    await assert.rejects(() => new Quality102CausalV1AsterMarketDataProvider(duplicate.client, {
        symbols: ["FETUSDT"], historyHours: MINIMUM_HISTORY_HOURS, pageLimit: 500, now: () => NOW,
    }).load(), /DUPLICATE_ASTER_CANDLE:FETUSDT/);

    const gap = pagedClient((payload, symbol, page) => symbol === "FETUSDT" && page === 0 ? payload.filter((_, index) => index !== 1) : payload);
    await assert.rejects(() => new Quality102CausalV1AsterMarketDataProvider(gap.client, {
        symbols: ["FETUSDT"], historyHours: MINIMUM_HISTORY_HOURS, pageLimit: 500, now: () => NOW,
    }).load(), /NONCONTIGUOUS_ASTER_1H:FETUSDT/);
}

async function run(): Promise<void> {
    cutoffTests();
    signalTests();
    await providerTests();
    console.log("QUALITY102_CAUSAL_V1_SIGNAL_SELFTEST_PASS", JSON.stringify({
        historicalSelectorParity: QUALITY102_CAUSAL_V1.historicalSelectorParity,
        brkEnabled: QUALITY102_CAUSAL_V1.brkEnabled,
        sourceIncompleteFamiliesGenerated: false,
    }));
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
