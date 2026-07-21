export const DISDEX_V96_STRATEGY_ID = "DISDEX_V35_STRONG_RESERVED_PENGU_V96" as const;

export const DISDEX_V96_ALLOCATION = {
    researchVersion: 96,
    historicalResearchPr: 56,
    historicalStatus: "V35_STRONG_RESERVED_PENGU_PASS",
    penguSignalLineage: "PENGU_V67_REPLAYED_BY_PRODUCTION_V46_SIGNAL",
    penguTargetGross: 1.15,
    totalGrossCap: 2,
    minimumActivePenguClip: 0.50,
    corePolicy: {
        weightBandTolerancePct: 5,
        portfolioRebalanceThresholdPct: 20,
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
    goldenVectorSource: "PYTHON_V90_STABILIZE_PLUS_V86_CONTROLLED_CORE",
    approvalScope: "ALGORITHM_AND_PRODUCTION_EXECUTION_CONTRACT",
} as const;

export const DISDEX_V96_LIVE_PROMOTION = {
    policyVersion: 1,
    operatorOverrideEnabled: true,
    maximumOverrideValidityHours: 72,
    maximumOverridePenguGross: 0.15,
    maximumPortfolioGross: 2,
    maximumDailyLossPct: 2,
    requireAbsoluteOrPercentageDailyLossLimit: true,
    killSwitchAction: "FLATTEN_MANAGED",
    killSwitchFailClosed: true,
    requireExplicitV46ServiceHandoff: true,
    allowForwardEvidenceBypassOnlyWithOverride: true,
} as const;

export const DISDEX_V96_RUNTIME = {
    strategyId: DISDEX_V96_STRATEGY_ID,
    implementationStatus: "LIVE_READY_OPERATOR_CONTROLLED_EXECUTION_PARITY_APPROVED",
    mode: "LIVE_READY" as const,
    liveTradingEnabled: true,
    maximumGross: DISDEX_V96_ALLOCATION.totalGrossCap,
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
    operatorOverrideStatus: "IMPLEMENTED_REQUIRED_WHEN_FORWARD_NOT_APPROVED",
    dailyLossLimitStatus: "IMPLEMENTED_MAX_2_PERCENT",
    killSwitchStatus: "IMPLEMENTED_FLATTEN_MANAGED_REDUCE_ONLY",
    liveBlockReason: "LIVE requires execution parity plus either approved Forward Evidence or a valid time-limited Operator Override, daily loss controls, Kill Switch configuration, credentials, and explicit V46 service handoff.",
} as const;
