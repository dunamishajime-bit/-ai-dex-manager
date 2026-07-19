import type { DisDexPenguRule } from "@/lib/disdex-v35-signal-engine";

/**
 * Replaced by the frozen V36 selection after its development/validation/holdout
 * workflow succeeds. Until then PENGU is deliberately disabled.
 */
export const DISDEX_V35_PENGU_RULE: DisDexPenguRule = {
    id: "PENGU_RULE_PENDING_V36",
    family: "TREND",
    fast: 24,
    slow: 168,
    threshold: 2,
    volumeFloor: 1,
    btcFilter: "RISK",
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
} as const;
