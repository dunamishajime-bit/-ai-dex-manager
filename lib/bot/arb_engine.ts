import { BOT_CONFIG } from "@/config/botConfig";
import { resolveToken } from "@/lib/tokens";
import { amountUsdToWei, getComparedQuotes } from "@/lib/quote-providers";
import { inventoryManager } from "./inventory_manager";
import { formatUnits } from "viem";

export interface Opportunity {
    lane: "A" | "B";
    chainId: number;
    srcSymbol: string;
    destSymbol: string;
    amountWei: string;
    expectedPnLPct: number;
    expectedPnlUsd?: number;
    provider?: string;
    priceRoute?: any;
}

const BSC_PAIRS = [
    { lane: "A", src: "BNB", dest: "USDT", slippage: BOT_CONFIG.SLIPPAGE.BNB_USDT },
    { lane: "A", src: "BNB", dest: "USD1", slippage: BOT_CONFIG.SLIPPAGE.BNB_USD1 },
    { lane: "B", src: "WLFI", dest: "USD1", slippage: BOT_CONFIG.SLIPPAGE.WLFI_USD1 },
    { lane: "B", src: "ASTER", dest: "USD1", slippage: BOT_CONFIG.SLIPPAGE.ASTER_USD1 },
] as const;

export class ArbEngine {
    /**
     * Scans for opportunities on BSC.
     */
    async scan(): Promise<Opportunity[]> {
        if (!BOT_CONFIG.ENABLE_BSC) return [];

        const opportunities: Opportunity[] = [];
        const chainId = 56;
        const gasPriceWei = "1000000000";

        for (const pair of BSC_PAIRS) {
            try {
                const lane = pair.lane as "A" | "B";
                const laneConfig = lane === "A" ? BOT_CONFIG.LANE_A : BOT_CONFIG.LANE_B;
                const sizeUsd = Math.min(
                    inventoryManager.calculateTradeSize(lane),
                    BOT_CONFIG.ARBITRAGE.MAX_TRADE_USD_SMALL,
                );

                const srcToken = resolveToken(pair.src, chainId);
                const destToken = resolveToken(pair.dest, chainId);
                const srcUsdRef = BOT_CONFIG.REFERENCE_USD[pair.src as keyof typeof BOT_CONFIG.REFERENCE_USD];
                const amountWei = amountUsdToWei(sizeUsd, srcToken, srcUsdRef);
                if (!amountWei) continue;

                const direct = await getComparedQuotes({
                    chainId,
                    srcToken,
                    destToken,
                    amountWei,
                    gasPriceWei,
                    slippageBps: pair.slippage,
                });
                if (!direct.bestQuote) continue;

                const reverse = await getComparedQuotes({
                    chainId,
                    srcToken: destToken,
                    destToken: srcToken,
                    amountWei: direct.bestQuote.expectedOutWei,
                    gasPriceWei,
                    slippageBps: pair.slippage,
                });
                if (!reverse.bestQuote) continue;

                const evaluation = this.evaluateRoundTrip({
                    lane,
                    sizeUsd,
                    pairSlippageBps: pair.slippage,
                    srcSymbol: pair.src,
                    srcToken,
                    amountWei,
                    direct,
                    reverse,
                });

                if (evaluation.shouldTrade && evaluation.expectedPnLPct >= laneConfig.MIN_PNL_PCT) {
                    opportunities.push({
                        lane,
                        chainId,
                        srcSymbol: pair.src,
                        destSymbol: pair.dest,
                        amountWei,
                        expectedPnLPct: evaluation.expectedPnLPct,
                        expectedPnlUsd: evaluation.netPnlUsd,
                        provider: direct.bestProvider || undefined,
                        priceRoute: {
                            directProvider: direct.bestProvider,
                            reverseProvider: reverse.bestProvider,
                            directQuotes: direct.quotes.map((quote) => ({ provider: quote.provider, out: quote.expectedOutWei })),
                            reverseQuotes: reverse.quotes.map((quote) => ({ provider: quote.provider, out: quote.expectedOutWei })),
                        },
                    });
                }
            } catch (e) {
                console.error(`[ARB] Scan error for ${pair.src}/${pair.dest}:`, e);
            }
        }

        return opportunities.sort((a, b) => b.expectedPnLPct - a.expectedPnLPct);
    }

    private evaluateRoundTrip(params: {
        lane: "A" | "B";
        sizeUsd: number;
        pairSlippageBps: number;
        srcSymbol: string;
        srcToken: ReturnType<typeof resolveToken>;
        amountWei: string;
        direct: Awaited<ReturnType<typeof getComparedQuotes>>;
        reverse: Awaited<ReturnType<typeof getComparedQuotes>>;
    }) {
        const { lane, sizeUsd, pairSlippageBps, srcSymbol, srcToken, amountWei, direct, reverse } = params;
        const laneConfig = lane === "A" ? BOT_CONFIG.LANE_A : BOT_CONFIG.LANE_B;
        const srcUsd = direct.bestQuote?.srcUsd
            ?? BOT_CONFIG.REFERENCE_USD[srcSymbol as keyof typeof BOT_CONFIG.REFERENCE_USD]
            ?? 0;

        const inputUnits = Number(formatUnits(BigInt(amountWei), srcToken.decimals));
        const outputUnits = Number(formatUnits(BigInt(reverse.bestQuote!.expectedOutWei), srcToken.decimals));
        const grossPnlUsd = (outputUnits - inputUnits) * srcUsd;

        const gasUnits =
            Number(direct.bestQuote?.gasUnits || 0)
            + Number(reverse.bestQuote?.gasUnits || 0);
        const gasPriceWei =
            Number(direct.bestQuote?.gasPriceWei || reverse.bestQuote?.gasPriceWei || "1000000000");
        const bnbUsd = BOT_CONFIG.REFERENCE_USD.BNB;
        const gasUsd = (gasUnits * gasPriceWei / 1e18) * bnbUsd;

        const slippagePct = pairSlippageBps / 100;
        const extraRiskPct = laneConfig.MEV_MARGIN_PCT + laneConfig.FAILURE_BUFFER_PCT;
        const executionCostUsd = sizeUsd * ((slippagePct + extraRiskPct) / 100);
        const netPnlUsd = grossPnlUsd - gasUsd - executionCostUsd;
        const expectedPnLPct = sizeUsd > 0 ? (netPnlUsd / sizeUsd) * 100 : -999;

        const maxPriceImpact = Math.max(
            direct.bestQuote?.priceImpactPct ?? 0,
            reverse.bestQuote?.priceImpactPct ?? 0,
        );
        const gasSharePct = sizeUsd > 0 ? (gasUsd / sizeUsd) * 100 : 100;
        const shouldTrade =
            sizeUsd <= BOT_CONFIG.ARBITRAGE.SMALL_WALLET_MAX_USD
                ? netPnlUsd >= BOT_CONFIG.ARBITRAGE.MIN_NET_PROFIT_USD
                    && expectedPnLPct >= BOT_CONFIG.ARBITRAGE.MIN_NET_PROFIT_PCT
                    && gasSharePct <= BOT_CONFIG.ARBITRAGE.MAX_GAS_SHARE_PCT
                    && maxPriceImpact <= BOT_CONFIG.ARBITRAGE.MAX_PRICE_IMPACT_PCT
                : expectedPnLPct >= laneConfig.MIN_PNL_PCT;

        return {
            shouldTrade,
            netPnlUsd,
            expectedPnLPct,
            gasUsd,
        };
    }
}

export const arbEngine = new ArbEngine();
