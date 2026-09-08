import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AsterApiError, AsterV3Client, isAsterDepositRequirementError, type AsterKline } from "./aster-v3-client";
import { QUALITY102_HOUR_MS, type Quality102Candle } from "./disdex-quality102-causal-pipeline";
import type { Quality102CausalV1History } from "./disdex-quality102-causal-v1-signal";

const MINIMUM_HISTORY_HOURS = 181 * 24;
const DEFAULT_HISTORY_HOURS = 225 * 24;
const DEFAULT_PAGE_LIMIT = 500;
const MAX_CACHE_TTL_MS = 5 * 60_000;
const PERSISTED_HISTORY_VERSION = 1 as const;
const DEFAULT_REQUEST_SPACING_MS = 100;
const DEFAULT_RATE_LIMIT_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 120_000;

export interface Quality102CausalV1AsterMarketDataOptions {
    symbols: readonly string[];
    historyHours?: number;
    pageLimit?: number;
    cacheTtlMs?: number;
    /** Durable history checkpoint. It is never used by read-only preflight. */
    cachePath?: string;
    requestSpacingMs?: number;
    rateLimitAttempts?: number;
    now?: () => number;
}

interface PersistedQuality102History {
    version: typeof PERSISTED_HISTORY_VERSION;
    symbols: string[];
    historyHours: number;
    savedAt: number;
    candlesBySymbol: Record<string, Quality102Candle[]>;
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

function validateCandle(candle: Quality102Candle, symbol: string): Quality102Candle {
    if (candle.timestampMs <= 0 || candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || (candle.baseVolume !== undefined && candle.baseVolume < 0) || candle.quoteVolume < 0) {
        throw new Error(`QUALITY102_INVALID_ASTER_KLINE_VALUE:${symbol}`);
    }
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) {
        throw new Error(`QUALITY102_INVALID_ASTER_KLINE_OHLC:${symbol}`);
    }
    return candle;
}

function toCandle(row: AsterKline, symbol: string): Quality102Candle {
    return validateCandle({
        timestampMs: finiteNumber(row[0], "openTime"),
        open: finiteNumber(row[1], "open"),
        high: finiteNumber(row[2], "high"),
        low: finiteNumber(row[3], "low"),
        close: finiteNumber(row[4], "close"),
        baseVolume: finiteNumber(row[5], "baseVolume"),
        quoteVolume: finiteNumber(row[7], "quoteVolume"),
    }, symbol);
}

function normalizePersistedCandle(value: unknown, symbol: string, index: number): Quality102Candle {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`QUALITY102_HISTORY_CACHE_INVALID_CANDLE:${symbol}:${index}`);
    const raw = value as Record<string, unknown>;
    const candle = {
        timestampMs: finiteNumber(raw.timestampMs, "cached.openTime"),
        open: finiteNumber(raw.open, "cached.open"),
        high: finiteNumber(raw.high, "cached.high"),
        low: finiteNumber(raw.low, "cached.low"),
        close: finiteNumber(raw.close, "cached.close"),
        baseVolume: finiteNumber(raw.baseVolume, "cached.baseVolume"),
        quoteVolume: finiteNumber(raw.quoteVolume, "cached.quoteVolume"),
    };
    return validateCandle(candle, symbol);
}

