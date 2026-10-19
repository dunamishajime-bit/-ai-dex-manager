import type {
    AcceptanceDecision,
    AcceptanceGates,
    CandidateStatus,
    AcceptanceStatus,
    BaselineSummary,
    CandidatePolicy,
    CandidateSummary,
    Direction,
    FrozenStageSet,
    ProductionPolicy,
    StageId,
} from "./types";
import { directionForStage, stageAcceptsDirection, strategyForStage } from "./stages";

export type ResearchProductionPolicy = ProductionPolicy;

type CandidateMetricName =
    | "normalDdImprovementBps"
    | "severeDdImprovementBps"
    | "oosDdImprovementBps"
    | "walkForwardImprovementBps"
    | "profitFactorDeclinePct"
    | "finalEquityDeclinePct"
    | "tradeCountRatio"
    | "capacityRegression"
    | "safetyRegression"
    | "costStressPass"
    | "candidateSelectionUsesFuturePnl";

const METRIC_NAMES: readonly CandidateMetricName[] = [
    "normalDdImprovementBps",
    "severeDdImprovementBps",
    "oosDdImprovementBps",
    "walkForwardImprovementBps",
    "profitFactorDeclinePct",
    "finalEquityDeclinePct",
    "tradeCountRatio",
    "capacityRegression",
    "safetyRegression",
    "costStressPass",
    "candidateSelectionUsesFuturePnl",
];

export const DEFAULT_ACCEPTANCE_GATES: AcceptanceGates = Object.freeze({
    sourceHash: "",
    configHash: "",
    resultHash: "",
    policyHash: "",
    maxDrawdownImprovementBps: 100,
    maxProfitFactorDeclinePct: 10,
    oosDrawdownMustNotWorsen: true,
    requireSafetyTests: true,
    reason: "PREDECLARED_DD_REDUCTION_GATES",
    normalDrawdownImprovementBps: 100,
    severeDrawdownImprovementBps: 100,
    oosDrawdownImprovementBps: 0,
    walkForwardImprovementBps: 0,
    maxFinalEquityDeclinePct: 5,
    minTradeCountRatio: 0.9,
    requireCostStress: true,
    gateHash: "PREDECLARED_V1",
});

const CANDIDATE_VALUES = {
    initialStopBps: (base: number): readonly number[] => [Math.max(1, base - 250), base + 250],
    profitFloorBps: (base: number): readonly number[] => [base + 25, base + 50],
    trailingGivebackBps: (base: number): readonly number[] => [Math.max(1, base - 25), base + 25],
    timeStopBars: (base: number | null): readonly (number | null)[] => base === null ? [12, 24] : [Math.max(1, base - 4), base + 4],
} as const;

function asCandidatePolicy(base: ProductionPolicy, candidateId: string, stageId: StageId, direction: Direction, axis: CandidatePolicy["axis"], applicability: CandidatePolicy["applicability"], reason: string, controls: Partial<Pick<ProductionPolicy, "initialStopBps" | "profitFloorBps" | "trailingGivebackBps" | "timeStopBars">> = {}): CandidatePolicy {
    return {
        ...base,
        direction,
        policyHash: `${base.policyHash}:${candidateId}`,
        candidateId,
        stageId,
        axis,
        applicability,
        requestedGross: base.grossCap,
        acceptedGross: base.grossCap,
        reservation: null,
        reason,
        ...controls,
    };
}

function isApplicable(stage: StageId, direction: Direction, baseline: ProductionPolicy): boolean {
    return strategyForStage(stage) === baseline.strategy
        && stageAcceptsDirection(stage, direction)
        && baseline.supportedDirections.includes(direction)
        && (directionForStage(stage) === null || directionForStage(stage) === direction);
}

export function buildCandidateGrid(stage: StageId, direction: Direction, baseline: ProductionPolicy): readonly CandidatePolicy[] {
    if (!isApplicable(stage, direction, baseline)) {
        return [asCandidatePolicy(
            baseline,
            `${stage}:${direction}:NOT_APPLICABLE`,
            stage,
            direction,
            "none",
            "NOT_APPLICABLE",
            "NOT_APPLICABLE",
        )];
    }

    const candidates: CandidatePolicy[] = [];
    for (const value of CANDIDATE_VALUES.initialStopBps(baseline.initialStopBps)) {
        const candidateId = `${stage}:${direction}:initial-stop:${value}`;
        candidates.push(asCandidatePolicy(baseline, candidateId, stage, direction, "initial-stop", "AVAILABLE", "GRID_INITIAL_STOP", { initialStopBps: value }));
    }
    for (const value of CANDIDATE_VALUES.profitFloorBps(baseline.profitFloorBps)) {
        const candidateId = `${stage}:${direction}:profit-floor:${value}`;
        candidates.push(asCandidatePolicy(baseline, candidateId, stage, direction, "profit-floor", "AVAILABLE", "GRID_PROFIT_FLOOR", { profitFloorBps: value }));
    }
    for (const value of CANDIDATE_VALUES.trailingGivebackBps(baseline.trailingGivebackBps)) {
        const candidateId = `${stage}:${direction}:trail:${value}`;
        candidates.push(asCandidatePolicy(baseline, candidateId, stage, direction, "trail", "AVAILABLE", "GRID_TRAIL", { trailingGivebackBps: value }));
    }
    for (const value of CANDIDATE_VALUES.timeStopBars(baseline.timeStopBars)) {
        const candidateId = `${stage}:${direction}:time-stop:${value === null ? "none" : value}`;
        candidates.push(asCandidatePolicy(baseline, candidateId, stage, direction, "time-stop", "AVAILABLE", "GRID_TIME_STOP", { timeStopBars: value }));
    }
    return candidates;
}

