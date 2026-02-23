import { NextResponse } from "next/server";
import { kvGet } from "@/lib/kv";
import { Universe, PricePoint, TokenRef } from "@/lib/types/market";
import { priceKey } from "@/lib/providers/market-providers";

export const runtime = "nodejs";

function attachPrice(list: TokenRef[], prices: Record<string, PricePoint>) {
    return list.map(t => {
        const p = prices[priceKey(t)];
        return {
            ...t,
            id: t.providerId,
            usdPrice: p?.usd || 0,
            jpyPrice: p?.jpy || 0,
            priceChange24h: p?.change24hPct || 0,
            updatedAt: p?.updatedAt || 0,
        };
    });
}

export async function GET() {
    try {
        let universe = await kvGet<Universe>("universe:v1");

        // Self-seed if empty
        if (!universe) {
            console.log("[Dashboard] Universe empty, seeding...");
            const refreshRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/agents/refresh-universe`, { method: "POST" });
            if (refreshRes.ok) {
                universe = await kvGet<Universe>("universe:v1");
            }
        }

        if (!universe) {
            return NextResponse.json({ ok: false, error: "Universe not ready. Initializing, please refresh in a moment." }, { status: 503 });
        }

        const prices = (await kvGet<Record<string, PricePoint>>("prices:v1")) ?? {};
        const fx = await kvGet<{ rate: number }>("fx:usd_jpy");

        const majors = attachPrice(universe.majorsTop10, prices);
        const bnb = attachPrice(universe.bnbTop15, prices);
        const polygon = attachPrice(universe.polygonTop15, prices);

        const sortedMovers = [...majors].filter(x => typeof x.priceChange24h === "number")
            .sort((a, b) => b.priceChange24h - a.priceChange24h);

        const up = sortedMovers.slice(0, 3);
        const down = [...sortedMovers].reverse().slice(0, 3);

        return NextResponse.json({
            ok: true,
            updatedAt: Date.now(),
            fxRate: fx?.rate || 150,
            trendTop3: { up, down },
            dexTradableMajorsTop10: majors,
            bnbTop15: bnb,
            polygonTop15: polygon,
            favoritesByUser: Object.fromEntries(
                Object.entries(universe.favoritesByUser ?? {}).map(([uid, list]) => [uid, attachPrice(list, prices)])
            ),
        });
    } catch (error: any) {
        console.error("[DashboardAPI] Failed:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
