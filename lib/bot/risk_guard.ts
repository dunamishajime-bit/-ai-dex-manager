import { BOT_CONFIG } from "@/config/botConfig";

export interface TradeResult {
    lane: "A" | "B";
    success: boolean;
    pnlUsd: number;
    timestamp: number;
}

export class RiskGuard {
    private history: TradeResult[] = [];
    private laneBStopUntil: number = 0;
    private globalStopUntil: number = 0;

    /**
     * Registers a trade result and evaluates stop conditions.
     */
    recordResult(result: TradeResult) {
        this.history.push(result);
        if (this.history.length > 50) this.history.shift(); // Keep recent

        this.evaluateStops();
    }

    private evaluateStops() {
        const now = Date.now();

        // 1. Global Drawdown Check (Last N trades)
        const recent = this.history.slice(-BOT_CONFIG.WIN_LOSS_SAMPLES);
        if (recent.length === BOT_CONFIG.WIN_LOSS_SAMPLES) {
            const sumPnl = recent.reduce((acc, r) => acc + r.pnlUsd, 0);
            // Assuming 5000 base for % calculation
            const pnlPct = (sumPnl / 5000) * 100;

            if (pnlPct <= BOT_CONFIG.STOP_LOSS_MOVING_SUM_PCT) {
                console.warn(`[RISK] Global Drawdown hit (${pnlPct.toFixed(2)}%). Stopping all lanes for 30m.`);
                this.globalStopUntil = now + BOT_CONFIG.COOLDOWN_MS_DRAWDOWN;
            }
        }

        // 2. Lane B Consecutive Failure Check
        const recentB = this.history.filter(r => r.lane === "B").slice(-BOT_CONFIG.LANE_B_STOP_LOSES);
        if (recentB.length === BOT_CONFIG.LANE_B_STOP_LOSES && recentB.every(r => !r.success)) {
            console.warn(`[RISK] Lane B consecutive failures. Stopping Lane B for 60m.`);
            this.laneBStopUntil = now + BOT_CONFIG.COOLDOWN_MS_LANE_B;
        }
    }

    /**
     * Checks if a lane is currently allowed to trade.
     */
    isLaneAllowed(lane: "A" | "B"): boolean {
        const now = Date.now();
        if (now < this.globalStopUntil) return false;
        if (lane === "B" && now < this.laneBStopUntil) return false;
        return true;
    }

    getStatus() {
        const now = Date.now();
        return {
            isGlobalStopped: now < this.globalStopUntil,
            isLaneBStopped: now < this.laneBStopUntil,
            historySize: this.history.length
        };
    }
}

export const riskGuard = new RiskGuard();
