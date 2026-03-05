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
    { symbol: "SHIB", name: "Shiba Inu", chain: "MAJOR", provider: "coincap", providerId: "shiba-inu" },
    { symbol: "TRX", name: "TRON", chain: "MAJOR", provider: "coincap", providerId: "tron" },
    { symbol: "LINK", name: "Chainlink", chain: "MAJOR", provider: "coincap", providerId: "chainlink" },
    { symbol: "ARB", name: "Arbitrum", chain: "MAJOR", provider: "coincap", providerId: "arbitrum" },
    { symbol: "OP", name: "Optimism", chain: "MAJOR", provider: "coincap", providerId: "optimism" },
];

const STATIC_BNB: TokenRef[] = [
    { symbol: "CAKE", name: "PancakeSwap", chain: "BNB", provider: "coincap", providerId: "pancakeswap" },
    { symbol: "XVS", name: "Venus", chain: "BNB", provider: "coincap", providerId: "venus" },
    { symbol: "ALPACA", name: "Alpaca Finance", chain: "BNB", provider: "coincap", providerId: "alpaca-finance" },
    { symbol: "ASTER", name: "Aster", chain: "BNB", provider: "coincap", providerId: "astar" },
    { symbol: "WLFI", name: "World Liberty Financial", chain: "BNB", provider: "coincap", providerId: "world-liberty-financial" },
    { symbol: "TWT", name: "Trust Wallet Token", chain: "BNB", provider: "coincap", providerId: "trust-wallet-token" },
];

const STATIC_POLYGON: TokenRef[] = [
    { symbol: "POL", name: "Polygon Ecosystem Token", chain: "POLYGON", provider: "coincap", providerId: "polygon" },
    { symbol: "QUICK", name: "QuickSwap", chain: "POLYGON", provider: "coincap", providerId: "quickswap" },
];

export async function POST() {
    try {
        const existingUniverse = await kvGet<Universe>("universe:v1");
        const universe: Universe = {
            majorsTop10: [...STATIC_MAJORS],
            bnbTop15: [...STATIC_BNB],
            polygonTop15: [...STATIC_POLYGON],
            favoritesByUser: existingUniverse?.favoritesByUser || {},
            updatedAt: Date.now(),
        };

        await kvSet("universe:v1", universe);

        return NextResponse.json({
            ok: true,
            counts: {
                majors: universe.majorsTop10.length,
                bnb: universe.bnbTop15.length,
                polygon: universe.polygonTop15.length,
            },
            source: "static-fallback",
        });
    } catch (error: any) {
        console.error("[RefreshUniverse] Failed:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
