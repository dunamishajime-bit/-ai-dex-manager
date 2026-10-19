import { createHash } from "node:crypto";
import type {
    AcceptanceDecision,
    AcceptanceGates,
    CandidateStatus,
    AcceptanceStatus,
    BaselineSummary,
    CandidatePolicy,
    CandidateSummary,
    Direction,
    FrozenStageLineage,
    FrozenStageSet,
    ProductionPolicy,
    StageId,
    StrategyId,
} from "./types";
import { SEQUENTIAL_STAGES, directionForStage, stageAcceptsDirection, strategyForStage } from "./stages";

export type ResearchProductionPolicy = ProductionPolicy;
export type StrictAcceptanceGates = AcceptanceGates & {
    readonly declaredAtTs: number;
    readonly gateHash: string;
};

function frozenLineageHash(lineages: readonly FrozenStageLineage[]): string {
    const stable = (value: unknown): string => {
        if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
        if (typeof value === "object" && value !== null) {
            return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
        }
        return JSON.stringify(value) ?? "null";
    };
    return createHash("sha256").update(stable(lineages), "utf8").digest("hex");
}

function priorLineages(previous: FrozenStageSet): readonly FrozenStageLineage[] {
    if (previous.stageLineages !== undefined) return previous.stageLineages;
    const decisions = previous.stageDecisions ?? [];
    const completed = previous.completedStageIds ?? previous.stageIds;
    return completed.map((stageId, index) => {
        const decision = decisions[index];
        const policy = previous.policies.find((entry) => entry.stageId === stageId);
        return {
            stageId,
            status: decision?.status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "ACCEPTED",
            sourceHash: decision?.sourceHash ?? policy?.sourceHash ?? previous.sourceHash,
            configHash: decision?.configHash ?? policy?.configHash ?? previous.configHash,
            resultHash: decision?.resultHash ?? policy?.resultHash ?? previous.resultHash,
            policyHash: decision?.policyHash ?? policy?.policyHash ?? previous.policyHash,
            candidateId: decision?.candidateId ?? policy?.candidateId,
            candidatePolicy: decision?.candidatePolicy ?? policy ?? null,
            decisionIndex: decision === undefined ? index : decisions.indexOf(decision),
        };
    });
}

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

const DEFAULT_GATE_MANIFEST: StrictAcceptanceGates = {
    sourceHash: "a".repeat(64),
    configHash: "a".repeat(64),
    resultHash: "a".repeat(64),
    policyHash: "a".repeat(64),
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
    declaredAtTs: 1_700_000_000_000,
    gateHash: "",
};

function gateManifestPayload(gates: AcceptanceGates): string {
    return JSON.stringify({
        sourceHash: gates.sourceHash,
        configHash: gates.configHash,
        resultHash: gates.resultHash,
        policyHash: gates.policyHash,
        maxDrawdownImprovementBps: gates.maxDrawdownImprovementBps,
        maxProfitFactorDeclinePct: gates.maxProfitFactorDeclinePct,
        oosDrawdownMustNotWorsen: gates.oosDrawdownMustNotWorsen,
        requireSafetyTests: gates.requireSafetyTests,
        reason: gates.reason,
        normalDrawdownImprovementBps: gates.normalDrawdownImprovementBps ?? null,
        severeDrawdownImprovementBps: gates.severeDrawdownImprovementBps ?? null,
        oosDrawdownImprovementBps: gates.oosDrawdownImprovementBps ?? null,
        walkForwardImprovementBps: gates.walkForwardImprovementBps ?? null,
        maxFinalEquityDeclinePct: gates.maxFinalEquityDeclinePct ?? null,
        minTradeCountRatio: gates.minTradeCountRatio ?? null,
        requireCostStress: gates.requireCostStress ?? null,
        declaredAtTs: gates.declaredAtTs ?? null,
    });
}

function gateManifestHash(gates: AcceptanceGates): string {
    return createHash("sha256").update(gateManifestPayload(gates), "utf8").digest("hex");
}

export const DEFAULT_ACCEPTANCE_GATES: StrictAcceptanceGates = Object.freeze({
    ...DEFAULT_GATE_MANIFEST,
    gateHash: gateManifestHash(DEFAULT_GATE_MANIFEST),
});

