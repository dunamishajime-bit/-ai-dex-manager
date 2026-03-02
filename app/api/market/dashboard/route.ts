import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";
import { Universe, PricePoint, TokenRef } from "@/lib/types/market";
import { fetchPricesBatch, priceKey, toJpy } from "@/lib/providers/market-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBaseUrl() {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (appUrl) return appUrl;
    const vercelUrl = process.env.VERCEL_URL?.trim();
    if (vercelUrl) return `https://${vercelUrl}`;
    return "http://localhost:3000";
}

function attachPrice(list: TokenRef[], prices: Record<string, PricePoint>) {
    return list.map((t) => {
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

function toLegacyPricesMap(tokens: TokenRef[], prices: Record<string, PricePoint>) {
    const out: Record<string, { usd: number; change24h: number }> = {};
    for (const t of tokens) {
        const p = prices[priceKey(t)];
        out[t.symbol.toUpperCase()] = {
            usd: p?.usd || 0,
            change24h: p?.change24hPct || 0,
        };
    }
    return out;
}

export async function GET() {
    try {
        const baseUrl = getBaseUrl();
        let universe = await kvGet<Universe>("universe:v1");

        if (!universe) {
            console.log("[Dashboard] Universe empty, seeding...");
            const refreshRes = await fetch(`${baseUrl}/api/market/refresh`, { method: "POST" });
            if (refreshRes.ok) {
                universe = await kvGet<Universe>("universe:v1");
            }
        }

        if (!universe) {
            return NextResponse.json({ ok: false, error: "Universe not ready. Initializing, please refresh in a moment." }, { status: 503 });
        }

        let prices = (await kvGet<Record<string, PricePoint>>("prices:v1")) ?? {};
        if (Object.keys(prices).length === 0) {
            console.log("[Dashboard] Prices empty, refreshing...");
            const refreshRes = await fetch(`${baseUrl}/api/market/refresh`, { method: "POST" });
            if (refreshRes.ok) {
                prices = (await kvGet<Record<string, PricePoint>>("prices:v1")) ?? {};
            }
        }

        const fx = await kvGet<{ rate: number }>("fx:usd_jpy");
        const fxRate = fx?.rate || 150;

        const majorsProbe = attachPrice(universe.majorsTop10, prices);
        const majorZeroRatio =
            majorsProbe.length > 0
                ? majorsProbe.filter((m) => (m.usdPrice || 0) <= 0).length / majorsProbe.length
                : 0;

        if (majorZeroRatio >= 0.5) {
            const allUniverseTokens = [...universe.majorsTop10, ...universe.bnbTop15, ...universe.polygonTop15];
            const fresh = await fetchPricesBatch(allUniverseTokens);
            if (Object.keys(fresh).length > 0) {
                const patchedPrices: Record<string, PricePoint> = { ...prices };
                const now = Date.now();
                for (const t of allUniverseTokens) {
                    const p = fresh[t.providerId];
                    if (!p?.usd) continue;
                    patchedPrices[priceKey(t)] = {
                        usd: p.usd,
                        jpy: toJpy(p.usd, fxRate),
                        change24hPct: p.change24hPct,
                        updatedAt: now,
                        source: t.provider,
                    };
                }
                prices = patchedPrices;
                try {
                    await kvSet("prices:v1", patchedPrices);
                } catch {
                    // no-op
                }
            }
        }

        const majors = attachPrice(universe.majorsTop10, prices);
        const bnb = attachPrice(universe.bnbTop15, prices);
        const polygon = attachPrice(universe.polygonTop15, prices);

        const sortedMovers = [...majors]
            .filter((x) => typeof x.priceChange24h === "number")
            .sort((a, b) => b.priceChange24h - a.priceChange24h);

        const up = sortedMovers.slice(0, 3);
        const down = [...sortedMovers].reverse().slice(0, 3);

        return NextResponse.json({
            ok: true,
            updatedAt: Date.now(),
            fxRate,
            trendTop3: { up, down },
            dexTradableMajorsTop10: majors,
            bnbTop15: bnb,
            polygonTop15: polygon,
            favoritesByUser: Object.fromEntries(
                Object.entries(universe.favoritesByUser ?? {}).map(([uid, list]) => [uid, attachPrice(list, prices)])
            ),
            // Backward compatibility for older callers in lib/dex-service.ts
            universe,
            prices: toLegacyPricesMap(universe.majorsTop10, prices),
        });
    } catch (error: any) {
        console.error("[DashboardAPI] Failed:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
