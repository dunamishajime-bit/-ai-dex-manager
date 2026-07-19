import type { DisDexPenguRule } from "@/lib/disdex-v35-signal-engine";

/**
 * PENGU V36 and the V38 reversal ensemble both failed the combined
 * development/validation/frozen-holdout gates. The sleeve is excluded rather
 * than reproducing the old fixed list of 17 historical trades.
 */
export const DISDEX_V35_PENGU_RULE: DisDexPenguRule = {
    id: "PENGU_EXCLUDED_V36_V38",
    family: "REVERSAL",
    fast: 14,
    slow: 168,
    threshold: 35,
    volumeFloor: 0,
    btcFilter: "NONE",
    decisionHours: 6,
    holdHours: 72,
    enabled: false,
};

export const DISDEX_V35_RUNTIME = {
    strategyId: "DISDEX_RESILIENT_PROFIT_MAIN_V35",
    liveTradingEnabled: false,
    maximumGross: 2,
    cashReservePct: 2,
    maximumSlippageBps: 35,
    minimumOrderNotionalUsd: 5,
    rebalanceTolerancePct: 1,
    closeUnmanagedPositions: true,
    paperOnlyReason: "Aster V37 found no resilient core-only candidate and PENGU V36/V38 was rejected.",
} as const;
