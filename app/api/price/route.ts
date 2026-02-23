import { NextResponse } from "next/server";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
    return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol") || "BNBUSDT";

    if (!/^[A-Z0-9]{5,15}$/.test(symbol)) {
        return bad("Invalid symbol");
    }

    try {
        const r = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
            { next: { revalidate: 2 } }
        );

        if (!r.ok) return bad("Binance fetch failed", 502);

        const data = await r.json();

        return NextResponse.json({
            ok: true,
            symbol: data.symbol,
            price: Number(data.price),
        });
    } catch (e: any) {
        return bad(e.message, 500);
    }
}
