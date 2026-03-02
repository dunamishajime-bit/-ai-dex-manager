import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";
import { Universe } from "@/lib/types/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARCH_CACHE_TTL = 300;
const RATE_LIMIT_WINDOW = 60;
const MAX_REQ_PER_IP = 30;

export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get("q")?.trim().toLowerCase();
    const ip = req.headers.get("x-forwarded-for") || "local";

    if (!query || query.length < 2) {
      return NextResponse.json({ ok: true, tokens: [] });
    }

    const rateKey = `rate:search:${ip}`;
    const count = (await kvGet<number>(rateKey)) ?? 0;
    if (count >= MAX_REQ_PER_IP) {
      return NextResponse.json(
        { ok: false, error: "Rate limit exceeded. Please try again later.", status: 429 },
        { status: 429 },
      );
    }
    await kvSet(rateKey, count + 1, RATE_LIMIT_WINDOW);

    const cacheKey = `search:v1:${query}`;
    const cached = await kvGet<any[]>(cacheKey);
    if (cached) {
      return NextResponse.json({ ok: true, tokens: cached, from: "cache" });
    }

    let results: any[] = [];

    const universe = await kvGet<Universe>("universe:v1");
    if (universe) {
      const allLocal = [
        ...universe.majorsTop10,
        ...universe.bnbTop15,
        ...universe.polygonTop15,
        ...Object.values(universe.favoritesByUser).flat(),
      ];
      results = allLocal.filter(
        (token) =>
          token.symbol.toLowerCase().includes(query) ||
          token.name?.toLowerCase().includes(query),
      );
    }

    if (results.length < 5) {
      try {
        const pRes = await fetch(
          `https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(query)}&c=currencies&limit=10`,
          { signal: AbortSignal.timeout(3000) },
        );
        if (pRes.ok) {
          const pData = await pRes.json();
          const paprikaTokens = (pData.currencies || []).map((token: any) => ({
            id: token.id,
            symbol: token.symbol,
            name: token.name,
            provider: "coinpaprika",
            providerId: token.id,
          }));
          results = [...results, ...paprikaTokens];
        }
      } catch (error) {
        console.warn("[Search] Paprika search failed:", error);
      }
    }

    const seen = new Set<string>();
    const unique = results.filter((token) => {
      const key = token.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    await kvSet(cacheKey, unique, SEARCH_CACHE_TTL);
    return NextResponse.json({ ok: true, tokens: unique });
  } catch (error: any) {
    console.error("[SearchAPI] Global failure:", error);
    return NextResponse.json({ ok: false, error: "Internal Search Error" }, { status: 500 });
  }
}