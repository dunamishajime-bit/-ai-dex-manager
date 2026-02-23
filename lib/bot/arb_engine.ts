import { BOT_CONFIG } from "@/config/botConfig";
import { resolveToken } from "@/lib/tokens";
import { inventoryManager } from "./inventory_manager";

export interface Opportunity {
    lane: "A" | "B";
    chainId: number;
    srcSymbol: string;
    destSymbol: string;
    amountWei: string;
    expectedPnLPct: number;
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

        for (const pair of BSC_PAIRS) {
            try {
                const lane = pair.lane as "A" | "B";
                const sizeUsd = inventoryManager.calculateTradeSize(lane);

                // Convert USD size to Wei (Approximation for quote)
                // In a real bot, we'd use current market price for this conversion.
                // Here we fetch the price through the quote API itself by sending a dummy small amount or pre-calculating.
                // For simplicity, let's assume we can calculate it.
                const amountWei = "10000000000000000"; // Dummy amount for example

                const quoteUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/quote?chainId=${chainId}&srcSymbol=${pair.src}&destSymbol=${pair.dest}&amountWei=${amountWei}`;
                const res = await fetch(quoteUrl);
                const data = await res.json();

                if (!data.ok) continue;

                const score = this.calculateScore(lane, pair.src, pair.dest, data);
                if (score >= (lane === "A" ? BOT_CONFIG.LANE_A.MIN_PNL_PCT : BOT_CONFIG.LANE_B.MIN_PNL_PCT)) {
                    opportunities.push({
                        lane,
                        chainId,
                        srcSymbol: pair.src,
                        destSymbol: pair.dest,
                        amountWei,
                        expectedPnLPct: score,
                        priceRoute: data.priceRoute
                    });
                }
            } catch (e) {
                console.error(`[ARB] Scan error for ${pair.src}/${pair.dest}:`, e);
            }
        }

        return opportunities.sort((a, b) => b.expectedPnLPct - a.expectedPnLPct);
    }

    private calculateScore(lane: "A" | "B", src: string, dest: string, data: any): number {
        const laneConfig = lane === "A" ? BOT_CONFIG.LANE_A : BOT_CONFIG.LANE_B;

        // Gross Edge (Simplified example: ParaSwap often returns savings or better prices)
        const grossEdgePct = 1.5; // Mock edge from price comparison

        // Costs
        const gasUsd = (Number(data.gasEstimate) / 1e18) * 600; // Mock BNB price
        const tradeUsd = 100; // Mock current trade size
        const costPct = (gasUsd / tradeUsd) * 100;

        const slippageBps = (lane === "A" && src === "BNB" && dest === "USDT") ? BOT_CONFIG.SLIPPAGE.BNB_USDT : 100;
        const slippagePct = slippageBps / 100;

        const mevMargin = laneConfig.MEV_MARGIN_PCT;
        const failureBuffer = laneConfig.FAILURE_BUFFER_PCT;

        const expectedPnLPct = grossEdgePct - costPct - slippagePct - mevMargin - failureBuffer;

        return expectedPnLPct;
    }
}

export const arbEngine = new ArbEngine();
