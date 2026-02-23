import { NextResponse } from "next/server";
import { kvSet, kvGet } from "@/lib/kv";
import { TokenRef, Universe } from "@/lib/types/market";
import { fetchPricesBatch, fetchUsdJpy } from "@/lib/providers/market-providers";

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
    { symbol: "XVS", name: "Venus", chain: "BNB", provider: "coincap", providerId: "venus" },
    { symbol: "ALPACA", name: "Alpaca Finance", chain: "BNB", provider: "coincap", providerId: "alpaca-finance" },
    { symbol: "ASTR", name: "AstarNetwork", chain: "BNB", provider: "coincap", providerId: "astar" },
    { symbol: "TWT", name: "Trust Wallet Token", chain: "BNB", provider: "coincap", providerId: "trust-wallet-token" },
];

const STATIC_POLYGON: TokenRef[] = [
    { symbol: "POL", name: "Polygon Ecosystem Token", chain: "POLYGON", provider: "coincap", providerId: "polygon" },
    { symbol: "QUICK", name: "QuickSwap", chain: "POLYGON", provider: "coincap", providerId: "quickswap" },
    { symbol: "WMATIC", name: "Wrapped Matic", chain: "POLYGON", provider: "coincap", providerId: "wrapped-matic" },
];

export async function POST(req: Request) {
    try {
        const auth = req.headers.get("Authorization");
        // Simple protection if needed

        // 1. Populate Universe
        const existingUniverse = await kvGet<Universe>("universe:v1");
        const universe: Universe = {
            majorsTop10: STATIC_MAJORS,
            bnbTop15: STATIC_BNB,
            polygonTop15: STATIC_POLYGON,
            favoritesByUser: existingUniverse?.favoritesByUser || {},
            updatedAt: Date.now()
        };
        await kvSet("universe:v1", universe);
        console.log("[Refresh] Universe v1 saved to Redis");

        // 2. Populate Prices
        const allTokens = [...STATIC_MAJORS, ...STATIC_BNB, ...STATIC_POLYGON];
        const prices = await fetchPricesBatch(allTokens);
        if (Object.keys(prices).length > 0) {
            await kvSet("prices:v1", prices);
            console.log("[Refresh] Prices v1 saved to Redis");
        }

        // 3. Populate FX
        const fx = await fetchUsdJpy();
        await kvSet("fx:usd_jpy", fx);
        console.log("[Refresh] FX usd_jpy saved to Redis");

        return NextResponse.json({
            ok: true,
            status: "KV Initialized",
            keys: ["universe:v1", "prices:v1", "fx:usd_jpy"],
            timestamp: Date.now()
        });
    } catch (error: any) {
        console.error("[RefreshAPI] Fail:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
