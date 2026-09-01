/**
 * Immutable identity and limits for the verified Quality102 MTM Source Run.
 * Importing this module has no side effects and cannot enable live execution.
 */
export const STRICT_BT33404708902 = Object.freeze({
    sourceRun: "33404708902",
    sourceSha: "aec066fefd761b12f07e6927b5f2a524f88ca08b",
    grossPolicy: "BASE_PRIORITY_CRYPTO_AND_TOTAL_RESIDUAL_GROSS_SHRINK",
    resizePnlAccounting: "MARK_TO_MARKET_BINANCE_VISION_USDM_1M_OPEN",
    sourceValidation: "ALL_102_FROZEN_RESEARCH_1H_OPEN_CROSSCHECK_FAIL_CLOSED",
    quality102PositionCap: 0.5,
    cryptoGrossCap: 2,
    totalGrossCap: 2.5,
    stockGrossCap: 1.5,
    v12MaximumGross: 1.5,
    v12MaximumPositions: 1,
    penguMaximumGross: 0.75,
    quality102LiveSelectorParity: false,
    quality102LiveBlockedFailClosed: true,
    liveActivated: false,
    researchOnly: true,
} as const);

export type StrictBtBaseStrategy = "V12" | "PENGU_DUAL_LS_V2" | "V11_EQ" | "V50_POST_OPEN_BASIS" | "V52";
