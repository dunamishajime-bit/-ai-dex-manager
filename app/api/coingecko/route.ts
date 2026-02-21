import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

const COINGECKO_API = "https://api.coingecko.com/api/v3";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path");

    if (!path) {
        return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
    }

    const url = `${COINGECKO_API}${path}`;

    try {
        const response = await fetch(url, {
            headers: {
                "Accept": "application/json",
            },
            next: { revalidate: 30 }, // ISR: 30秒キャッシュ
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `CoinGecko API error: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();

        return NextResponse.json(data, {
            headers: {
                "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
            },
        });
    } catch (error) {
        console.error("[CoinGecko Proxy] Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch from CoinGecko" },
            { status: 502 }
        );
    }
}