function validateCandleSeries(rows: readonly Quality102Candle[], symbol: string, earliestOpenTs: number, latestOpenTs: number, expectedLength: number): Quality102Candle[] {
    const sorted = [...rows].sort((left, right) => left.timestampMs - right.timestampMs);
    const timestamps = new Set<number>();
    for (const row of sorted) {
        if (timestamps.has(row.timestampMs)) throw new Error(`QUALITY102_DUPLICATE_ASTER_CANDLE:${symbol}`);
        timestamps.add(row.timestampMs);
    }
    if (sorted.length !== expectedLength) throw new Error(`QUALITY102_NONCONTIGUOUS_ASTER_1H:${symbol}`);
    for (let index = 0; index < expectedLength; index += 1) {
        if (sorted[index]?.timestampMs !== earliestOpenTs + index * QUALITY102_HOUR_MS) {
            throw new Error(`QUALITY102_NONCONTIGUOUS_ASTER_1H:${symbol}`);
        }
    }
    if (sorted[0]?.timestampMs !== earliestOpenTs || sorted.at(-1)?.timestampMs !== latestOpenTs) {
        throw new Error(`QUALITY102_NONCONTIGUOUS_ASTER_1H:${symbol}`);
    }
    return sorted;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isMissingFile(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

export class Quality102CausalV1AsterMarketDataProvider {
    private readonly symbols: string[];
    private readonly historyHours: number;
    private readonly pageLimit: number;
    private readonly cacheTtlMs: number;
    private readonly cachePath?: string;
    private readonly requestSpacingMs: number;
    private readonly rateLimitAttempts: number;
    private readonly now: () => number;
    private cached?: { expiresAt: number; history: Quality102CausalV1History };
    private lastRequestAt = 0;

    constructor(private readonly client: AsterV3Client, options: Quality102CausalV1AsterMarketDataOptions) {
        this.symbols = normalizeSymbols(options.symbols);
        this.historyHours = Math.floor(options.historyHours ?? DEFAULT_HISTORY_HOURS);
        if (this.historyHours < MINIMUM_HISTORY_HOURS) throw new Error("QUALITY102_INSUFFICIENT_MARKET_HISTORY_REQUEST");
        this.pageLimit = Math.floor(options.pageLimit ?? DEFAULT_PAGE_LIMIT);
        if (this.pageLimit < 1 || this.pageLimit > DEFAULT_PAGE_LIMIT) throw new Error("QUALITY102_INVALID_ASTER_PAGE_LIMIT");
        const requestedTtl = options.cacheTtlMs ?? MAX_CACHE_TTL_MS;
        if (!Number.isFinite(requestedTtl) || requestedTtl < 0) throw new Error("QUALITY102_INVALID_CACHE_TTL");
        this.cacheTtlMs = Math.min(requestedTtl, MAX_CACHE_TTL_MS);
        const requestSpacingMs = options.requestSpacingMs ?? DEFAULT_REQUEST_SPACING_MS;
        if (!Number.isFinite(requestSpacingMs) || requestSpacingMs < 0 || requestSpacingMs > 60_000) throw new Error("QUALITY102_INVALID_REQUEST_SPACING");
        this.requestSpacingMs = requestSpacingMs;
        const rateLimitAttempts = Math.floor(options.rateLimitAttempts ?? DEFAULT_RATE_LIMIT_ATTEMPTS);
        if (rateLimitAttempts < 1 || rateLimitAttempts > 5) throw new Error("QUALITY102_INVALID_RATE_LIMIT_ATTEMPTS");
        this.rateLimitAttempts = rateLimitAttempts;
        this.cachePath = options.cachePath ? resolve(options.cachePath) : undefined;
        this.now = options.now ?? Date.now;
    }

    private async waitForRequestSlot(): Promise<void> {
        const waitMs = Math.max(0, this.lastRequestAt + this.requestSpacingMs - Date.now());
        if (waitMs > 0) await sleep(waitMs);
        this.lastRequestAt = Date.now();
    }

    private async getKlines(symbol: string, limit: number, startTime: number, endTime: number): Promise<AsterKline[]> {
        let lastRateError: unknown;
        for (let attempt = 0; attempt < this.rateLimitAttempts; attempt += 1) {
            await this.waitForRequestSlot();
            try {
                return await this.client.getKlines(symbol, "1h", limit, { startTime, endTime });
            } catch (error) {
                if (isAsterDepositRequirementError(error)) {
                    throw new Error("ASTER_FUTURES_V3_DEPOSIT_REQUIREMENT_5050_FAIL_CLOSED");
                }
                if (!(error instanceof AsterApiError) || (error.status !== 429 && error.status !== 418)) throw error;
                lastRateError = error;
                if (attempt + 1 >= this.rateLimitAttempts) break;
                const venueDelay = error.retryAfterMs ?? (error.status === 418 ? 60_000 : 5_000);
                const backoff = Math.min(MAX_BACKOFF_MS, Math.max(1_000 * (2 ** attempt), venueDelay));
                await sleep(backoff);
            }
        }
        const status = lastRateError instanceof AsterApiError ? lastRateError.status : "unknown";
        throw new Error(`QUALITY102_ASTER_RATE_LIMIT_FAIL_CLOSED:${status}`);
    }

    private async fetchRange(symbol: string, startTime: number, endTime: number): Promise<Quality102Candle[]> {
        if (endTime < startTime) return [];
        const pages: AsterKline[][] = [];
        for (let pageEnd = endTime; pageEnd >= startTime;) {
            const pageStart = Math.max(startTime, pageEnd - (this.pageLimit - 1) * QUALITY102_HOUR_MS);
            // Aster rejects a zero-width range even though the requested
            // candle itself is valid. Keep the inclusive local range intact,
            // but make the venue request strictly wider at that boundary.
            const requestEnd = pageStart === pageEnd ? pageEnd + 1 : pageEnd;
            const rows = await this.getKlines(symbol, this.pageLimit, pageStart, requestEnd);
            if (!Array.isArray(rows)) throw new Error(`QUALITY102_ASTER_KLINE_RESPONSE_INVALID:${symbol}`);
            pages.push(rows);
            pageEnd = pageStart - QUALITY102_HOUR_MS;
        }
        const candles = pages.flat()
            .filter((row) => Number.isFinite(Number(row[6])) && Number(row[6]) < this.now())
            .filter((row) => Number(row[0]) >= startTime && Number(row[0]) <= endTime)
            .map((row) => toCandle(row, symbol));
        const timestamps = new Set<number>();
        for (const candle of candles) {
            if (timestamps.has(candle.timestampMs)) throw new Error(`QUALITY102_DUPLICATE_ASTER_CANDLE:${symbol}`);
            timestamps.add(candle.timestampMs);
        }
        return candles;
    }

    private async readPersistentHistory(): Promise<Record<string, Quality102Candle[]> | undefined> {
        if (!this.cachePath) return undefined;
        let serialized: string;
        try {
            serialized = await readFile(this.cachePath, "utf8");
        } catch (error) {
            if (isMissingFile(error)) return undefined;
            throw error;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(serialized) as unknown;
        } catch {
            throw new Error("QUALITY102_HISTORY_CACHE_INVALID_JSON");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("QUALITY102_HISTORY_CACHE_INVALID_ROOT");
        const raw = parsed as Partial<PersistedQuality102History>;
        if (raw.version !== PERSISTED_HISTORY_VERSION || raw.historyHours !== this.historyHours || !Number.isFinite(raw.savedAt) || !Array.isArray(raw.symbols) || JSON.stringify(raw.symbols) !== JSON.stringify(this.symbols)) {
            throw new Error("QUALITY102_HISTORY_CACHE_IDENTITY_MISMATCH");
        }
        if (!raw.candlesBySymbol || typeof raw.candlesBySymbol !== "object" || Array.isArray(raw.candlesBySymbol)) throw new Error("QUALITY102_HISTORY_CACHE_SYMBOLS_MISSING");
        const result: Record<string, Quality102Candle[]> = {};
        for (const symbol of this.symbols) {
            const values = (raw.candlesBySymbol as Record<string, unknown>)[symbol];
            if (!Array.isArray(values) || values.length !== this.historyHours) throw new Error(`QUALITY102_HISTORY_CACHE_LENGTH_INVALID:${symbol}`);
            const rows = values.map((value, index) => normalizePersistedCandle(value, symbol, index));
            result[symbol] = validateCandleSeries(rows, symbol, rows[0].timestampMs, rows.at(-1)!.timestampMs, this.historyHours);
        }
        return result;
    }

    private async writePersistentHistory(history: Quality102CausalV1History, savedAt: number): Promise<void> {
        if (!this.cachePath) return;
        const payload: PersistedQuality102History = {
            version: PERSISTED_HISTORY_VERSION,
            symbols: this.symbols,
            historyHours: this.historyHours,
            savedAt,
            candlesBySymbol: Object.fromEntries(Object.entries(history.candlesBySymbol).map(([symbol, rows]) => [symbol, [...rows]])),
        };
        await mkdir(dirname(this.cachePath), { recursive: true });
        const temporary = `${this.cachePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            await writeFile(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
            await rename(temporary, this.cachePath);
        } catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
    }

    private async loadSymbol(symbol: string, now: number, cachedRows?: Quality102Candle[]): Promise<Quality102Candle[]> {
        const latestOpenTs = Math.floor(now / QUALITY102_HOUR_MS) * QUALITY102_HOUR_MS - QUALITY102_HOUR_MS;
        const earliestOpenTs = latestOpenTs - (this.historyHours - 1) * QUALITY102_HOUR_MS;
        const rowsByTimestamp = new Map<number, Quality102Candle>();
        if (cachedRows) {
            for (const row of cachedRows) rowsByTimestamp.set(row.timestampMs, row);
        }
        let missingStart: number | undefined;
        let previousMissing: number | undefined;
        const missingRanges: Array<{ start: number; end: number }> = [];
        for (let index = 0; index < this.historyHours; index += 1) {
            const timestampMs = earliestOpenTs + index * QUALITY102_HOUR_MS;
            if (rowsByTimestamp.has(timestampMs)) {
                if (missingStart !== undefined && previousMissing !== undefined) missingRanges.push({ start: missingStart, end: previousMissing });
                missingStart = undefined;
                previousMissing = undefined;
            } else {
                missingStart ??= timestampMs;
                previousMissing = timestampMs;
            }
        }
        if (missingStart !== undefined && previousMissing !== undefined) missingRanges.push({ start: missingStart, end: previousMissing });
        for (const range of missingRanges) {
            for (const candle of await this.fetchRange(symbol, range.start, range.end)) rowsByTimestamp.set(candle.timestampMs, candle);
        }
        const rows = Array.from({ length: this.historyHours }, (_, index) => rowsByTimestamp.get(earliestOpenTs + index * QUALITY102_HOUR_MS)).filter((row): row is Quality102Candle => Boolean(row));
        return validateCandleSeries(rows, symbol, earliestOpenTs, latestOpenTs, this.historyHours);
    }

    private async loadEntryOpen(symbol: string, now: number): Promise<{ timestampMs: number; open: number }> {
        const timestampMs = Math.floor(now / QUALITY102_HOUR_MS) * QUALITY102_HOUR_MS;
        // Aster rejects a zero-width range (startTime === endTime) with
        // -1023, and may omit the just-opened candle when the range is only
        // 1ms wide. Query only through the already-observed current time;
        // the selector consumes row[1] (the candle open), so no future value
        // or later intrabar price is introduced.
        const requestEndTime = Math.max(timestampMs + 1, now);
        const rows = await this.getKlines(symbol, 1, timestampMs, requestEndTime);
        const row = rows.find((candidate) => Number(candidate[0]) === timestampMs);
        if (!row) throw new Error(`QUALITY102_CURRENT_ASTER_1H_OPEN_MISSING:${symbol}`);
        const open = finiteNumber(row[1], "currentOpen");
        if (!(open > 0)) throw new Error(`QUALITY102_CURRENT_ASTER_1H_OPEN_INVALID:${symbol}`);
        return { timestampMs, open };
    }

    async load(): Promise<Quality102CausalV1History> {
        const now = this.now();
        if (!Number.isFinite(now) || now <= 0) throw new Error("QUALITY102_INVALID_MARKET_CLOCK");
        if (this.cached && this.cached.expiresAt > now) return this.cached.history;
        const persisted = await this.readPersistentHistory();
        const entries: Array<{ symbol: string; candles: Quality102Candle[]; entryOpen: { timestampMs: number; open: number } }> = [];
        // Keep the initial catch-up bounded and sequential. A cold start may
        // need many Kline pages; serialized requests plus the retry backoff
        // prevent a daemon restart from creating a request burst.
        for (const symbol of this.symbols) {
            const candles = await this.loadSymbol(symbol, now, persisted?.[symbol]);
            const entryOpen = await this.loadEntryOpen(symbol, now);
            entries.push({ symbol, candles, entryOpen });
        }
        const history: Quality102CausalV1History = {
            candlesBySymbol: Object.fromEntries(entries.map(({ symbol, candles }) => [symbol, candles])),
            entryOpenBySymbol: Object.fromEntries(entries.map(({ symbol, entryOpen }) => [symbol, entryOpen])),
        };
        await this.writePersistentHistory(history, now);
        this.cached = { expiresAt: now + this.cacheTtlMs, history };
        return history;
    }
}
