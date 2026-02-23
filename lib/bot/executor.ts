import { BOT_CONFIG } from "@/config/botConfig";
import { riskGuard } from "./risk_guard";
import { inventoryManager } from "./inventory_manager";

export interface QueuedTrade {
    chainId: number;
    srcSymbol: string;
    destSymbol: string;
    amountWei: string;
    lane: "A" | "B";
}

export class Executor {
    private bscQueue: QueuedTrade[] = [];
    private isProcessingBsc = false;
    private bscNonce: number | null = null;

    /**
     * Adds a trade to the chain-specific queue.
     */
    enqueue(trade: QueuedTrade) {
        if (trade.chainId === 56) {
            if (this.bscQueue.length < 5) { // Cap queue size
                this.bscQueue.push(trade);
                this.processBscQueue();
            }
        }
    }

    private async processBscQueue() {
        if (this.isProcessingBsc || this.bscQueue.length === 0) return;
        this.isProcessingBsc = true;

        const trade = this.bscQueue.shift()!;
        try {
            console.log(`[EXECUTOR] Processing BSC Trade: ${trade.srcSymbol} -> ${trade.destSymbol} (${trade.lane})`);

            const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/trade`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(trade)
            });
            const data = await res.json();

            if (data.ok) {
                console.log(`[EXECUTOR] Success! Tx: ${data.txHash}`);
                // Record result in Risk Guard and Inventory (omitted for brevity in loop)
            } else {
                console.error(`[EXECUTOR] Failed: ${data.error}`);
            }
        } catch (e) {
            console.error(`[EXECUTOR] Unexpected Error:`, e);
        } finally {
            this.isProcessingBsc = false;
            this.processBscQueue(); // Check for next
        }
    }
}

export const executor = new Executor();
