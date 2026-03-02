import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/kv";
import { Universe, TokenRef } from "@/lib/types/market";

export const runtime = "nodejs";

const STATIC_MAJORS: TokenRef[] = [
    { symbol: "BTC", name: "Bitcoin", chain: "MAJOR", provider: "coincap", providerId: "bitcoin", image: "https://assets.coincap.io/assets/icons/btc@2x.png" },
    { symbol: "ETH", name: "Ethereum", chain: "MAJOR", provider: "coincap", providerId: "ethereum", image: "https://assets.coincap.io/assets/icons/eth@2x.png" },
    { symbol: "SOL", name: "Solana", chain: "MAJOR", provider: "coincap", providerId: "solana", image: "https://assets.coincap.io/assets/icons/sol@2x.png" },
    { symbol: "BNB", name: "BNB", chain: "MAJOR", provider: "coincap", providerId: "binance-coin", image: "https://assets.coincap.io/assets/icons/bnb@2x.png" },
    { symbol: "XRP", name: "XRP", chain: "MAJOR", provider: "coincap", providerId: "xrp", image: "https://assets.coincap.io/assets/icons/xrp@2x.png" },
    { symbol: "ADA", name: "Cardano", chain: "MAJOR", provider: "coincap", providerId: "cardano" },
    { symbol: "AVAX", name: "Avalanche", chain: "MAJOR", provider: "coincap", providerId: "avalanche" },
    { symbol: "DOGE", name: "Dogecoin", chain: "MAJOR", provider: "coincap", providerId: "dogecoin" },
    { symbol: "TRX", name: "TRON", chain: "MAJOR", provider: "coincap", providerId: "tron" },
    { symbol: "LINK", name: "Chainlink", chain: "MAJOR", provider: "coincap", providerId: "chainlink" },
];

const STATIC_BNB: TokenRef[] = [
    { symbol: "CAKE", name: "PancakeSwap", chain: "BNB", provider: "coincap", providerId: "pancakeswap" },
    { symbol: "SHIB", name: "Shiba Inu", chain: "BNB", provider: "coincap", providerId: "shiba-inu" },
    { symbol: "XVS", name: "Venus", chain: "BNB", provider: "coincap", providerId: "venus" },
    { symbol: "ALPACA", name: "Alpaca Finance", chain: "BNB", provider: "coincap", providerId: "alpaca-finance" },
    { symbol: "ASTR", name: "AstarNetwork", chain: "BNB", provider: "coincap", providerId: "astar" },
    { symbol: "TWT", name: "Trust Wallet Token", chain: "BNB", provider: "coincap", providerId: "trust-wallet-token" },
];

const STATIC_POLYGON: TokenRef[] = [
    { symbol: "POL", name: "Polygon Ecosystem Token", chain: "POLYGON", provider: "coincap", providerId: "polygon" },
    { symbol: "QUICK", name: "QuickSwap", chain: "POLYGON", provider: "coincap", providerId: "quickswap" },
    { symbol: "WPOL", name: "Wrapped POL", chain: "POLYGON", provider: "coincap", providerId: "wrapped-matic" },
];

export async function POST() {
    try {
        // 1. Rankings Determination
        // CMC reference would go here if API key is in env.
        // For now, we prioritize absolute stability with 0 external ranking calls.

        const majorsTop10 = [...STATIC_MAJORS];
        const bnbTop15 = [...STATIC_BNB];
        const polygonTop15 = [...STATIC_POLYGON];

        const existingUniverse = await kvGet<Universe>("universe:v1");
        const universe: Universe = {
            majorsTop10,
            bnbTop15,
            polygonTop15,
            favoritesByUser: existingUniverse?.favoritesByUser || {},
            updatedAt: Date.now(),
        };

        await kvSet("universe:v1", universe);

        return NextResponse.json({
            ok: true,
            counts: {
                majors: majorsTop10.length,
                bnb: bnbTop15.length,
                polygon: polygonTop15.length
            },
            source: "static-fallback"
        });
    } catch (error: any) {
        console.error("[RefreshUniverse] Failed:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
