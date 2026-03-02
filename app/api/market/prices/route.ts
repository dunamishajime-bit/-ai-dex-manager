import { NextResponse } from "next/server";
import { fetchPricesBatch } from "@/lib/providers/market-providers";
import { TokenRef } from "@/lib/types/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_TO_COINGECKO: Record<string, string> = {
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
    POL: "polygon",
    CAKE: "pancakeswap",
    SHIB: "shiba-inu",
    XVS: "venus",
    ALPACA: "alpaca-finance",
    ASTR: "astar",
    TWT: "trust-wallet-token",
    QUICK: "quickswap",
    WPOL: "wrapped-matic",
    USDT: "tether",
    USDC: "usd-coin",
};

const ID_TO_SYMBOL: Record<string, string> = {
    bitcoin: "BTC",
    ethereum: "ETH",
    solana: "SOL",
    "binance-coin": "BNB",
    xrp: "XRP",
    cardano: "ADA",
    avalanche: "AVAX",
    dogecoin: "DOGE",
    tron: "TRX",
    chainlink: "LINK",
    polygon: "POL",
    pancakeswap: "CAKE",
    "shiba-inu": "SHIB",
    venus: "XVS",
    "alpaca-finance": "ALPACA",
    astar: "ASTR",
    "trust-wallet-token": "TWT",
    quickswap: "QUICK",
    "wrapped-matic": "WPOL",
    tether: "USDT",
    "usd-coin": "USDC",
};

function normalizeInputToken(input: string): { symbol: string; providerId: string } {
    const raw = String(input || "").trim();
    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();

    // 1) symbol -> provider id
    if (SYMBOL_TO_COINGECKO[upper]) {
        return { symbol: upper, providerId: SYMBOL_TO_COINGECKO[upper] };
    }

    // 2) provider id -> symbol
    if (ID_TO_SYMBOL[lower]) {
        const symbol = ID_TO_SYMBOL[lower];
        return { symbol, providerId: lower };
    }

    // 3) fallback: treat as symbol-ish
    return { symbol: upper, providerId: lower };
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const raw =
            searchParams.get("ids") ??
            searchParams.get("symbols") ??
            "";

        const inputs = raw.split(",").map((x) => x.trim()).filter(Boolean);

        if (inputs.length === 0) {
            return NextResponse.json({
                prices: {},
                updatedAt: Date.now(),
                source: "fallback",
            });
        }

        const normalized = inputs.map(normalizeInputToken);

        const tokensToFetch: TokenRef[] = normalized.map((n) => ({
            symbol: n.symbol,
            provider: "coincap",
            providerId: n.providerId,
            chain: "MAJOR",
        }));

        const freshPrices = await fetchPricesBatch(tokensToFetch);

        const out: Record<string, any> = {};
        for (const n of normalized) {
            const priceData = freshPrices[n.providerId] || freshPrices[n.symbol] || freshPrices[n.symbol.toLowerCase()];
            if (!priceData) continue;
            out[n.symbol.toLowerCase()] = {
                usd: priceData.usd,
                usd_24h_change: priceData.change24hPct,
            };
        }

        return NextResponse.json(out);
    } catch (error: any) {
        console.error("[PricesAPI] Failed:", error);
        return NextResponse.json({ ok: false, error: "Failed to fetch prices" }, { status: 500 });
    }
}
