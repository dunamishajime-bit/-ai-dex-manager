export type Direction = "LONG" | "SHORT";
export type StrategyId = "V12_V4" | "PENGU" | "Q102" | "FET" | "HYPE" | "IDLE" | "V52";

export type JsonPrimitive = string | number | boolean | null;
export interface JsonObject {
    readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface CanonicalSourceInput {
    sourceRoot: string;
    dataRoot: string;
    productionSha: string;
    startTs: number;
    endTs: number;
    initialEquity: number;
    deposits: readonly { ts: number; amount: number }[];
    feeBps: number;
    slippageBps: number;
    fundingSource: string;
}

export interface SourceHash {
    path: string;
    sha256: string;
    bytes: number;
}

export interface ProductionSource {
    path: string;
    sha256: string;
    content: JsonValue;
}

export interface StrategyConfigSource {
    sourceHash: string;
    strategy: StrategyId;
    configHash: string;
    config: JsonObject;
}

export interface ExecutionBar {
    sourceHash: string;
    ts: number;
    symbol: string;
    timeframe: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface CandleSeries {
    sourceHash: string;
    symbol: string;
    timeframe: string;
    bars: readonly ExecutionBar[];
}

export interface FundingRecord {
    sourceHash: string;
    ts: number;
    symbol: string;
    rate: number;
    source: string;
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
    symbol: string;
    timeframe: string;
    firstTs: number;
    lastTs: number;
    rowCount: number;
    missing: readonly number[];
    duplicates: readonly number[];
    sha256: string;
}

export interface SourceManifest {
    manifestVersion: 1;
    sourceSha: string;
    productionSha: string;
    dataSha: string;
    sourceHashes: readonly SourceHash[];
    series: readonly SourceSeriesManifest[];
    startTs: number;
    endTs: number;
    initialEquity: number;
    deposits: readonly { ts: number; amount: number }[];
    feeBps: number;
    slippageBps: number;
    fundingSource: string;
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
}

export interface CandidatePolicy extends ProductionPolicy {
    candidateId: string;
    requestedGross: number;
    acceptedGross: number;
    reservation: Reservation | null;
}

export interface CandidateSummary {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    candidateId: string;
    strategy: StrategyId;
    direction: Direction;
    policyHash: string;
    accepted: boolean;
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
}

export interface FrozenStageSet {
    sourceHash: string;
    configHash: string;
    resultHash: string;
    policyHash: string;
    stageIds: readonly string[];
    policies: readonly CandidatePolicy[];
    reason: string;
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
    input: CanonicalSourceInput;
    productionSources: readonly ProductionSource[];
    strategyConfigs: readonly StrategyConfigSource[];
    candleSeries: readonly CandleSeries[];
    funding: readonly FundingRecord[];
    baselineLedger: readonly BaselineLedgerEntry[];
    candidateEvents: readonly CandidateDecision[];
    sourceHashes: readonly SourceHash[];
    manifest?: SourceManifest;
}
