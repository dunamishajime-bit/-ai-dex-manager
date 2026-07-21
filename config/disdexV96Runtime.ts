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

export const DISDEX_V96_RUNTIME = {
    strategyId: DISDEX_V96_STRATEGY_ID,
    implementationStatus: "PRODUCTION_PATH_IMPLEMENTED_EXECUTION_PARITY_APPROVED",
    mode: "PAPER" as const,
    liveTradingEnabled: false,
    maximumGross: DISDEX_V96_ALLOCATION.totalGrossCap,
    cashReservePct: 2,
    maximumSlippageBps: 35,
    minimumOrderNotionalUsd: 5,
    rebalanceTolerancePct: 1,
    closeUnmanagedPositions: false,
    orderClientIdPrefix: "v96-",
    stateSchemaVersion: 1,
    stateDirectory: ".runtime-state/disdex-v96",
    forwardEvidenceStatus: "NOT_APPROVED",
    executionParityStatus: DISDEX_V96_EXECUTION_PARITY.status,
    coreExecutionParity: DISDEX_V96_EXECUTION_PARITY.corePort,
    liveBlockReason: "V96 future Forward Evidence is incomplete. LIVE remains fail-closed until a separately reviewed promotion or operator-controlled override policy is implemented.",
} as const;
