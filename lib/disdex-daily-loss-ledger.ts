export type DailyLossStrategyId = "V96" | "V52";

export interface DailyLossLedgerEntry {
    strategyId: DailyLossStrategyId;
    realizedPnl: number;
    unrealizedPnl: number;
    commission: number;
    funding: number;
    deposits: number;
    withdrawals: number;
    startEquity: number;
    currentEquity: number;
    unattributedDifference: number;
    clientOrderId?: string;
    tradeId?: string;
    positionId?: string;
    timestamp: number;
}

export function createDailyLossLedgerEntry(input: Omit<DailyLossLedgerEntry, "timestamp"> & { timestamp?: number }) {
    return {
        ...input,
        timestamp: input.timestamp ?? Date.now(),
    };
}
