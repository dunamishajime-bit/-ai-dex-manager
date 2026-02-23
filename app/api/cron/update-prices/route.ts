import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";
import { Universe, PricePoint, TokenRef } from "@/lib/types/market";
import { fetchPricesBatch, fetchUsdJpy, toJpy, priceKey } from "@/lib/providers/market-providers";

export const runtime = "nodejs";

function pickTokensByScope(u: Universe, scope: string): TokenRef[] {
    if (scope === "majors") return u.majorsTop10;
    if (scope === "bnb") return u.bnbTop15;
    if (scope === "polygon") return u.polygonTop15;
    if (scope === "favorites") return Object.values(u.favoritesByUser ?? {}).flat();
    return [];
}

export async function POST(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const scope = searchParams.get("scope") ?? "majors";

        const universe = await kvGet<Universe>("universe:v1");
        if (!universe) {
            return NextResponse.json({ ok: false, error: "Universe not ready" }, { status: 503 });
        }

        // FX 10 min TTL
        const now = Date.now();
        const FX_TTL = 10 * 60 * 1000;
        let fx = await kvGet<{ rate: number; updatedAt: number }>("fx:usd_jpy");
        if (!fx || now - fx.updatedAt > FX_TTL) {
            try {
                fx = await fetchUsdJpy();
                await kvSet("fx:usd_jpy", fx);
            } catch {
                if (!fx) return NextResponse.json({ ok: false, error: "FX unavailable" }, { status: 500 });
            }
        }

        const tokens = pickTokensByScope(universe, scope);
        if (!tokens.length) {
            return NextResponse.json({ ok: true, scope, updated: 0 });
        }

        const batch = await fetchPricesBatch(tokens);
        const prices = (await kvGet<Record<string, PricePoint>>("prices:v1")) ?? {};
        let updated = 0;

        for (const t of tokens) {
            const raw = batch[t.providerId];
            if (!raw?.usd) continue;

            prices[priceKey(t)] = {
                jpy: toJpy(raw.usd, fx.rate),
                usd: raw.usd,
                change24hPct: raw.change24hPct,
                updatedAt: now,
                source: t.provider,
            };
            updated++;
        }

        await kvSet("prices:v1", prices);

        return NextResponse.json({
            ok: true,
            scope,
            updated,
            fxRate: fx.rate,
            at: now
        });
    } catch (error: any) {
        console.error("[UpdatePrices] Failed:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
