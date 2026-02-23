import { BOT_CONFIG } from "@/config/botConfig";

export interface InventoryStats {
    totalUsd: number;
    balances: Record<number, Record<string, number>>; // chainId -> symbol -> amount
    realizedPnL: number;
}

export class InventoryManager {
    private stats: InventoryStats = {
        totalUsd: 5000, // Initial seed approximation
        balances: {
            56: { "USDT": 2500, "BNB": 5 } // Mock initial for calculation
        },
        realizedPnL: 0
    };

    /**
     * Calculates the trade size in USD based on the current total value and lane rules.
     */
    calculateTradeSize(lane: "A" | "B"): number {
        const config = lane === "A" ? BOT_CONFIG.LANE_A : BOT_CONFIG.LANE_B;
        let sizeUsd = (this.stats.totalUsd + this.stats.realizedPnL) * (config.SIZE_PCT / 100);

        // Clip to min/max
        sizeUsd = Math.max(config.MIN_USD, Math.min(config.MAX_USD, sizeUsd));
        return sizeUsd;
    }

    /**
     * Updates realized PnL and total value for compounding.
     */
    addRealizedPnL(pnlUsd: number) {
        this.stats.realizedPnL += pnlUsd;
        console.log(`[INVENTORY] Realized PnL Updated: ${pnlUsd > 0 ? "+" : ""}${pnlUsd.toFixed(2)} USD. Total: ${this.stats.realizedPnL.toFixed(2)}`);
    }

    /**
     * Checks if there's enough balance for a specific direction.
     * Simple threshold check to prevent total depletion.
     */
    isBalanceSufficient(chainId: number, symbol: string, amountWei: string): boolean {
        // In real implementation, this would query the DB or Redis.
        // For now, assume true but log for rebalance warning logic.
        return true;
    }

    getStats() {
        return this.stats;
    }
}

export const inventoryManager = new InventoryManager();
