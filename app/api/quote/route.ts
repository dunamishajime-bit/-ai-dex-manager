import { NextRequest, NextResponse } from "next/server";
import { resolveToken } from "@/lib/tokens";
import { BOT_CONFIG } from "@/config/botConfig";

const PARASWAP_API_URL = "https://api.paraswap.io";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const chainId = parseInt(searchParams.get("chainId") || "0");
        const srcSymbol = searchParams.get("srcSymbol");
        const destSymbol = searchParams.get("destSymbol");
        const amountWei = searchParams.get("amountWei");

        if (!chainId || !srcSymbol || !destSymbol || !amountWei) {
            return NextResponse.json({ ok: false, error: "Missing required parameters" }, { status: 400 });
        }

        // Safety Check
        if (chainId === 56 && !BOT_CONFIG.ENABLE_BSC) {
            return NextResponse.json({ ok: false, error: "BSC trading is disabled" }, { status: 400 });
        }
        if (chainId === 137 && !BOT_CONFIG.ENABLE_POLYGON) {
            return NextResponse.json({ ok: false, error: "Polygon trading is disabled" }, { status: 400 });
        }

        const srcToken = resolveToken(srcSymbol, chainId);
        const destToken = resolveToken(destSymbol, chainId);

        const url = `${PARASWAP_API_URL}/prices?srcToken=${srcToken.address}&destToken=${destToken.address}&amount=${amountWei}&network=${chainId}&side=SELL&srcDecimals=${srcToken.decimals}&destDecimals=${destToken.decimals}`;

        const res = await fetch(url);
        const data = await res.json();

        if (!res.ok) {
            return NextResponse.json({ ok: false, error: "ParaSwap Price API error", details: data }, { status: 500 });
        }

        return NextResponse.json({
            ok: true,
            chainId,
            src: srcToken.address,
            dest: destToken.address,
            amountInWei: amountWei,
            expectedOutWei: data.priceRoute.destAmount,
            priceRoute: data.priceRoute,
            gasEstimate: data.priceRoute.gasCost,
            ts: Date.now()
        });

    } catch (error: any) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
