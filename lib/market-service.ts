export interface PriceData {
    price: number;
    change24h: number;
    lastUpdated: number;
}

const CACHE_DURATION_MS = 60 * 1000; // 1 minute cache
let priceCache: Record<string, PriceData> = {};

export async function fetchMarketPrices(symbols: string[]): Promise<Record<string, PriceData>> {
    if (symbols.length === 0) return {};

    // Check cache first
    const now = Date.now();
    const needsUpdate = symbols.some(s => {
        const cached = priceCache[s];
        return !cached || (now - cached.lastUpdated > CACHE_DURATION_MS);
    });

    if (!needsUpdate) {
        return mapCacheToSymbols(symbols);
    }

    try {
        const idString = symbols.join(",");
        const res = await fetch(`/api/market/prices?ids=${idString}`);
        if (!res.ok) throw new Error(`Prices API failed: ${res.status}`);
        const data = await res.json();

        if (!data) {
            throw new Error("Failed to fetch price data via internal API");
        }

        // Update cache
        symbols.forEach(s => {
            if (data[s]) {
                priceCache[s] = {
                    price: data[s].usd,
                    change24h: data[s].usd_24h_change,
                    lastUpdated: now
                };
            }
        });

        return mapCacheToSymbols(symbols);

    } catch (error) {
        console.warn("[MarketService] Failed to fetch market prices, using cache:", error);
        return mapCacheToSymbols(symbols);
    }
}

export async function safeFetchPrice(symbol: string): Promise<PriceData> {
    try {
        const prices = await fetchMarketPrices([symbol]);
        if (prices[symbol]) return prices[symbol];

        // Fallback
        return priceCache[symbol] || {
            price: 0,
            change24h: 0,
            lastUpdated: Date.now()
        };
    } catch (e) {
        console.warn(`[MarketService] safeFetchPrice failed for ${symbol}:`, e);
        return {
            price: 0,
            change24h: 0,
            lastUpdated: Date.now()
        };
    }
}

function mapCacheToSymbols(symbols: string[]): Record<string, PriceData> {
    const result: Record<string, PriceData> = {};
    symbols.forEach(symbol => {
        if (priceCache[symbol]) {
            result[symbol] = priceCache[symbol];
        }
    });
    return result;
}
