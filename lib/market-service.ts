export interface PriceData {
    price: number;
    change24h: number;
    volume: number;
    updatedAt: number;
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
