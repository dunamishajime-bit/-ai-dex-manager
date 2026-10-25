/** Data-only order intent contracts. No score-based funding allocator. */
export type DynamicAssetClass = "CRYPTO" | "STOCK";

export type DynamicBtPriorMetrics = {
    returnPct: number;
    profitFactor: number;
    winRatePct: number;
    maxDrawdownPct: number;
    tradeCount: number;
    observationDays: number;
};

export type DynamicEntryCandidate = {
    id: string;
    strategy: string;
    symbol: string;
    side: "LONG" | "SHORT";
    assetClass: DynamicAssetClass;
    marketFitScore: number;
    /** Causal producer provenance; optional for existing research callers. */
    scoreSource?: string;
    signalTs?: number;
    idempotencyKey?: string;
    targetGross: number;
    minGross: number;
    maxGross: number;
    minNotionalUsd?: number;
    btPrior?: DynamicBtPriorMetrics;
    btPriorVersion?: string;
    correlationPenalty?: number;
    concentrationPenalty?: number;
    stalePenalty?: number;
};

export type DynamicEntryAllocation = DynamicEntryCandidate & {
    btPriorBonus: number;
    finalScore: number;
    allocatedGross: number;
};

export type DynamicEntryAllocationResult = {
    allocations: DynamicEntryAllocation[];
    rejected: Array<{ id: string; reason: string }>;
    residual: { cryptoGross: number; stockGross: number; totalGross: number };
};
