import { NextResponse } from "next/server";
import { fetchHistory } from "@/lib/providers/market-providers";

export const runtime = "nodejs";

function mapSymbolToCoinCapId(symbol: string): string {
    const s = symbol.toUpperCase();
    const mapping: Record<string, string> = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "SOL": "solana",
        "BNB": "binance-coin",
        "POL": "polygon",
        "MATIC": "polygon",
        "XRP": "xrp",
        "DOGE": "dogecoin",
        "ADA": "cardano",
        "DOT": "polkadot",
        "LINK": "chainlink",
        "AVAX": "avalanche",
        "TRX": "tron",
        "USDT": "tether",
        "USDC": "usd-coin",
        "WBTC": "wrapped-bitcoin",
    };
    return mapping[s] || symbol.toLowerCase();
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        const days = searchParams.get("days") || "7";

        if (!id) {
            return NextResponse.json({ ok: false, error: "ID required" }, { status: 400 });
        }

        const providerId = mapSymbolToCoinCapId(id);

        // Map days to CoinCap interval
        let interval = "d1";
        const d = parseInt(days);
        if (d <= 1) interval = "m15";
        else if (d <= 7) interval = "h1";
        else if (d <= 30) interval = "h6";

        const data = await fetchHistory(providerId, interval);

        // Format to match what AutoTradeSimulator expects (prices: [ [ms, price], ... ])
        const prices = data.map((point: any) => [
            point.time,
            parseFloat(point.priceUsd)
        ]);

        return NextResponse.json({
            ok: true,
            id: providerId,
            prices
        });
    } catch (error: any) {
        console.error("[ChartAPI] Failed:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
