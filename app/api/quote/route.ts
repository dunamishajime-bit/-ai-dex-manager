import { NextRequest, NextResponse } from "next/server";
import { resolveToken } from "@/lib/tokens";
import { BOT_CONFIG } from "@/config/botConfig";
import { getHybridSlippageBps } from "@/config/reclaimHybridStrategy";
import { getComparedQuotes } from "@/lib/quote-providers";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = req.nextUrl;
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
        const srcToken = resolveToken(srcSymbol, chainId);
        const destToken = resolveToken(destSymbol, chainId);
        const pairKey = [srcSymbol, destSymbol].sort().join("_") as keyof typeof BOT_CONFIG.SLIPPAGE;
        const slippageBps = BOT_CONFIG.SLIPPAGE[pairKey] ?? getHybridSlippageBps(srcSymbol, destSymbol);
        const compared = await getComparedQuotes({
            chainId,
            srcToken,
            destToken,
            amountWei,
            slippageBps,
        });

        if (!compared.bestQuote) {
            return NextResponse.json({ ok: false, error: "No quotes available from ParaSwap or OpenOcean" }, { status: 500 });
        }

        const quotes = compared.quotes.map((quote) => ({
            provider: quote.provider,
            expectedOutWei: quote.expectedOutWei,
            gasEstimate: quote.gasUnits,
            notionalUsd: quote.notionalUsd,
            priceImpactPct: quote.priceImpactPct,
        }));

        return NextResponse.json({
            ok: true,
            chainId,
            src: srcToken.address,
            dest: destToken.address,
            amountInWei: amountWei,
            expectedOutWei: compared.bestQuote.expectedOutWei,
            bestProvider: compared.bestProvider,
            providerEdgeBps: compared.providerEdgeBps,
            providerEdgeUsd: compared.providerEdgeUsd,
            quotes,
            priceRoute: compared.bestQuote.provider === "paraswap" ? compared.bestQuote.raw?.priceRoute : null,
            gasEstimate: compared.bestQuote.gasUnits,
            ts: Date.now()
        });

    } catch (error: any) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
