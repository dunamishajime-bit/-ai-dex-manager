import { TokenRef } from "../types/market";

export function priceKey(t: TokenRef): string {
    return `${t.symbol.toUpperCase()}@${t.chain}`;
}

export async function fetchUsdJpy(): Promise<{ rate: number; updatedAt: number }> {
    try {
        // Using a reliable free FX API
        const res = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=JPY", {
            cache: "no-store",
            next: { revalidate: 0 } // App Router cache bypass
        });
        const j = await res.json();
        const rate = Number(j?.rates?.JPY);

        if (!rate || rate < 50) {
            throw new Error("Invalid rate from primary FX source");
        }
        return { rate, updatedAt: Date.now() };
    } catch (e) {
        console.warn("[FX] Primary fetch failed, using fallback:", e);
        // Fallback to a secondary source or static approximate
        return { rate: 150.0, updatedAt: Date.now() }; // Safe approximation for JPY
    }
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

        // Fallback: CoinPaprika by symbol when CoinCap is unavailable/incomplete.
        const unresolved = byProvider.coincap.filter((t) => !out[t.providerId]);
        if (unresolved.length > 0) {
            try {
                const res = await fetch("https://api.coinpaprika.com/v1/tickers", { cache: "no-store" });
                const json = await res.json();
                const list = Array.isArray(json) ? json : [];

                const bySymbol: Record<string, any> = {};
                for (const item of list) {
                    const sym = String(item?.symbol || "").toUpperCase();
                    if (sym && !bySymbol[sym]) bySymbol[sym] = item;
                }

                for (const t of unresolved) {
                    const p = bySymbol[t.symbol.toUpperCase()];
                    const usd = Number(p?.quotes?.USD?.price);
                    if (!usd) continue;
                    out[t.providerId] = {
                        usd,
                        change24hPct: Number(p?.quotes?.USD?.percent_change_24h ?? 0),
                    };
                }
            } catch (e) {
                console.error("[CoinPaprika] Fallback fetch failed:", e);
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
