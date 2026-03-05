import { TokenRef } from "../types/market";

const COINGECKO_ID_MAP: Record<string, string> = {
    "bitcoin": "bitcoin",
    "ethereum": "ethereum",
    "solana": "solana",
    "binance-coin": "binancecoin",
    "xrp": "ripple",
    "cardano": "cardano",
    "avalanche": "avalanche-2",
    "dogecoin": "dogecoin",
    "tron": "tron",
    "chainlink": "chainlink",
    "arbitrum": "arbitrum",
    "optimism": "optimism",
    "polygon": "polygon-ecosystem-token",
    "pancakeswap": "pancakeswap-token",
    "venus": "venus",
    "alpaca-finance": "alpaca-finance",
    "astar": "astar",
    "world-liberty-financial": "world-liberty-financial",
    "trust-wallet-token": "trust-wallet-token",
    "shiba-inu": "shiba-inu",
};

export function priceKey(t: TokenRef): string {
    return `${t.symbol.toUpperCase()}@${t.chain}`;
}

export async function fetchUsdJpy(): Promise<{ rate: number; updatedAt: number }> {
    const parseRate = (value: unknown) => {
        const rate = Number(value);
        return Number.isFinite(rate) && rate > 50 && rate < 300 ? rate : 0;
    };

    try {
        const res = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=JPY", {
            cache: "no-store",
            next: { revalidate: 0 } // App Router cache bypass
        });
        const j = await res.json();
        const rate = parseRate(j?.rates?.JPY);
        if (!rate) {
            throw new Error("Invalid rate from primary FX source");
        }
        return { rate, updatedAt: Date.now() };
    } catch (e) {
        console.warn("[FX] Primary fetch failed, trying secondary source:", e);
    }

    try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
        const j = await res.json();
        const rate = parseRate(j?.rates?.JPY);
        if (!rate) throw new Error("Invalid rate from ER API");
        return { rate, updatedAt: Date.now() };
    } catch (e) {
        console.warn("[FX] Secondary fetch failed, trying tertiary source:", e);
    }

    try {
        const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=JPY", { cache: "no-store" });
        const j = await res.json();
        const rate = parseRate(j?.rates?.JPY);
        if (!rate) throw new Error("Invalid rate from Frankfurter");
        return { rate, updatedAt: Date.now() };
    } catch (e) {
        console.warn("[FX] Tertiary fetch failed, using fallback:", e);
    }

    return { rate: 155.0, updatedAt: Date.now() };
}

export function toJpy(usd: number, usdJpy: number): number {
    return Math.round(usd * usdJpy * 100) / 100;
}

export async function fetchPricesBatch(tokens: TokenRef[]): Promise<Record<string, { usd: number; change24hPct?: number }>> {
    const out: Record<string, { usd: number; change24hPct?: number }> = {};

    const byProvider = tokens.reduce<Record<string, TokenRef[]>>((acc, t) => {
        acc[t.provider] ??= [];
        acc[t.provider].push(t);
        return acc;
    }, {});

    // --- CoinCap ---
    if (byProvider.coincap?.length) {
        try {
            // CoinCap /v2/assets is efficient for batching top coins
            const res = await fetch("https://api.coincap.io/v2/assets?limit=2000", { cache: "no-store" });
            const json = await res.json();
            const list = json?.data ?? [];
            const need = new Set(byProvider.coincap.map(t => t.providerId));

            for (const a of list) {
                if (!need.has(a.id)) continue;
                const usd = Number(a.priceUsd);
                if (!usd) continue;
                out[a.id] = {
                    usd,
                    change24hPct: Number(a.changePercent24Hr)
                };
            }
        } catch (e) {
            console.error("[CoinCap] Batch fetch failed:", e);
        }

        const unresolved = byProvider.coincap.filter((token) => !out[token.providerId]);
        if (unresolved.length) {
            try {
                const geckoIdToProviderIds = unresolved.reduce<Record<string, string[]>>((acc, token) => {
                    const geckoId = COINGECKO_ID_MAP[token.providerId] || token.providerId;
                    acc[geckoId] ??= [];
                    acc[geckoId].push(token.providerId);
                    return acc;
                }, {});

                const geckoIds = Object.keys(geckoIdToProviderIds);
                const res = await fetch(
                    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(geckoIds.join(","))}&vs_currencies=usd&include_24hr_change=true`,
                    { cache: "no-store" },
                );
                const json = await res.json();

                geckoIds.forEach((geckoId) => {
                    const payload = json?.[geckoId];
                    const usd = Number(payload?.usd);
                    if (!usd) return;

                    geckoIdToProviderIds[geckoId].forEach((providerId) => {
                        out[providerId] = {
                            usd,
                            change24hPct: Number(payload?.usd_24h_change) || 0,
                        };
                    });
                });
            } catch (e) {
                console.error("[CoinGecko] Batch fallback failed:", e);
            }
        }
    }

    // Note: Future providers like DexScreener or CoinPaprika can be added here

    return out;
}
export async function fetchHistory(id: string, interval: string = "d1"): Promise<any[]> {
    try {
        const res = await fetch(`https://api.coincap.io/v2/assets/${id}/history?interval=${interval}`, { cache: "no-store" });
        const json = await res.json();
        return json?.data ?? [];
    } catch (e) {
        console.error(`[CoinCap] History fetch failed for ${id}:`, e);
        return [];
    }
}
