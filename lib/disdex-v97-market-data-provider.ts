import { type AsterKline, AsterV3Client } from "@/lib/aster-v3-client";
import { DISDEX_V97_CORE } from "@/config/disdexV97Runtime";
import type { DisDexV97Candle, DisDexV97FundingPoint, DisDexV97History, DisDexV97Symbol } from "@/lib/disdex-v97-signal-engine";

interface AsterFundingRateRow {
    fundingTime?: number | string;
    fundingRate?: number | string;
    time?: number | string;
    rate?: number | string;
}

export interface DisDexV97MarketDataProviderOptions {
    klineLimit?: number;
    fundingLimit?: number;
    cacheTtlMs?: number;
    fundingBaseUrl?: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
}

function finite(value: unknown, fallback = Number.NaN) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function candle(row: AsterKline): DisDexV97Candle | null {
    const value: DisDexV97Candle = {
        openTime: finite(row[0]),
        open: finite(row[1]),
        high: finite(row[2]),
        low: finite(row[3]),
        close: finite(row[4]),
        volume: finite(row[5], 0),
        closeTime: finite(row[6]),
    };
    return value.openTime > 0 && value.closeTime > value.openTime && value.open > 0 && value.high > 0 && value.low > 0 && value.close > 0
        ? value
        : null;
}

function completed(rows: AsterKline[], now: number) {
    return rows
        .map(candle)
        .filter((row): row is DisDexV97Candle => Boolean(row) && row!.closeTime < now)
        .sort((a, b) => a.openTime - b.openTime)
        .filter((row, index, source) => index === 0 || row.openTime !== source[index - 1].openTime);
}

export class DisDexV97AsterMarketDataProvider {
    private readonly klineLimit: number;
    private readonly fundingLimit: number;
    private readonly cacheTtlMs: number;
    private readonly fundingBaseUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private cached?: { expiresAt: number; history: DisDexV97History };

    constructor(private readonly client: AsterV3Client, options: DisDexV97MarketDataProviderOptions = {}) {
        this.klineLimit = Math.max(300, Math.min(1500, options.klineLimit ?? 1500));
        this.fundingLimit = Math.max(100, Math.min(1000, options.fundingLimit ?? 1000));
        this.cacheTtlMs = Math.max(30_000, options.cacheTtlMs ?? 5 * 60_000);
        this.fundingBaseUrl = String(options.fundingBaseUrl || "https://fapi.asterdex.com").replace(/\/+$/, "");
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.now = options.now ?? Date.now;
    }

    private async loadFunding(symbol: DisDexV97Symbol): Promise<DisDexV97FundingPoint[]> {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 10_000);
        try {
            const url = new URL(`${this.fundingBaseUrl}/fapi/v3/fundingRate`);
            url.searchParams.set("symbol", symbol);
            url.searchParams.set("limit", String(this.fundingLimit));
            const response = await this.fetchImpl(url, {
                method: "GET",
                cache: "no-store",
                signal: abort.signal,
                headers: { "user-agent": "DisDex-V97/1.0" },
            });
            if (!response.ok) throw new Error(`V97 Aster funding ${symbol} HTTP ${response.status}.`);
            const payload = await response.json() as unknown;
            if (!Array.isArray(payload)) throw new Error(`V97 Aster funding ${symbol} payload is not an array.`);
            return payload
                .map((raw) => raw as AsterFundingRateRow)
                .map((raw) => ({ fundingTime: finite(raw.fundingTime ?? raw.time), fundingRate: finite(raw.fundingRate ?? raw.rate) }))
                .filter((row) => row.fundingTime > 0 && Number.isFinite(row.fundingRate))
                .sort((a, b) => a.fundingTime - b.fundingTime)
                .filter((row, index, source) => index === 0 || row.fundingTime !== source[index - 1].fundingTime);
        } finally {
            clearTimeout(timeout);
        }
    }

    async load(force = false): Promise<DisDexV97History> {
        const now = this.now();
        if (!force && this.cached && this.cached.expiresAt > now) return this.cached.history;
        const symbols = [...DISDEX_V97_CORE.symbols];
        const [klineResults, fundingResults] = await Promise.all([
            Promise.all(symbols.map((symbol) => this.client.getKlines(symbol, DISDEX_V97_CORE.barInterval, this.klineLimit))),
            Promise.all(symbols.map((symbol) => this.loadFunding(symbol))),
        ]);
        const bars4h = {} as Record<DisDexV97Symbol, DisDexV97Candle[]>;
        const funding = {} as Record<DisDexV97Symbol, DisDexV97FundingPoint[]>;
        symbols.forEach((symbol, index) => {
            bars4h[symbol] = completed(klineResults[index], now);
            funding[symbol] = fundingResults[index];
            if (bars4h[symbol].length < 180) throw new Error(`V97 ${symbol} 4h history is insufficient: ${bars4h[symbol].length}.`);
        });
        const btcReference = bars4h.BTCUSDT.at(-1)?.openTime;
        if (!btcReference) throw new Error("V97 BTC latest completed 4h reference is missing.");
        for (const symbol of symbols) {
            if (bars4h[symbol].at(-1)?.openTime !== btcReference) {
                throw new Error(`V97 4h histories are not aligned at ${btcReference}: ${symbol}=${bars4h[symbol].at(-1)?.openTime}.`);
            }
        }
        const history = { bars4h, funding };
        this.cached = { expiresAt: now + this.cacheTtlMs, history };
        return history;
    }
}