export function predeclareAcceptanceGates(provenance: Pick<AcceptanceGates, "sourceHash" | "configHash" | "resultHash" | "policyHash" | "declaredAtTs">): StrictAcceptanceGates {
    const manifest: StrictAcceptanceGates = {
        ...DEFAULT_GATE_MANIFEST,
        ...provenance,
        gateHash: "",
    };
    return Object.freeze({ ...manifest, gateHash: gateManifestHash(manifest) });
}

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
        policyHash: createHash("sha256").update(`${base.policyHash}:${candidateId}`, "utf8").digest("hex"),
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

function distinctValues<T>(values: readonly T[], baseline: T): readonly T[] {
    return values.filter((value, index) => value !== baseline && values.indexOf(value) === index);
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
    for (const value of distinctValues(CANDIDATE_VALUES.initialStopBps(baseline.initialStopBps), baseline.initialStopBps)) {
        const candidateId = `${stage}:${direction}:initial-stop:${value}`;
        candidates.push(asCandidatePolicy(baseline, candidateId, stage, direction, "initial-stop", "AVAILABLE", "GRID_INITIAL_STOP", { initialStopBps: value }));
    }
    for (const value of distinctValues(CANDIDATE_VALUES.profitFloorBps(baseline.profitFloorBps), baseline.profitFloorBps)) {
        const candidateId = `${stage}:${direction}:profit-floor:${value}`;
        candidates.push(asCandidatePolicy(baseline, candidateId, stage, direction, "profit-floor", "AVAILABLE", "GRID_PROFIT_FLOOR", { profitFloorBps: value }));
    }
    for (const value of distinctValues(CANDIDATE_VALUES.trailingGivebackBps(baseline.trailingGivebackBps), baseline.trailingGivebackBps)) {
        const candidateId = `${stage}:${direction}:trail:${value}`;
        candidates.push(asCandidatePolicy(baseline, candidateId, stage, direction, "trail", "AVAILABLE", "GRID_TRAIL", { trailingGivebackBps: value }));
    }
    for (const value of distinctValues(CANDIDATE_VALUES.timeStopBars(baseline.timeStopBars), baseline.timeStopBars)) {
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

function provenanceFailures(candidate: CandidateSummary, baseline: BaselineSummary, gates: AcceptanceGates): readonly string[] {
    const failures: string[] = [];
    if (gates.declaredAtTs === undefined || !Number.isFinite(gates.declaredAtTs)) failures.push("gates.declaredAtTs");
    if (gates.gateHash === undefined || gates.gateHash !== gateManifestHash(gates)) failures.push("gates.gateHash");
    for (const [name, value] of [["sourceHash", gates.sourceHash], ["configHash", gates.configHash], ["resultHash", gates.resultHash]] as const) {
        if (value.length === 0 || value !== candidate[name] || value !== baseline[name]) failures.push(`provenance.${name}`);
    }
    if (gates.policyHash.length === 0 || gates.policyHash !== baseline.policyHash) failures.push("provenance.policyHash");
    return failures;
}

function stageMetadataFailures(stage: StageId | undefined, strategy: StrategyId | undefined, direction: Direction | undefined): readonly string[] {
    if (stage === undefined || strategy === undefined || direction === undefined) return ["stage.metadata.missing"];
    const failures: string[] = [];
    if (strategyForStage(stage) !== strategy) failures.push("stage.metadata.strategy");
    const expectedDirection = directionForStage(stage);
    if (expectedDirection !== null && expectedDirection !== direction) failures.push("stage.metadata.direction");
    if (!stageAcceptsDirection(stage, direction)) failures.push("stage.metadata.applicability");
    return failures;
}

function baselinePolicyFailures(candidate: CandidateSummary, baseline: BaselineSummary): readonly string[] {
    const base = candidate.baselinePolicy;
    if (base === undefined) return ["baselinePolicy"];
    const failures = stageMetadataFailures(candidate.stageId, candidate.strategy, candidate.direction).slice();
    if (base.strategy !== baseline.strategy) failures.push("baselinePolicy.strategy");
    if (base.policyHash !== baseline.policyHash) failures.push("baselinePolicy.policyHash");
    if (base.sourceHash !== baseline.sourceHash || base.configHash !== baseline.configHash || base.resultHash !== baseline.resultHash) failures.push("baselinePolicy.provenance");
    return failures;
}

function candidatePolicyFailures(candidate: CandidateSummary, baseline: BaselineSummary): readonly string[] {
    const policy = candidate.candidatePolicy;
    const base = candidate.baselinePolicy;
    const failures: string[] = baselinePolicyFailures(candidate, baseline).slice();
    if (policy === undefined || policy === null || policy.applicability !== "AVAILABLE") return ["candidatePolicy"];
    if (base === undefined) return ["baselinePolicy"];
    if (candidate.stageId === undefined || policy.stageId !== candidate.stageId) failures.push("candidatePolicy.stageId");
    if (policy.candidateId !== candidate.candidateId) failures.push("candidatePolicy.candidateId");
    if (policy.strategy !== candidate.strategy || policy.direction !== candidate.direction) failures.push("candidatePolicy.identity");
    failures.push(...stageMetadataFailures(policy.stageId, policy.strategy, policy.direction));
    if (candidate.policyHash !== policy.policyHash) failures.push("candidatePolicy.policyHash");
    if (policy.strategy !== baseline.strategy || base.strategy !== baseline.strategy) failures.push("candidatePolicy.strategy");
    if (policy.sourceHash !== candidate.sourceHash || policy.configHash !== candidate.configHash || policy.resultHash !== candidate.resultHash) failures.push("candidatePolicy.provenance");
    if (base.sourceHash !== baseline.sourceHash || base.configHash !== baseline.configHash || base.resultHash !== baseline.resultHash) failures.push("baselinePolicy.provenance");
    if (policy.entryPolicy !== base.entryPolicy || policy.sizingPolicy !== base.sizingPolicy || policy.grossCap !== base.grossCap || policy.sharedRiskCap !== base.sharedRiskCap || policy.marginGuard !== base.marginGuard || policy.leverage !== base.leverage || policy.supportedDirections.join(",") !== base.supportedDirections.join(",")) {
        failures.push("candidatePolicy.baseline-contract");
    }
    if (!policy.supportedDirections.includes(candidate.direction)) failures.push("candidatePolicy.direction-contract");
    return failures;
}

function rejectedDecision(decision: AcceptanceDecision, reason: string): AcceptanceDecision {
    return { ...decision, accepted: false, status: "REJECTED", reason, candidatePolicy: null };
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
        strategy: candidate.strategy,
        direction: candidate.direction,
        baselinePolicy: candidate.baselinePolicy,
    };

    const provenance = provenanceFailures(candidate, baseline, gates);
    if (provenance.length > 0) {
        return { ...common, accepted: false, status: "REJECTED", reason: `REJECTED_GATES:${provenance.join(",")}`, gateResults: { gates: false }, candidatePolicy: null };
    }

    if (status === "NOT_APPLICABLE") {
        const notApplicableFailures = baselinePolicyFailures(candidate, baseline);
        if (notApplicableFailures.length > 0) {
            return { ...common, accepted: false, status: "REJECTED", reason: `REJECTED_NOT_APPLICABLE:${notApplicableFailures.join(",")}`, gateResults: { applicability: false }, candidatePolicy: null };
        }
        if (candidate.candidatePolicy !== null && candidate.candidatePolicy !== undefined) {
            return { ...common, accepted: false, status: "REJECTED", reason: "REJECTED_candidatePolicy:NOT_APPLICABLE_MUST_HAVE_NO_POLICY", gateResults: { candidatePolicy: false }, candidatePolicy: null };
        }
        if (candidate.baselinePolicy?.supportedDirections.includes(candidate.direction) === true) {
            return { ...common, accepted: false, status: "REJECTED", reason: "REJECTED_NOT_APPLICABLE:SUPPORTED_DIRECTION", gateResults: { applicability: false }, candidatePolicy: null };
        }
        return {
            ...common,
            accepted: false,
            status: "NOT_APPLICABLE",
            reason: "NOT_APPLICABLE",
            gateResults: {},
            candidatePolicy: null,
        };
    }

    const policyFailures = candidatePolicyFailures(candidate, baseline);
    if (policyFailures.length > 0) {
        return { ...common, accepted: false, status: "REJECTED", reason: `REJECTED_candidatePolicy:${policyFailures.join(",")}`, gateResults: { candidatePolicy: false }, candidatePolicy: null };
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
    const completedStageIds = [...(previous.completedStageIds ?? (previous.stageDecisions ?? []).filter((entry) => entry.status === "ACCEPTED" || entry.status === "NOT_APPLICABLE").flatMap((entry) => entry.stageId === undefined ? [] : [entry.stageId]))];
    if (completedStageIds.length === 0 && previous.stageIds.length > 0) completedStageIds.push(...previous.stageIds as StageId[]);
    const lineages = [...priorLineages(previous)];

    const invalidPrefix = completedStageIds.some((stageId, index) => stageId !== SEQUENTIAL_STAGES[index])
        || previous.policies.length !== previous.stageIds.length
        || previous.policies.some((policy, index) => policy.stageId !== previous.stageIds[index]);
    const expectedStage = SEQUENTIAL_STAGES[completedStageIds.length];
    const decisionStage = decision.stageId;

    if (invalidPrefix) {
        return { ...previous, stageDecisions: [...decisions.slice(0, -1), rejectedDecision(decision, "REJECTED_FROZEN_STATE_INVALID")], reason: "REJECTED_FROZEN_STATE_INVALID" };
    }

    if (decision.status === "NOT_APPLICABLE") {
        const decisionMetadataFailures = stageMetadataFailures(decisionStage, decision.strategy, decision.direction);
        const supportedDirection = decision.baselinePolicy?.supportedDirections.includes(decision.direction ?? "LONG") === true;
        if (decision.candidatePolicy !== null && decision.candidatePolicy !== undefined || decisionStage === undefined || expectedStage !== decisionStage || decision.baselinePolicy === undefined || decisionMetadataFailures.length > 0 || supportedDirection) {
            return { ...previous, stageDecisions: [...decisions.slice(0, -1), rejectedDecision(decision, `REJECTED_STAGE_ORDER:expected=${expectedStage ?? "COMPLETE"}`)], reason: `REJECTED_STAGE_ORDER:expected=${expectedStage ?? "COMPLETE"}` };
        }
        const nextLineages = [...lineages, {
            stageId: decisionStage,
            status: "NOT_APPLICABLE" as const,
            sourceHash: decision.sourceHash,
            configHash: decision.configHash,
            resultHash: decision.resultHash,
            policyHash: decision.policyHash,
            candidateId: decision.candidateId,
            candidatePolicy: null,
            decisionIndex: decisions.length - 1,
        }];
        return {
            ...previous,
            stageLineages: nextLineages,
            aggregateHash: frozenLineageHash(nextLineages),
            completedStageIds: [...completedStageIds, decisionStage],
            stageDecisions: decisions,
            reason: "FROZEN_NOT_APPLICABLE_STAGE",
        };
    }

    if (decision.status !== "ACCEPTED" || !decision.accepted || decision.candidatePolicy === null || decision.candidatePolicy === undefined) {
        return { ...previous, stageDecisions: decisions, reason: decision.reason };
    }

    const duplicateStage = decisionStage !== undefined && previous.stageIds.includes(decisionStage);
    const policyMetadataFailures = stageMetadataFailures(decision.candidatePolicy.stageId, decision.candidatePolicy.strategy, decision.candidatePolicy.direction);
    const decisionIdentityMismatch = decision.strategy !== undefined && decision.strategy !== decision.candidatePolicy.strategy || decision.direction !== undefined && decision.direction !== decision.candidatePolicy.direction;
    if (expectedStage === undefined || decisionStage !== expectedStage || duplicateStage || decision.candidatePolicy.stageId !== decisionStage || decision.candidatePolicy.candidateId !== decision.candidateId || decision.candidatePolicy.applicability !== "AVAILABLE" || policyMetadataFailures.length > 0 || decisionIdentityMismatch) {
        const reason = duplicateStage
            ? `REJECTED_DUPLICATE_STAGE:${decisionStage}`
            : `REJECTED_STAGE_ORDER:expected=${expectedStage ?? "COMPLETE"}`;
        return { ...previous, stageDecisions: [...decisions.slice(0, -1), rejectedDecision(decision, reason)], reason };
    }

    const stageIds = [...previous.stageIds, decisionStage];
    const nextLineages = [...lineages, {
        stageId: decisionStage,
        status: "ACCEPTED" as const,
        sourceHash: decision.sourceHash,
        configHash: decision.configHash,
        resultHash: decision.resultHash,
        policyHash: decision.policyHash,
        candidateId: decision.candidateId,
        candidatePolicy: decision.candidatePolicy,
        decisionIndex: decisions.length - 1,
    }];
    return {
        ...previous,
        sourceHash: decision.sourceHash,
        configHash: decision.configHash,
        resultHash: decision.resultHash,
        policyHash: decision.policyHash,
        stageIds,
        policies: [...previous.policies, decision.candidatePolicy],
        completedStageIds: [...completedStageIds, decisionStage],
        stageDecisions: decisions,
        stageLineages: nextLineages,
        aggregateHash: frozenLineageHash(nextLineages),
        reason: "FROZEN_RESEARCH_POLICY_ONLY",
    };
}
