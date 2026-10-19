export type Direction = "LONG" | "SHORT";
export type StrategyId = "V12_V4" | "PENGU" | "Q102" | "FET" | "HYPE" | "IDLE" | "V52";
export type StageId =
    | "V12_V4_LONG"
    | "V12_V4_SHORT"
    | "Q102_LONG"
    | "Q102_SHORT"
    | "PENGU_LONG"
    | "PENGU_SHORT"
    | "FET"
    | "HYPE_LONG"
    | "IDLE_SHORT"
    | "IDLE_RESIDUAL"
    | "V52";
export type PolicyAxis = "initial-stop" | "profit-floor" | "trail" | "time-stop" | "none";
export type PolicyApplicability = "AVAILABLE" | "NOT_APPLICABLE";
export type AcceptanceStatus = "ACCEPTED" | "REJECTED" | "NOT_APPLICABLE";
export type CandidateStatus = "AVAILABLE" | "NOT_APPLICABLE";
export type StageRunStatus = "ACCEPTED" | "REJECTED" | "BASELINE_PARITY_BLOCKED" | "SOURCE_ERROR" | "NOT_APPLICABLE";

export type JsonPrimitive = string | number | boolean | null;
export interface JsonObject {
    readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface CanonicalSourceInput {
    readonly sourceRoot: string;
    readonly dataRoot: string;
    readonly productionSha: string;
    readonly startTs: number;
    readonly endTs: number;
    readonly initialEquity: number;
    readonly deposits: readonly { readonly ts: number; readonly amount: number }[];
    readonly feeBps: number;
    readonly slippageBps: number;
    readonly fundingSource: string;
}

export interface SourceHash {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
}

export type SourceFileKind = "production" | "candle" | "funding" | "baseline" | "candidate";

export interface SourceFileSnapshot extends SourceHash {
    readonly kind: SourceFileKind;
    readonly content: string;
}

export interface ProductionSource {
    readonly path: string;
    readonly sha256: string;
    readonly content: JsonValue;
}

export interface StrategyConfigSource {
    readonly sourceHash: string;
    readonly strategy: StrategyId;
    readonly configHash: string;
    readonly config: JsonObject;
}

export interface ExecutionBar {
    readonly sourceHash: string;
    readonly ts: number;
    readonly symbol: string;
    readonly timeframe: string;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume: number;
}

export interface CandleSeries {
    readonly sourceHash: string;
    readonly symbol: string;
    readonly timeframe: string;
    readonly bars: readonly ExecutionBar[];
}

export interface FundingRecord {
    readonly sourceHash: string;
    readonly ts: number;
    readonly symbol: string;
    readonly rate: number;
    readonly source: string;
}

export interface Reservation {
    sourceHash: string;
    ts: number;
    requestedGross: number;
    acceptedGross: number;
    reservedGross: number;
    reason: string;
}

export interface ExecutionFill {
    sourceHash: string;
    ts: number;
    price: number;
    quantity: number;
    gross: number;
    fee: number;
    funding: number;
    slippage: number;
    reason: string;
}

export interface ExecutionExit {
    sourceHash: string;
    ts: number;
    price: number;
    quantity: number;
    gross: number;
    fee: number;
    funding: number;
    slippage: number;
    realizedPnl: number;
    reason: string;
}

export interface LifecycleEvidence {
    sourceHash: string;
    ts: number;
    strategy: StrategyId;
    direction: Direction;
    symbol: string;
    requestedGross: number;
    acceptedGross: number;
    reservation: Reservation | null;
    fill: ExecutionFill | null;
    exit: ExecutionExit | null;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    policyHash: string;
    configHash: string;
    resultHash: string;
}

export type CanonicalEventType =
    | "SIGNAL"
    | "CANDIDATE"
    | "RESERVATION"
    | "FILL"
    | "PARTIAL_FILL"
    | "PROTECTION"
    | "EXIT"
    | "RECONCILE";

export interface CanonicalEvent extends LifecycleEvidence {
    eventId: string;
    eventType: CanonicalEventType;
}

export interface CandidateDecision extends LifecycleEvidence {
    candidateId: string;
    accepted: boolean;
    rejectionReason: string | null;
}

export interface BaselineLedgerEntry extends LifecycleEvidence {
    tradeId: string;
    entry: ExecutionFill | null;
    finalExit: ExecutionExit | null;
}

export interface SourceSeriesManifest {
    readonly symbol: string;
    readonly timeframe: string;
    readonly firstTs: number;
    readonly lastTs: number;
    readonly rowCount: number;
    readonly missing: readonly number[];
    readonly duplicates: readonly number[];
    readonly sha256: string;
}

export interface SourceManifest {
    readonly manifestVersion: 1;
    readonly sourceSha: string;
    readonly productionSha: string;
    readonly dataSha: string;
    readonly sourceHashes: readonly SourceHash[];
    readonly series: readonly SourceSeriesManifest[];
    readonly startTs: number;
    readonly endTs: number;
    readonly initialEquity: number;
    readonly deposits: readonly { readonly ts: number; readonly amount: number }[];
    readonly feeBps: number;
    readonly slippageBps: number;
    readonly fundingSource: string;
}

export interface ExpectedSourceSeriesManifest {
    symbol?: string;
    timeframe?: string;
    firstTs?: number;
    lastTs?: number;
    rowCount?: number;
    missing?: readonly number[];
    duplicates?: readonly number[];
    sha256?: string;
}

export interface ExpectedSourceManifest {
    manifestVersion?: 1;
    sourceSha?: string;
    productionSha?: string;
    dataSha?: string;
    sourceHashes?: readonly SourceHash[];
    series?: readonly ExpectedSourceSeriesManifest[];
    startTs?: number;
    endTs?: number;
    initialEquity?: number;
    deposits?: readonly { ts: number; amount: number }[];
    feeBps?: number;
    slippageBps?: number;
    fundingSource?: string;
}

export interface LifecycleEvent extends LifecycleEvidence {
    eventId: string;
    eventType: CanonicalEventType;
    positionId: string;
}

export interface PositionLifecycle {
    sourceHash: string;
    positionId: string;
    strategy: StrategyId;
    direction: Direction;
    symbol: string;
    requestedGross: number;
    acceptedGross: number;
    reservation: Reservation | null;
    entryFill: ExecutionFill | null;
    exit: ExecutionExit | null;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    policyHash: string;
    configHash: string;
    resultHash: string;
    events: readonly LifecycleEvent[];
}

export interface PortfolioState {
    sourceHash: string;
    ts: number;
    cash: number;
    equity: number;
    reservedGross: number;
    acceptedGross: number;
    positions: readonly PositionLifecycle[];
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    policyHash: string;
    configHash: string;
    resultHash: string;
}

export interface ReplayConfig {
    sourceHash: string;
    configHash: string;
    startTs: number;
    endTs: number;
    initialEquity: number;
    feeBps: number;
    slippageBps: number;
    fundingSource: string;
    policyHash: string;
    perStrategyCaps?: Readonly<Record<string, number>>;
    perSymbolCaps?: Readonly<Record<string, number>>;
}

export interface ProtectionPolicy {
    policyHash: string;
    strategy: StrategyId;
    direction: Direction;
    initialStopBps: number;
    profitFloorBps: number;
    trailingGivebackBps: number;
    timeStopBars: number | null;
    configHash: string;
}

export interface IntegratedReplay {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    events: readonly LifecycleEvent[];
    positions: readonly PositionLifecycle[];
    portfolio: readonly PortfolioState[];
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    policyHash: string;
}

export interface TradePath {
    sourceHash: string;
    tradeId: string;
    strategy: StrategyId;
    direction: Direction;
    symbol: string;
    requestedGross: number;
    acceptedGross: number;
    reservation: Reservation | null;
    entry: ExecutionFill | null;
    exit: ExecutionExit | null;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    policyHash: string;
    configHash: string;
    resultHash: string;
    bars: readonly ExecutionBar[];
}

export interface StageResult {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    stageId: string;
    strategy: StrategyId;
    direction: Direction;
    accepted: boolean;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    policyHash: string;
    metrics: Readonly<Record<string, number>>;
    status?: StageRunStatus;
    runId?: string;
    artifactPaths?: readonly string[];
}

export interface StageArtifactIndex {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    stageId: string;
    artifactPaths: readonly string[];
    reason: string;
    policyHash: string;
}

export interface ProductionPolicy {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    strategy: StrategyId;
    direction: Direction;
    policyHash: string;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    entryPolicy: string;
    sizingPolicy: string;
    grossCap: number;
    sharedRiskCap: number;
    marginGuard: string;
    leverage: number;
    initialStopBps: number;
    profitFloorBps: number;
    trailingGivebackBps: number;
    timeStopBars: number | null;
    supportedDirections: readonly Direction[];
    aggregateGrossCap?: number;
    totalGrossCap?: number;
    cryptoGrossCap?: number;
    strategyGrossCap?: number;
    perStrategyGrossCaps?: Readonly<Record<string, number>>;
    perSymbolGrossCaps?: Readonly<Record<string, number>>;
}

export interface CandidatePolicy extends ProductionPolicy {
    candidateId: string;
    stageId: StageId;
    axis: PolicyAxis;
    applicability: PolicyApplicability;
    requestedGross: number;
    acceptedGross: number;
    reservation: Reservation | null;
}

export interface CandidateSummary {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    candidateId: string;
    stageId?: StageId;
    strategy: StrategyId;
    direction: Direction;
    policyHash: string;
    accepted: boolean;
    status?: CandidateStatus;
    candidatePolicy?: CandidatePolicy | null;
    baselinePolicy?: ProductionPolicy;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    metrics: Readonly<Record<string, number>>;
}

export interface BaselineSummary {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    strategy: StrategyId;
    direction: Direction;
    policyHash: string;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    metrics: Readonly<Record<string, number>>;
}

export interface AcceptanceGates {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    policyHash: string;
    maxDrawdownImprovementBps: number;
    maxProfitFactorDeclinePct: number;
    oosDrawdownMustNotWorsen: boolean;
    requireSafetyTests: boolean;
    reason: string;
    normalDrawdownImprovementBps?: number;
    severeDrawdownImprovementBps?: number;
    oosDrawdownImprovementBps?: number;
    walkForwardImprovementBps?: number;
    maxFinalEquityDeclinePct?: number;
    minTradeCountRatio?: number;
    requireCostStress?: boolean;
    declaredAtTs?: number;
    gateHash?: string;
}

export interface AcceptanceDecision {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    policyHash: string;
    accepted: boolean;
    reason: string;
    gateResults: Readonly<Record<string, boolean>>;
    fee: number;
    funding: number;
    slippage: number;
    status?: AcceptanceStatus;
    stageId?: StageId;
    candidateId?: string;
    candidatePolicy?: CandidatePolicy | null;
    strategy?: StrategyId;
    direction?: Direction;
    baselinePolicy?: ProductionPolicy;
}

export interface FrozenStageLineage {
    stageId: StageId;
    status: "ACCEPTED" | "NOT_APPLICABLE";
    sourceHash: string;
    configHash: string;
    resultHash: string;
    policyHash: string;
    candidateId?: string;
    candidatePolicy?: CandidatePolicy | null;
}

export interface FrozenStageSet {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    policyHash: string;
    stageIds: readonly StageId[];
    policies: readonly CandidatePolicy[];
    reason: string;
    stageDecisions?: readonly AcceptanceDecision[];
    completedStageIds?: readonly StageId[];
    stageLineages?: readonly FrozenStageLineage[];
    aggregateHash?: string;
}

export interface ComparisonReport {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    policyHash: string;
    baseline: BaselineSummary;
    candidate: CandidateSummary;
    firstDivergenceTs: number | null;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    directPnl: number;
    lostPriorLogicPnl: number;
    feeDelta: number;
    fundingDelta: number;
    slippageDelta: number;
    grossConflicts: number;
    ddDecomposition: Readonly<Record<string, number>>;
}

export interface AttributionReport {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    policyHash: string;
    strategy: StrategyId;
    direction: Direction;
    symbol: string;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    metrics: Readonly<Record<string, number>>;
}

export interface CanonicalSource {
    readonly input: CanonicalSourceInput;
    readonly productionSha: string;
    readonly productionFiles: readonly SourceFileSnapshot[];
    readonly sourceFiles: readonly SourceFileSnapshot[];
    readonly productionSources: readonly ProductionSource[];
    readonly strategyConfigs: readonly StrategyConfigSource[];
    readonly candleSeries: readonly CandleSeries[];
    readonly funding: readonly FundingRecord[];
    readonly baselineLedger: readonly BaselineLedgerEntry[];
    readonly candidateEvents: readonly CandidateDecision[];
    readonly sourceHashes: readonly SourceHash[];
    readonly manifest?: SourceManifest;
}
