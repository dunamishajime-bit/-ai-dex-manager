import { AsterV3Client, type AsterKline } from "./aster-v3-client";
import { QUALITY102_HOUR_MS, type Quality102Candle } from "./disdex-quality102-causal-pipeline";
import type { Quality102CausalV1History } from "./disdex-quality102-causal-v1-signal";

const MINIMUM_HISTORY_HOURS = 181 * 24;
const DEFAULT_HISTORY_HOURS = 225 * 24;
const DEFAULT_PAGE_LIMIT = 500;
const MAX_CACHE_TTL_MS = 5 * 60_000;

export interface Quality102CausalV1AsterMarketDataOptions {
    symbols: readonly string[];
    historyHours?: number;
    pageLimit?: number;
    cacheTtlMs?: number;
    now?: () => number;
}

function normalizeSymbols(symbols: readonly string[]): string[] {
    const configured = symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
    if (!configured.length) throw new Error("QUALITY102_SYMBOL_UNIVERSE_REQUIRED");
    return Array.from(new Set([...configured, "BTCUSDT"])).sort();
}

function finiteNumber(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`QUALITY102_INVALID_ASTER_KLINE:${field}`);
    return parsed;
}

function toCandle(row: AsterKline): Quality102Candle {
    const timestampMs = finiteNumber(row[0], "openTime");
    const open = finiteNumber(row[1], "open");
    const high = finiteNumber(row[2], "high");
    const low = finiteNumber(row[3], "low");
    const close = finiteNumber(row[4], "close");
    const quoteVolume = finiteNumber(row[7], "quoteVolume");
    if (timestampMs <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || quoteVolume < 0) {
        throw new Error("QUALITY102_INVALID_ASTER_KLINE_VALUE");
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
        throw new Error("QUALITY102_INVALID_ASTER_KLINE_OHLC");
    }
    return { timestampMs, open, high, low, close, quoteVolume };
}

export class Quality102CausalV1AsterMarketDataProvider {
    private readonly symbols: string[];
    private readonly historyHours: number;
    private readonly pageLimit: number;
    private readonly cacheTtlMs: number;
    private readonly now: () => number;
    private cached?: { expiresAt: number; history: Quality102CausalV1History };

    constructor(private readonly client: AsterV3Client, options: Quality102CausalV1AsterMarketDataOptions) {
        this.symbols = normalizeSymbols(options.symbols);
        this.historyHours = Math.floor(options.historyHours ?? DEFAULT_HISTORY_HOURS);
        if (this.historyHours < MINIMUM_HISTORY_HOURS) throw new Error("QUALITY102_INSUFFICIENT_MARKET_HISTORY_REQUEST");
        this.pageLimit = Math.floor(options.pageLimit ?? DEFAULT_PAGE_LIMIT);
        if (this.pageLimit < 1 || this.pageLimit > DEFAULT_PAGE_LIMIT) throw new Error("QUALITY102_INVALID_ASTER_PAGE_LIMIT");
        const requestedTtl = options.cacheTtlMs ?? MAX_CACHE_TTL_MS;
        if (!Number.isFinite(requestedTtl) || requestedTtl < 0) throw new Error("QUALITY102_INVALID_CACHE_TTL");
        this.cacheTtlMs = Math.min(requestedTtl, MAX_CACHE_TTL_MS);
        this.now = options.now ?? Date.now;
    }

    private async loadSymbol(symbol: string, now: number): Promise<Quality102Candle[]> {
        const latestOpenTs = Math.floor(now / QUALITY102_HOUR_MS) * QUALITY102_HOUR_MS - QUALITY102_HOUR_MS;
        const earliestOpenTs = latestOpenTs - (this.historyHours - 1) * QUALITY102_HOUR_MS;
        const pages: AsterKline[][] = [];
        for (let pageEnd = latestOpenTs; pageEnd >= earliestOpenTs;) {
            const pageStart = Math.max(earliestOpenTs, pageEnd - (this.pageLimit - 1) * QUALITY102_HOUR_MS);
            pages.push(await this.client.getKlines(symbol, "1h", this.pageLimit, { startTime: pageStart, endTime: pageEnd }));
            pageEnd = pageStart - QUALITY102_HOUR_MS;
        }

        const rows = pages.flat()
            .filter((row) => Number.isFinite(Number(row[6])) && Number(row[6]) < now)
            .filter((row) => Number(row[0]) >= earliestOpenTs && Number(row[0]) <= latestOpenTs)
            .map(toCandle)
            .sort((left, right) => left.timestampMs - right.timestampMs);

        const timestamps = new Set<number>();
        for (const row of rows) {
            if (timestamps.has(row.timestampMs)) throw new Error(`QUALITY102_DUPLICATE_ASTER_CANDLE:${symbol}`);
            timestamps.add(row.timestampMs);
        }
        for (let index = 0; index < this.historyHours; index += 1) {
            if (rows[index]?.timestampMs !== earliestOpenTs + index * QUALITY102_HOUR_MS) {
                throw new Error(`QUALITY102_NONCONTIGUOUS_ASTER_1H:${symbol}`);
            }
        }
        if (rows.length !== this.historyHours) throw new Error(`QUALITY102_NONCONTIGUOUS_ASTER_1H:${symbol}`);
        return rows;
    }

    async load(): Promise<Quality102CausalV1History> {
        const now = this.now();
        if (!Number.isFinite(now) || now <= 0) throw new Error("QUALITY102_INVALID_MARKET_CLOCK");
        if (this.cached && this.cached.expiresAt > now) return this.cached.history;
        const entries = await Promise.all(this.symbols.map(async (symbol) => [symbol, await this.loadSymbol(symbol, now)] as const));
        const history: Quality102CausalV1History = { candlesBySymbol: Object.fromEntries(entries) };
        this.cached = { expiresAt: now + this.cacheTtlMs, history };
        return history;
    }
}
