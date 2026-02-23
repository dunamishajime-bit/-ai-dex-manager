import { NextResponse } from "next/server";
import { fetchPricesBatch } from "@/lib/providers/market-providers";
import { TokenRef } from "@/lib/types/market";

export const runtime = "nodejs";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const ids = searchParams.get("ids")?.split(",") || [];

        if (ids.length === 0 || !ids[0]) {
            return NextResponse.json({
                prices: {},
                updatedAt: Date.now(),
                source: "fallback"
            });
        }

        // 1. Resolve IDs to symbols (IDs are now expected to be symbols for this project)
        const symbols = ids.map(id => id.toUpperCase());

        // 2. Fetch fresh prices
        const tokensToFetch: TokenRef[] = symbols.map(s => ({
            symbol: s,
            provider: "coincap",
            providerId: s.toLowerCase(),
            chain: "MAJOR"
        }));
        const freshPrices = await fetchPricesBatch(tokensToFetch);

        // 3. Simple output format
        const out: Record<string, any> = {};
        symbols.forEach(s => {
            const priceData = freshPrices[s] || freshPrices[s.toLowerCase()];
            if (priceData) {
                out[s.toLowerCase()] = {
                    usd: priceData.usd,
                    usd_24h_change: priceData.change24hPct
                };
            }
        });

        return NextResponse.json(out);
    } catch (error: any) {
        console.error("[PricesAPI] Failed:", error);
        return NextResponse.json({ ok: false, error: "Failed to fetch prices" }, { status: 500 });
    }
}
