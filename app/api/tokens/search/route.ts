import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";
import { Universe } from "@/lib/types/market";

export const runtime = "nodejs";

const SEARCH_CACHE_TTL = 300; // 5 minutes
const RATE_LIMIT_WINDOW = 60; // 1 minute
const MAX_REQ_PER_IP = 30;

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const query = searchParams.get("q")?.toLowerCase();
        const ip = req.headers.get("x-forwarded-for") || "local";

        if (!query || query.length < 2) {
            return NextResponse.json({ ok: true, tokens: [] });
        }

        // 1. IP Rate Limiting (Simple KV based)
        const rateKey = `rate:search:${ip}`;
        const count = (await kvGet<number>(rateKey)) ?? 0;
        if (count >= MAX_REQ_PER_IP) {
            return NextResponse.json({ ok: false, error: "Rate limit exceeded. Please try again later.", status: 429 }, { status: 429 });
        }
        await kvSet(rateKey, count + 1, RATE_LIMIT_WINDOW);

        // 2. Check Cache
        const cacheKey = `search:v1:${query}`;
        const cached = await kvGet<any[]>(cacheKey);
        if (cached) return NextResponse.json({ ok: true, tokens: cached, from: "cache" });

        // 3. Search sequence
        let results: any[] = [];

        // 3-A. Check Universe (Majors / Chain lists)
        const universe = await kvGet<Universe>("universe:v1");
        if (universe) {
            const allLocal = [
                ...universe.majorsTop10,
                ...universe.bnbTop15,
                ...universe.polygonTop15,
                ...Object.values(universe.favoritesByUser).flat()
            ];
            results = allLocal.filter(t =>
                t.symbol.toLowerCase().includes(query) ||
                t.name?.toLowerCase().includes(query)
            );
        }

        // 3-B. If not enough local results, try external sources
        if (results.length < 5) {
            try {
                // CoinPaprika Search (Free, no key usually for basic search)
                const pRes = await fetch(`https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(query)}&c=currencies&limit=10`, { signal: AbortSignal.timeout(3000) });
                if (pRes.ok) {
                    const pData = await pRes.json();
                    const paprikaTokens = (pData.currencies || []).map((t: any) => ({
                        id: t.id,
                        symbol: t.symbol,
                        name: t.name,
                        provider: "coinpaprika",
                        providerId: t.id
                    }));
                    results = [...results, ...paprikaTokens];
                }
            } catch (e) {
                console.warn("[Search] Paprika search failed:", e);
            }
        }

        // 3-C. Last resort: No more fallback polling.
        // We rely on local universe and CoinPaprika for search.

        // Deduplicate by symbol
        const seen = new Set();
        const unique = results.filter(t => {
            const k = t.symbol.toUpperCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });

        await kvSet(cacheKey, unique, SEARCH_CACHE_TTL);

        return NextResponse.json({ ok: true, tokens: unique });
    } catch (error: any) {
        console.error("[SearchAPI] Global failure:", error);
        return NextResponse.json({ ok: false, error: "Internal Search Error" }, { status: 500 });
    }
}
