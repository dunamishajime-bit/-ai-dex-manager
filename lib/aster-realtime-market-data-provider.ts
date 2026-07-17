import {
    AsterV3Client,
    type Aster24hTicker,
    type AsterBookTicker,
    type AsterExchangeSymbol,
    type AsterKline,
    type AsterPriceTicker,
} from "@/lib/aster-v3-client";
import type { MarketSnapshot, PriceSample } from "@/lib/cycle-strategy";
import {
    STRATEGY_UNIVERSE_SYMBOLS,
    getStrategyAssetMeta,
} from "@/config/strategyUniverse";
import type {
    LiveStrategyMarketBundle,
    LiveStrategyMarketDataProvider,
} from "@/lib/win80-ultra90-live-runner";

export interface AsterRealtimeMarketDataProviderOptions {
    historyInterval?: string;
    historyLimit?: number;
    historyCacheTtlMs?: number;
    historyConcurrency?: number;
    maxMarketAgeMs?: number;
}

type Aster24hTickerWithCount = Aster24hTicker & { count?: number | string };

function safeNumber(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function asArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}

function baseFromAsterSymbol(symbol: string) {
    return symbol.toUpperCase().replace(/USDT$/, "");
}

function buildStrategySymbolMap(asterSymbols: string[]) {
    const strategyUniverse = new Set(STRATEGY_UNIVERSE_SYMBOLS.map((symbol) => symbol.toUpperCase()));
    const asterToStrategySymbol: Record<string, string> = {};
    const strategyToAsterSymbol: Record<string, string> = {};
    for (const asterSymbol of asterSymbols) {
        const normalizedAster = asterSymbol.toUpperCase();
        const base = baseFromAsterSymbol(normalizedAster);
        const strategySymbol = strategyUniverse.has(base)
            ? base
            : strategyUniverse.has(`${base}.SOL`)
                ? `${base}.SOL`
                : undefined;
        if (!strategySymbol) continue;
        asterToStrategySymbol[normalizedAster] = strategySymbol;
        strategyToAsterSymbol[strategySymbol] = normalizedAster;
    }
    return { asterToStrategySymbol, strategyToAsterSymbol };
}

async function mapWithConcurrency<T, U>(
    values: T[],
    concurrency: number,
    mapper: (value: T) => Promise<U>,
): Promise<U[]> {
    const results = new Array<U>(values.length);
    let index = 0;
    const workers = Array.from(
        { length: Math.min(Math.max(1, concurrency), Math.max(1, values.length)) },
        async () => {
            while (index < values.length) {
                const current = index;
                index += 1;
                results[current] = await mapper(values[current]);
            }
        },
    );
    await Promise.all(workers);
    return results;
}

export class AsterRealtimeMarketDataProvider implements LiveStrategyMarketDataProvider {
    private readonly historyInterval: string;
    private readonly historyLimit: number;
    private readonly historyCacheTtlMs: number;
    private readonly historyConcurrency: number;
    private readonly maxMarketAgeMs: number;
    private exchangeCache?: { expiresAt: number; symbols: AsterExchangeSymbol[] };
    private readonly historyCache = new Map<string, {
        expiresAt: number;
        samples: PriceSample[];
    }>();

    constructor(
        private readonly client: AsterV3Client,
        options: AsterRealtimeMarketDataProviderOptions = {},
    ) {
        this.historyInterval = options.historyInterval || "1h";
        this.historyLimit = Math.max(60, Math.min(500, options.historyLimit ?? 220));
        this.historyCacheTtlMs = Math.max(60_000, options.historyCacheTtlMs ?? 5 * 60_000);
        this.historyConcurrency = Math.max(1, options.historyConcurrency ?? 5);
        this.maxMarketAgeMs = Math.max(5000, options.maxMarketAgeMs ?? 30_000);
    }

    private async tradingSymbols() {
        const now = Date.now();
        if (this.exchangeCache && this.exchangeCache.expiresAt > now) {
            return this.exchangeCache.symbols;
        }
        const info = await this.client.getExchangeInfo();
        const symbols = (info.symbols || []).filter((item) => item.status === "TRADING");
        this.exchangeCache = { expiresAt: now + 15 * 60_000, symbols };
        return symbols;
    }

    private async loadHistory(symbol: string) {
        const cached = this.historyCache.get(symbol);
        if (cached && cached.expiresAt > Date.now()) return cached.samples;
        const rows = await this.client.getKlines(symbol, this.historyInterval, this.historyLimit);
        const samples = rows
            .map((row: AsterKline): PriceSample | null => {
                const closeTime = safeNumber(row[6]);
                const close = safeNumber(row[4]);
                return closeTime > 0 && close > 0 ? { ts: closeTime, price: close } : null;
            })
            .filter((sample): sample is PriceSample => sample !== null);
        this.historyCache.set(symbol, {
            expiresAt: Date.now() + this.historyCacheTtlMs,
            samples,
        });
        return samples;
    }

