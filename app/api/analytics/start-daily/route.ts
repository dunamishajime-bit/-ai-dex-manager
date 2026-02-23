import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";
import { Universe, TokenRef } from "@/lib/types/market";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const userId = String(body.userId ?? "default");
        const tokens: string[] = body.tokens ?? []; // symbol list

        const universe = (await kvGet<Universe>("universe:v1")) ?? {
            majorsTop10: [],
            bnbTop15: [],
            polygonTop15: [],
            favoritesByUser: {},
            updatedAt: Date.now(),
        };

        // Simple resolution logic: Symbol -> CoinCap ID approximation
        // In a production app, this would use a more robust search/mapping
        const resolved: TokenRef[] = tokens.map(x => ({
            symbol: x.toUpperCase(),
            chain: "MAJOR", // Default to major for favorites if chain is unknown
            provider: "coincap",
            providerId: x.toLowerCase().replace(/\s+/g, '-'),
        }));

        universe.favoritesByUser[userId] = resolved;
        universe.updatedAt = Date.now();

        await kvSet("universe:v1", universe);

        return NextResponse.json({
            ok: true,
            userId,
            favoritesCount: resolved.length,
            message: "Daily analytics started and favorites updated."
        });
    } catch (error: any) {
        console.error("[StartDaily] Failed:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
