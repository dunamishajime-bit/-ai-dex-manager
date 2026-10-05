export interface PriceData {
    price: number;
    change24h: number;
    volume: number;
    updatedAt: number;
}

export interface StrategyUniverseMetricData extends PriceData {
    chain?: "BNB" | "SOLANA";
    displaySymbol?: string;
    liquidity?: number;
    spreadBps?: number;
    marketCap?: number;
    tokenAgeDays?: number;
    txns1h?: number;
    dexPairFound?: boolean;
    contractAddress?: string;
    dexPairUrl?: string;
    executionSupported?: boolean;
    executionChain?: "BNB" | "SOLANA";
    executionChainId?: number;
    executionAddress?: string;
    executionDecimals?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionSource?: string;
    executionPairUrl?: string;
    executionLiquidityUsd?: number;
    executionVolume24hUsd?: number;
    executionTxns1h?: number;
    source?: string;
}

/**
 * Fetches market prices from internal aggregator API.
 * [IMPORTANT] NO CoinGecko calls allowed here.
 */
export async function fetchMarketPrices(symbols: string[]): Promise<Record<string, PriceData>> {
    if (symbols.length === 0) return {};

    try {
        const idString = symbols.join(",");
        const res = await fetch(`/api/market/prices?ids=${idString}`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        const data = await res.json();
        const results: Record<string, PriceData> = {};

        symbols.forEach(symbol => {
            const sym = symbol.toLowerCase();
            const p = data[sym];
            if (p) {
                results[symbol] = {
                    price: p.usd,
                    change24h: p.usd_24h_change || 0,
                    volume: 0,
                    updatedAt: Date.now()
                };
            }
        });

        return results;
    } catch (error) {
        console.warn("[MarketService] Failed to fetch market prices:", error);
        return {};
    }
}

export async function fetchStrategyUniverseMetrics(symbols: string[]): Promise<Record<string, StrategyUniverseMetricData>> {
    if (symbols.length === 0) return {};

    try {
        const res = await fetch(`/api/market/universe-metrics?symbols=${encodeURIComponent(symbols.join(","))}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        const data = await res.json();
        const results: Record<string, StrategyUniverseMetricData> = {};

        symbols.forEach((symbol) => {
            const normalized = symbol.toUpperCase();
            const payload = data?.[normalized];
            if (!payload) return;

            results[normalized] = {
                price: Number(payload.price || 0),
                change24h: Number(payload.change24h || 0),
                volume: Number(payload.volume || 0),
                updatedAt: Number(payload.updatedAt || Date.now()),
                chain: payload.chain === "SOLANA" ? "SOLANA" : "BNB",
                displaySymbol: typeof payload.displaySymbol === "string" ? payload.displaySymbol : undefined,
                liquidity: Number(payload.liquidity || 0),
                spreadBps: Number(payload.spreadBps || 0),
                marketCap: Number(payload.marketCap || 0),
                tokenAgeDays: Number(payload.tokenAgeDays || 0),
                txns1h: Number(payload.txns1h || 0),
                dexPairFound: Boolean(payload.dexPairFound),
                contractAddress: typeof payload.contractAddress === "string" ? payload.contractAddress : undefined,
                dexPairUrl: typeof payload.dexPairUrl === "string" ? payload.dexPairUrl : undefined,
                executionSupported: Boolean(payload.executionSupported),
                executionChain: payload.executionChain === "SOLANA" ? "SOLANA" : payload.executionChain === "BNB" ? "BNB" : undefined,
                executionChainId: Number.isFinite(Number(payload.executionChainId)) ? Number(payload.executionChainId) : undefined,
                executionAddress: typeof payload.executionAddress === "string" ? payload.executionAddress : undefined,
                executionDecimals: Number.isFinite(Number(payload.executionDecimals)) ? Number(payload.executionDecimals) : undefined,
                executionRouteKind:
                    payload.executionRouteKind === "proxy"
                        ? "proxy"
                        : payload.executionRouteKind === "native"
                            ? "native"
                            : payload.executionRouteKind === "cross-chain"
                                ? "cross-chain"
                                : undefined,
                executionSource: typeof payload.executionSource === "string" ? payload.executionSource : undefined,
                executionPairUrl: typeof payload.executionPairUrl === "string" ? payload.executionPairUrl : undefined,
                executionLiquidityUsd: Number.isFinite(Number(payload.executionLiquidityUsd)) ? Number(payload.executionLiquidityUsd) : undefined,
                executionVolume24hUsd: Number.isFinite(Number(payload.executionVolume24hUsd)) ? Number(payload.executionVolume24hUsd) : undefined,
                executionTxns1h: Number.isFinite(Number(payload.executionTxns1h)) ? Number(payload.executionTxns1h) : undefined,
                source: typeof payload.source === "string" ? payload.source : undefined,
            };
        });

        return results;
    } catch (error) {
        console.warn("[MarketService] Failed to fetch strategy universe metrics:", error);
        return {};
    }
}