    async load(symbols: string[]): Promise<LiveStrategyMarketBundle> {
        const requested = Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase())));
        const trading = await this.tradingSymbols();
        const tradingSet = new Set(trading.map((item) => item.symbol));
        const eligible = requested.filter((symbol) => tradingSet.has(symbol));
        if (!eligible.length) throw new Error("No requested Aster symbols are currently TRADING.");

        const [pricePayload, bookPayload, statsPayload, histories] = await Promise.all([
            this.client.getPriceTickers(),
            this.client.getBookTickers(),
            this.client.get24hTickers(),
            mapWithConcurrency(eligible, this.historyConcurrency, async (symbol) => ({
                symbol,
                samples: await this.loadHistory(symbol),
            })),
        ]);
        const priceMap = new Map(asArray<AsterPriceTicker>(pricePayload).map((item) => [item.symbol, item]));
        const bookMap = new Map(asArray<AsterBookTicker>(bookPayload).map((item) => [item.symbol, item]));
        const statsMap = new Map(asArray<Aster24hTickerWithCount>(statsPayload as Aster24hTickerWithCount | Aster24hTickerWithCount[]).map((item) => [item.symbol, item]));
        const historyMap = new Map(histories.map((item) => [item.symbol, item.samples]));
        const { asterToStrategySymbol, strategyToAsterSymbol } = buildStrategySymbolMap(eligible);
        const marketSnapshots: Record<string, MarketSnapshot | undefined> = {};
        const priceHistory: Record<string, PriceSample[] | undefined> = {};
        let oldestIncludedBookTimestamp = 0;
        const now = Date.now();

        for (const asterSymbol of eligible) {
            const strategySymbol = asterToStrategySymbol[asterSymbol];
            if (!strategySymbol) continue;
            const priceRow = priceMap.get(asterSymbol);
            const bookRow = bookMap.get(asterSymbol);
            const statsRow = statsMap.get(asterSymbol);
            const history = historyMap.get(asterSymbol);
            const lastPrice = safeNumber(priceRow?.price ?? statsRow?.lastPrice);
            const bid = safeNumber(bookRow?.bidPrice);
            const ask = safeNumber(bookRow?.askPrice);
            const bookTimestamp = safeNumber(bookRow?.time);
            const ageMs = bookTimestamp > 0 ? Math.max(0, now - bookTimestamp) : Number.POSITIVE_INFINITY;
            if (
                lastPrice <= 0
                || bid <= 0
                || ask <= 0
                || ask < bid
                || bookTimestamp <= 0
                || ageMs > this.maxMarketAgeMs
                || !history?.length
            ) {
                continue;
            }

            const mid = (bid + ask) / 2;
            const quoteVolume = safeNumber(statsRow?.quoteVolume);
            const trades24h = safeNumber(statsRow?.count);
            const estimatedTxns1h = trades24h > 0 ? Math.max(1, Math.floor(trades24h / 24)) : 0;
            const topBookUsd = (safeNumber(bookRow?.bidQty) * bid) + (safeNumber(bookRow?.askQty) * ask);
            oldestIncludedBookTimestamp = oldestIncludedBookTimestamp === 0
                ? bookTimestamp
                : Math.min(oldestIncludedBookTimestamp, bookTimestamp);
            const meta = getStrategyAssetMeta(strategySymbol);
            marketSnapshots[strategySymbol] = {
                price: mid,
                change24h: safeNumber(statsRow?.priceChangePercent),
                volume: quoteVolume,
                liquidity: Math.max(topBookUsd, quoteVolume * 0.005),
                spreadBps: mid > 0 ? ((ask - bid) / mid) * 10_000 : 0,
                marketCap: 0,
                tokenAgeDays: 365,
                txns1h: estimatedTxns1h,
                dexPairFound: true,
                executionSupported: true,
                executionChain: meta.chain,
                executionRouteKind: "native",
                executionSource: "aster-v3-futures",
                executionLiquidityUsd: Math.max(topBookUsd, quoteVolume * 0.005),
                executionVolume24hUsd: quoteVolume,
                executionTxns1h: estimatedTxns1h,
                source: "aster-v3-futures",
                displaySymbol: meta.displaySymbol,
                chain: meta.chain,
            };
            priceHistory[strategySymbol] = history;
        }

        if (!Object.keys(marketSnapshots).length || oldestIncludedBookTimestamp <= 0) {
            throw new Error("Aster market data did not produce any fresh complete strategy snapshots.");
        }
        return {
            generatedAt: Date.now(),
            latestMarketTimestamp: oldestIncludedBookTimestamp,
            exchangeSymbols: eligible,
            asterToStrategySymbol,
            strategyToAsterSymbol,
            marketSnapshots,
            priceHistory,
        };
    }
}
