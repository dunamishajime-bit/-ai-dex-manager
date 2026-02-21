
import { smartFetch } from "./coingecko-optimizer";
// const COINGECKO_API_URL = "https://api.coingecko.com/api/v3"; // Removed


// Mapping of our internal symbols to CoinGecko IDs
const SYMBOL_TO_ID: Record<string, string> = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "POL": "matic-network", // MATIC is now POL
    "MATIC": "matic-network",
    "DOGE": "dogecoin",
    // "AVAX": "avalanche-2",
};

interface PriceData {
    price: number;
    change24h: number;
    lastUpdated: number;
}

// Simple in-memory cache to avoid rate limits
// CoinGecko Free Tier: ~10-30 requests/minute
const CACHE_DURATION_MS = 60 * 1000; // 1 minute cache
let priceCache: Record<string, PriceData> = {};

export async function fetchMarketPrices(symbols: string[]): Promise<Record<string, PriceData>> {
    const ids = symbols.map(s => SYMBOL_TO_ID[s]).filter(Boolean);
    if (ids.length === 0) return {};

    // Check cache first
    const now = Date.now();
    const needsUpdate = ids.some(id => {
        const cached = priceCache[id];
        return !cached || (now - cached.lastUpdated > CACHE_DURATION_MS);
    });

    if (!needsUpdate) {
        // Return cached data mapped back to symbols
        return mapCacheToSymbols(symbols);
    }

    try {
        const idString = ids.join(",");
        // Use smartFetch to route through proxy and handle rate limits
        // Note: smartFetch handles the base URL and proxy logic internally
        const data = await smartFetch<any>(
            `/simple/price?ids=${idString}&vs_currencies=usd&include_24hr_change=true`
        );

        if (!data) {
            throw new Error("Failed to fetch price data via smartFetch");
        }

        // Update cache
        ids.forEach(id => {
            if (data[id]) {
                priceCache[id] = {
                    price: data[id].usd,
                    change24h: data[id].usd_24h_change,
                    lastUpdated: now
                };
            }
        });

        return mapCacheToSymbols(symbols);

    } catch (error) {
        console.error("Failed to fetch market prices:", error);
        // Fallback to cache if available, even if stale
        return mapCacheToSymbols(symbols);
    }
}

function mapCacheToSymbols(symbols: string[]): Record<string, PriceData> {
    const result: Record<string, PriceData> = {};
    symbols.forEach(symbol => {
        const id = SYMBOL_TO_ID[symbol];
        if (id && priceCache[id]) {
            result[symbol] = priceCache[id];
        }
    });
    return result;
}

export function getSymbolId(symbol: string): string | undefined {
    return SYMBOL_TO_ID[symbol];
}
