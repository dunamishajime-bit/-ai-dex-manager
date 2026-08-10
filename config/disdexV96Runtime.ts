export const DISDEX_V96_STRATEGY_ID = "DISDEX_V35_STRONG_RESERVED_PENGU_V96" as const;

export const DISDEX_V96_ALLOCATION = {
    researchVersion: 96,
    productionRevision: "CORE_VOLUME50_TURNOVER075_LIVE_R2_GROSS_2P5_PENGU_1P15",
    historicalResearchPr: 73,
    historicalStatus: "V96_FREQUENCY_UPLIFT_HISTORICAL_CLUSTER_USER_APPROVED_FOR_LIVE",
    penguSignalLineage: "PENGU_V67_REPLAYED_BY_PRODUCTION_V46_SIGNAL",
    penguTargetGross: 1.15,
    penguReservationPolicy: "FULL_TARGET_BEFORE_CORE",
    totalGrossCap: 2.5,
    minimumActivePenguClip: 0.50,
    corePolicy: {
        componentVolumeFloor: 0.50,
        weightBandTolerancePct: 5,
        portfolioRebalanceThresholdPct: 7.5,
        forcedRefreshBars: 12,
        strongBoostPct: 30,
        strongBoostCompleted12hGate: {
            momentum20PctMinimum: 15,
            momentum3PctExclusiveMinimum: 0,
            shockPctMinimum: -4,
            skewMaximum: 1.35,
            breadthMinimum: 2,
            requireNoDrawdownGuard: true,
            requireNoWhipsawGuard: true,
            controlledDrawdownPctExclusiveMinimum: -5,
        },
    },
} as const;

export const DISDEX_V96_FORWARD_REQUIREMENTS = {
    policyVersion: 1,
    minimumCalendarDays: 30,
    minimumCompletedDecisionBars: 120,
    minimumClosedLongTrades: 2,
    minimumClosedShortTrades: 2,
    maximumGrossCapBreaches: 0,
    maximumUnknownOrderEvents: 0,
    maximumStateRecoveryFailures: 0,
    requiredMinimumObservedPenguClip: 0.50,
    requireFrozenConfigFingerprint: true,
    requireArtifactSha256: true,
} as const;

export const DISDEX_V96_EXECUTION_PARITY = {
    status: "APPROVED",
    corePort: "V95_WEIGHT_BAND_STRONG_BOOST_TYPESCRIPT_GOLDEN_VECTOR_PASS",
    signalChronologyParity: "APPROVED",
    allocationParity: "APPROVED",
    quantityParity: "APPROVED",
    recoveryParity: "APPROVED",
    goldenVectorSource: "PYTHON_V90_STABILIZE_PLUS_V86_CONTROLLED_CORE_WITH_V96_VOLUME50_TURNOVER075",
    approvalScope: "ALGORITHM_AND_PRODUCTION_EXECUTION_CONTRACT",
} as const;

export const DISDEX_V96_LIVE_PROMOTION = {
    policyVersion: 2,
    operatorOverrideEnabled: true,
    maximumOverridePenguGross: 1.15,
    maximumPortfolioGross: 2.5,
    maximumDailyLossPct: 5,
    requireAbsoluteOrPercentageDailyLossLimit: true,
    killSwitchAction: "FLATTEN_MANAGED",
    killSwitchFailClosed: true,
    requireExplicitV46ServiceHandoff: true,
    allowForwardEvidenceBypassOnlyWithOverride: true,
} as const;

export const DISDEX_V96_RUNTIME = {
    strategyId: DISDEX_V96_STRATEGY_ID,
    implementationStatus: "RETIRED_FROM_LIVE_PENGU_ONLY_BOUNDARY",
    mode: "LIVE_READY" as const,
    // Hard production boundary: legacy V96 remains available for audit/replay only.
    // The PENGU-only supervisor must never authorize this runtime to submit live orders.
    liveTradingEnabled: false,
    maximumGross: DISDEX_V96_ALLOCATION.totalGrossCap,
    minimumExecutionLeverage: 3,
    cashReservePct: 2,
    maximumSlippageBps: 35,
    minimumOrderNotionalUsd: 5,
    rebalanceTolerancePct: 1,
    closeUnmanagedPositions: false,
    orderClientIdPrefix: "v96-",
    stateSchemaVersion: 2,
    stateDirectory: ".runtime-state/disdex-v96",
    forwardEvidenceStatus: "NOT_APPROVED",
    executionParityStatus: DISDEX_V96_EXECUTION_PARITY.status,
    coreExecutionParity: DISDEX_V96_EXECUTION_PARITY.corePort,
    operatorOverrideStatus: "RETIRED_FROM_LIVE",
    dailyLossLimitStatus: "LEGACY_STATE_READ_ONLY_FOR_AUDIT",
    killSwitchStatus: "LEGACY_KILL_SWITCH_RETAINED_FOR_FAIL_CLOSED_AUDIT",
    liveBlockReason: "Legacy V96 live execution is retired. Production crypto execution is PENGU_DUAL_LS_V1 only; V96 state may be read for reconciliation/audit but V96 orders must not be submitted.",
} as const;
