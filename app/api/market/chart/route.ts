import { NextResponse } from "next/server";
import { fetchHistory } from "@/lib/providers/market-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapSymbolToCoinCapId(symbol: string): string {
    const s = symbol.toUpperCase();
    const mapping: Record<string, string> = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "SOL": "solana",
        "BNB": "binance-coin",
        "POL": "polygon",
        "XRP": "xrp",
        "DOGE": "dogecoin",
        "ADA": "cardano",
        "DOT": "polkadot",
        "LINK": "chainlink",
        "CAKE": "pancakeswap",
        "SHIB": "shiba-inu",
        "AVAX": "avalanche",
        "TRX": "tron",
        "USDT": "tether",
        "USDC": "usd-coin",
        "WBTC": "wrapped-bitcoin",
    };
    if (mapping[s]) return mapping[s];

    const geckoToCoinCap: Record<string, string> = {
        "binancecoin": "binance-coin",
        "avalanche-2": "avalanche",
        "pol-network": "polygon",
        "pol": "polygon",
        "binance-coin": "binance-coin",
        "usd-coin": "usd-coin",
    };
    const lower = symbol.toLowerCase();
    return geckoToCoinCap[lower] || lower;
}

function mapIdToBinanceSymbol(id: string): string | null {
    const key = id.toLowerCase();
    const mapping: Record<string, string> = {
        bitcoin: "BTCUSDT",
        btc: "BTCUSDT",
        ethereum: "ETHUSDT",
        eth: "ETHUSDT",
        solana: "SOLUSDT",
        sol: "SOLUSDT",
        "binance-coin": "BNBUSDT",
        bnb: "BNBUSDT",
        polygon: "POLUSDT",
        pol: "POLUSDT",
        xrp: "XRPUSDT",
        dogecoin: "DOGEUSDT",
        doge: "DOGEUSDT",
        cardano: "ADAUSDT",
        ada: "ADAUSDT",
        polkadot: "DOTUSDT",
        dot: "DOTUSDT",
        chainlink: "LINKUSDT",
        link: "LINKUSDT",
        pancakeswap: "CAKEUSDT",
        cake: "CAKEUSDT",
        "shiba-inu": "SHIBUSDT",
        shib: "SHIBUSDT",
        avalanche: "AVAXUSDT",
        avax: "AVAXUSDT",
        tron: "TRXUSDT",
        trx: "TRXUSDT",
    };
    return mapping[key] || null;
}

function mapIdToAssetSymbol(id: string): string | null {
    const key = id.toLowerCase();
    const mapping: Record<string, string> = {
        bitcoin: "BTC",
        btc: "BTC",
        ethereum: "ETH",
        eth: "ETH",
        solana: "SOL",
        sol: "SOL",
        "binance-coin": "BNB",
        bnb: "BNB",
        polygon: "POL",
        pol: "POL",
        xrp: "XRP",
        dogecoin: "DOGE",
        doge: "DOGE",
        cardano: "ADA",
        ada: "ADA",
        polkadot: "DOT",
        dot: "DOT",
        chainlink: "LINK",
        link: "LINK",
        pancakeswap: "CAKE",
        cake: "CAKE",
        "shiba-inu": "SHIB",
        shib: "SHIB",
        avalanche: "AVAX",
        avax: "AVAX",
        tron: "TRX",
        trx: "TRX",
    };
    return mapping[key] || null;
}

function intervalFromDays(days: number): string {
    if (days <= 1) return "15m";
    if (days <= 7) return "1h";
    if (days <= 30) return "4h";
    return "1d";
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
        const parsedDays = Math.max(1, Number.parseInt(days, 10) || 7);

        // Map days to CoinCap interval
        let interval = "d1";
        const d = parsedDays;
        if (d <= 1) interval = "m15";
        else if (d <= 7) interval = "h1";
        else if (d <= 30) interval = "h6";

        let prices: number[][] = [];

        // Primary: Binance Kline (stable and no key for major pairs)
        const binanceSymbol = mapIdToBinanceSymbol(providerId) || mapIdToBinanceSymbol(id);
        if (binanceSymbol) {
            const binanceInterval = intervalFromDays(parsedDays);
            const limit = binanceInterval === "15m" ? 96 : binanceInterval === "1h" ? Math.min(parsedDays * 24, 1000) : binanceInterval === "4h" ? Math.min(parsedDays * 6, 1000) : Math.min(parsedDays, 1000);
            const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&limit=${limit}`;
            const binanceRes = await fetch(binanceUrl, { cache: "no-store" });
            if (binanceRes.ok) {
                const rows = await binanceRes.json();
                if (Array.isArray(rows)) {
                    prices = rows.map((r: any) => [Number(r?.[0]), Number(r?.[4])]).filter((p: number[]) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
                }
            }
        }

        // Secondary: CryptoCompare (no key for low-volume usage)
        if (prices.length === 0) {
            const fsym = mapIdToAssetSymbol(providerId) || mapIdToAssetSymbol(id);
            if (fsym) {
                const ccEndpoint = parsedDays <= 1
                    ? `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${fsym}&tsym=USD&limit=96&aggregate=15`
                    : parsedDays <= 30
                        ? `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${fsym}&tsym=USD&limit=${Math.min(parsedDays * 24, 2000)}`
                        : `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${fsym}&tsym=USD&limit=${Math.min(parsedDays, 2000)}`;
                const ccRes = await fetch(ccEndpoint, { cache: "no-store" });
                if (ccRes.ok) {
                    const ccJson = await ccRes.json();
                    const rows = ccJson?.Data?.Data;
                    if (Array.isArray(rows)) {
                        prices = rows
                            .map((r: any) => [Number(r?.time) * 1000, Number(r?.close)])
                            .filter((p: number[]) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
                    }
                }
            }
        }

        // Tertiary: existing CoinCap history if the above returned nothing
        if (prices.length === 0) {
            const data = await fetchHistory(providerId, interval);
            prices = data
                .map((point: any) => [Number(point?.time), Number(point?.priceUsd)])
                .filter((p: number[]) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        }

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
