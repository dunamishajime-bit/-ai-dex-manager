import { NextResponse } from "next/server";
import { fetchPricesBatch } from "@/lib/providers/market-providers";
import { TokenRef } from "@/lib/types/market";

export const runtime = "nodejs";

const SYMBOL_TO_PROVIDER_ID: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    SOL: "solana",
    BNB: "binance-coin",
    XRP: "xrp",
    ADA: "cardano",
    AVAX: "avalanche",
    DOGE: "dogecoin",
    TRX: "tron",
    LINK: "chainlink",
    ARB: "arbitrum",
    OP: "optimism",
    POL: "polygon",
    MATIC: "polygon",
    CAKE: "pancakeswap",
    XVS: "venus",
    ALPACA: "alpaca-finance",
    ASTER: "astar",
    ASTR: "astar",
    WLFI: "world-liberty-financial",
    TWT: "trust-wallet-token",
    SHIB: "shiba-inu",
};

function buildTokenRef(input: string): TokenRef {
    const trimmed = input.trim();
    const normalized = trimmed.toUpperCase();
    const mappedProviderId = SYMBOL_TO_PROVIDER_ID[normalized];
    const providerId = mappedProviderId || trimmed.toLowerCase();

    return {
        symbol: normalized,
        provider: "coincap",
        providerId,
        chain: "MAJOR",
    };
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const idsParam = searchParams.get("ids");
        const symbolsParam = searchParams.get("symbols");
        const rawInput = idsParam || symbolsParam || "";
        const ids = rawInput.split(",").map((item) => item.trim()).filter(Boolean);

        if (ids.length === 0) {
            return NextResponse.json({});
        }

        const uniqueInputs = Array.from(new Set(ids));
        const tokensToFetch: TokenRef[] = uniqueInputs.map(buildTokenRef);
        const freshPrices = await fetchPricesBatch(tokensToFetch);

        const out: Record<string, { usd: number; usd_24h_change: number }> = {};
        uniqueInputs.forEach((input) => {
            const upper = input.toUpperCase();
            const providerId = SYMBOL_TO_PROVIDER_ID[upper] || input.toLowerCase();
            const priceData = freshPrices[providerId];
            if (!priceData) return;

            out[input.toLowerCase()] = {
                usd: priceData.usd,
                usd_24h_change: priceData.change24hPct || 0,
            };
        });

        return NextResponse.json(out);
    } catch (error: any) {
        console.error("[PricesAPI] Failed:", error);
        return NextResponse.json({ ok: false, error: "Failed to fetch prices" }, { status: 500 });
    }
}
