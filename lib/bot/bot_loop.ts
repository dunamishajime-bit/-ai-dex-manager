import { BOT_CONFIG } from "@/config/botConfig";
import { arbEngine } from "./arb_engine";
import { executor } from "./executor";
import { riskGuard } from "./risk_guard";
import { inventoryManager } from "./inventory_manager";

export class BotLoop {
    private intervalId: NodeJS.Timeout | null = null;
    private isScanning = false;

    start() {
        if (this.intervalId) return;

        console.log("🚀 [BOT] Hybrid Trading Bot Started (BSC Focus)");
        console.log(`[BOT] Loop Interval: ${BOT_CONFIG.LOOP_MS}ms`);

        this.intervalId = setInterval(() => this.tick(), BOT_CONFIG.LOOP_MS);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log("🛑 [BOT] Hybrid Trading Bot Stopped");
        }
    }

    private async tick() {
        if (this.isScanning) return;
        this.isScanning = true;

        try {
            // 1. Scan for opportunities
            const opportunities = await arbEngine.scan();

            for (const opp of opportunities) {
                // 2. Check Risk Guard
                if (!riskGuard.isLaneAllowed(opp.lane)) {
                    console.log(`[BOT] Skipping ${opp.lane} opportunity (${opp.srcSymbol}/${opp.destSymbol}) due to Risk Guard.`);
                    continue;
                }

                // 3. Check Inventory (Balance)
                if (!inventoryManager.isBalanceSufficient(opp.chainId, opp.srcSymbol, opp.amountWei)) {
                    console.warn(`[BOT] Insufficient balance for ${opp.srcSymbol}.`);
                    continue;
                }

                // 4. Enqueue for Execution
                console.log(`[BOT] 💥 Executing ${opp.lane} Trade: ${opp.srcSymbol}/${opp.destSymbol} (PnL: +${opp.expectedPnLPct.toFixed(2)}%)`);
                executor.enqueue({
                    chainId: opp.chainId,
                    srcSymbol: opp.srcSymbol,
                    destSymbol: opp.destSymbol,
                    amountWei: opp.amountWei,
                    lane: opp.lane
                });

                // For Lane A, we only do 1 per tick to avoid nonce collisions if ticks are fast
                if (opp.lane === "A") break;
            }

        } catch (error) {
            console.error("[BOT] Loop Tick Error:", error);
        } finally {
            this.isScanning = false;
        }
    }
}

export const botLoop = new BotLoop();