export function applyCandidatePolicy(base: ProductionPolicy, candidate: CandidatePolicy): ProductionPolicy {
    if (candidate.applicability !== "AVAILABLE") return { ...base };
    return {
        ...base,
        direction: candidate.direction,
        policyHash: candidate.policyHash,
        reason: candidate.reason,
        initialStopBps: candidate.initialStopBps,
        profitFloorBps: candidate.profitFloorBps,
        trailingGivebackBps: candidate.trailingGivebackBps,
        timeStopBars: candidate.timeStopBars,
    };
}

function metric(metrics: Readonly<Record<string, number>>, name: CandidateMetricName): number | undefined {
    return METRIC_NAMES.includes(name) ? metrics[name] : undefined;
}

function pass(value: number | undefined, predicate: (metricValue: number) => boolean): boolean {
    return value !== undefined && Number.isFinite(value) && predicate(value);
}

function decisionStatus(candidate: CandidateSummary): CandidateStatus {
    return candidate.status ?? "AVAILABLE";
}

export function acceptCandidate(candidate: CandidateSummary, baseline: BaselineSummary, gates: AcceptanceGates): AcceptanceDecision {
    const status = decisionStatus(candidate);
    const common = {
        sourceHash: candidate.sourceHash,
        configHash: candidate.configHash,
        resultHash: candidate.resultHash,
        policyHash: candidate.policyHash,
        fee: candidate.fee,
        funding: candidate.funding,
        slippage: candidate.slippage,
        stageId: candidate.stageId,
        candidateId: candidate.candidateId,
    };

    if (status === "NOT_APPLICABLE") {
        return {
            ...common,
            accepted: false,
            status: "NOT_APPLICABLE",
            reason: "NOT_APPLICABLE",
            gateResults: {},
            candidatePolicy: candidate.candidatePolicy ?? null,
        };
    }

    const metrics = candidate.metrics;
    const requiredNormalDd = gates.normalDrawdownImprovementBps ?? gates.maxDrawdownImprovementBps;
    const requiredSevereDd = gates.severeDrawdownImprovementBps ?? gates.maxDrawdownImprovementBps;
    const requiredOosDd = gates.oosDrawdownImprovementBps ?? 0;
    const requiredWalkForward = gates.walkForwardImprovementBps ?? 0;
    const maxFinalEquityDecline = gates.maxFinalEquityDeclinePct ?? 5;
    const minTradeCountRatio = gates.minTradeCountRatio ?? 0.9;
    const gateResults: Readonly<Record<string, boolean>> = {
        normalDrawdown: pass(metric(metrics, "normalDdImprovementBps"), (value) => value >= requiredNormalDd),
        severeDrawdown: pass(metric(metrics, "severeDdImprovementBps"), (value) => value >= requiredSevereDd),
        outOfSample: gates.oosDrawdownMustNotWorsen
            ? pass(metric(metrics, "oosDdImprovementBps"), (value) => value >= requiredOosDd)
            : pass(metric(metrics, "oosDdImprovementBps"), (value) => value >= requiredOosDd),
        walkForward: pass(metric(metrics, "walkForwardImprovementBps"), (value) => value >= requiredWalkForward),
        profitFactor: pass(metric(metrics, "profitFactorDeclinePct"), (value) => value <= gates.maxProfitFactorDeclinePct),
        finalEquity: pass(metric(metrics, "finalEquityDeclinePct"), (value) => value <= maxFinalEquityDecline),
        tradeCount: pass(metric(metrics, "tradeCountRatio"), (value) => value >= minTradeCountRatio),
        capacity: pass(metric(metrics, "capacityRegression"), (value) => value <= 0),
        safety: gates.requireSafetyTests ? pass(metric(metrics, "safetyRegression"), (value) => value <= 0) : true,
        costStress: gates.requireCostStress === false ? true : pass(metric(metrics, "costStressPass"), (value) => value > 0),
        noFutureSelection: pass(metric(metrics, "candidateSelectionUsesFuturePnl"), (value) => value <= 0),
    };
    const failed = Object.entries(gateResults).filter(([, result]) => !result).map(([name]) => name);
    const accepted = candidate.accepted && candidate.strategy === baseline.strategy && candidate.direction === baseline.direction && failed.length === 0;
    return {
        ...common,
        accepted,
        status: accepted ? "ACCEPTED" : "REJECTED",
        reason: accepted ? "ACCEPTED_ALL_PREDECLARED_GATES" : `REJECTED_GATES:${failed.join(",") || "candidate-or-baseline-mismatch"}`,
        gateResults,
        candidatePolicy: candidate.candidatePolicy ?? null,
    };
}

export function freezeAcceptedStage(previous: FrozenStageSet, decision: AcceptanceDecision): FrozenStageSet {
    const decisions = [...(previous.stageDecisions ?? []), decision];
    if (decision.status !== "ACCEPTED" || decision.candidatePolicy === null || decision.candidatePolicy === undefined) {
        return { ...previous, stageDecisions: decisions, reason: decision.reason };
    }

    const stageIds = decision.stageId !== undefined && !previous.stageIds.includes(decision.stageId)
        ? [...previous.stageIds, decision.stageId]
        : [...previous.stageIds];
    return {
        ...previous,
        sourceHash: decision.sourceHash,
        configHash: decision.configHash,
        resultHash: decision.resultHash,
        policyHash: decision.policyHash,
        stageIds,
        policies: [...previous.policies, decision.candidatePolicy],
        stageDecisions: decisions,
        reason: "FROZEN_RESEARCH_POLICY_ONLY",
    };
}
