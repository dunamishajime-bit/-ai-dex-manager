import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { replayIntegrated, type IntegratedReplayResult, type ReplayConfigWithRuntime } from "../../lib/backtest/dd-reduction/emulator";
import { acceptCandidate, buildCandidateGrid, freezeAcceptedStage, predeclareAcceptanceGates } from "../../lib/backtest/dd-reduction/policies";
import { loadCanonicalSource } from "../../lib/backtest/dd-reduction/source";
import { SEQUENTIAL_STAGES, stageAcceptsDirection, strategyForStage } from "../../lib/backtest/dd-reduction/stages";
import type {
    BaselineSummary,
    CandidatePolicy,
    CandidateSummary,
    CanonicalSource,
    FrozenStageSet,
    ProductionPolicy,
    StageResult,
    StageRunStatus,
} from "../../lib/backtest/dd-reduction/types";
import {
    assertRunnerOutputRoot,
    buildConfigHash,
    buildRunId,
    evaluateBaselineParity,
    hashEvaluationEvidence,
    hashFrozenStageSet,
    loadFrozenStageSet,
    parseRunnerArgs,
    policyFromSource,
    type EvaluationEvidence,
    type RunnerArgs,
    writeFrozenStageSet,
} from "./run-baseline";
import { compareStage } from "./compare-stage";
import { writeStageArtifacts } from "../../lib/backtest/dd-reduction/reporting";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonObject, JsonValue, StageId } from "../../lib/backtest/dd-reduction/types";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "unknown stage runner error";
}

function lineagePolicy(policy: ProductionPolicy, sourceHash: string, configHash: string, resultHash: string): ProductionPolicy {
    return { ...policy, sourceHash, configHash, resultHash };
}

export function buildReplayPolicySet(frozen: FrozenStageSet, current: ProductionPolicy): readonly ProductionPolicy[] {
    const policies = new Map<string, ProductionPolicy>();
    for (const policy of frozen.policies) policies.set(`${policy.strategy}:${policy.direction}`, policy);
    policies.set(`${current.strategy}:${current.direction}`, current);
    return [...policies.values()];
}

function directionPolicies(current: ProductionPolicy): ReplayConfigWithRuntime["directionPolicies"] {
    return {
        [current.direction]: {
            policyHash: current.policyHash,
            configHash: current.configHash,
            strategy: current.strategy,
            direction: current.direction,
            initialStopBps: current.initialStopBps,
            profitFloorBps: current.profitFloorBps,
            trailingGivebackBps: current.trailingGivebackBps,
            timeStopBars: current.timeStopBars,
        },
    };
}

function replayFor(args: RunnerArgs, source: CanonicalSource, frozen: FrozenStageSet, policy: ProductionPolicy, configHash: string): IntegratedReplayResult {
    return replayIntegrated(source, {
        sourceHash: source.manifest?.sourceSha ?? source.productionSha,
        configHash,
        startTs: args.startTs,
        endTs: args.endTs,
        initialEquity: args.initialEquity,
        feeBps: args.feeBps,
        slippageBps: args.slippageBps,
        fundingSource: args.fundingSource,
        policyHash: policy.policyHash,
        deposits: args.deposits,
        fixedBaselinePolicy: policy.policyHash,
        strategyPolicies: buildReplayPolicySet(frozen, policy).map((entry) => ({
            policyHash: entry.policyHash,
            configHash: entry.configHash,
            strategy: entry.strategy,
            direction: entry.direction,
            initialStopBps: entry.initialStopBps,
            profitFloorBps: entry.profitFloorBps,
            trailingGivebackBps: entry.trailingGivebackBps,
            timeStopBars: entry.timeStopBars,
        })),
        directionPolicies: directionPolicies(policy),
        caps: { totalGross: policy.grossCap, cryptoGross: policy.grossCap, strategyGross: policy.grossCap },
    });
}

function replayMetrics(replay: IntegratedReplayResult, initialEquity: number): Readonly<Record<string, number>> {
    const finalEquity = replay.portfolio.at(-1)?.equity ?? initialEquity;
    let peak = initialEquity;
    let maxDrawdown = 0;
    for (const point of replay.portfolio) {
        peak = Math.max(peak, point.equity);
        maxDrawdown = Math.max(maxDrawdown, peak - point.equity);
    }
    return {
        accountingBalanced: replay.accountingReconciliation.balanced ? 1 : 0,
        candidateCount: replay.decisionLedger.length,
        finalEquity,
        realizedPnl: replay.accountingReconciliation.realizedPnl,
        netPnl: replay.accountingReconciliation.realizedPnl - replay.fee - replay.funding - replay.slippage,
        maxDrawdown,
        firstDivergenceTs: replay.events[0]?.ts ?? -1,
        directPnl: replay.accountingReconciliation.realizedPnl,
        lostPriorLogicPnl: 0,
        grossConflicts: replay.rejectionCount,
    };
}

function netPnlForStrategy(replay: IntegratedReplayResult, strategy: string): number {
    const positions = replay.tradeLedger ?? replay.positions;
    return positions.filter((position) => position.strategy === strategy).reduce((total, position) => {
        const realized = position.events.reduce((sum, event) => sum + (event.exit?.realizedPnl ?? 0), 0);
        const exitCosts = position.events.reduce((sum, event) => sum + (event.exit?.fee ?? 0) + (event.exit?.funding ?? 0) + (event.exit?.slippage ?? 0), 0);
        return total + realized - position.fee - position.funding - position.slippage - exitCosts;
    }, 0);
}

export function calculateLostPriorLogicPnl(baseline: IntegratedReplayResult, candidate: IntegratedReplayResult, frozen: FrozenStageSet): number {
    const strategies = new Set(frozen.policies.map((policy) => policy.strategy));
    let lost = 0;
    for (const strategy of strategies) lost += netPnlForStrategy(baseline, strategy) - netPnlForStrategy(candidate, strategy);
    return lost;
}

function requiredMetricEvidence(evidence: EvaluationEvidence, sourceHash: string, candidateId: string): Readonly<Record<string, number>> {
    if (evidence.sourceHash !== sourceHash || evidence.candidateId !== candidateId || hashEvaluationEvidence(evidence) !== evidence.lineageHash) {
        throw new Error("METRIC_EVIDENCE_INVALID_LINEAGE");
    }
    const required = [
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
    ] as const;
    for (const name of required) {
        const value = evidence.metrics[name];
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`METRIC_EVIDENCE_UNAVAILABLE:${name}`);
    }
    return evidence.metrics;
}

async function loadEvaluationEvidence(args: RunnerArgs): Promise<EvaluationEvidence | null> {
    if (args.evaluationEvidence !== undefined) return args.evaluationEvidence;
    if (args.evaluationEvidencePath === undefined) return null;
    const parsed = JSON.parse(await readFile(args.evaluationEvidencePath, "utf8")) as JsonValue;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("METRIC_EVIDENCE_INVALID");
    const object = parsed as JsonObject;
    if (typeof object.sourceHash !== "string" || typeof object.candidateId !== "string" || typeof object.lineageHash !== "string" || typeof object.metrics !== "object" || object.metrics === null || Array.isArray(object.metrics)) throw new Error("METRIC_EVIDENCE_INVALID");
    return { sourceHash: object.sourceHash, candidateId: object.candidateId, lineageHash: object.lineageHash, metrics: object.metrics as Readonly<Record<string, number>> };
}

export function assertFrozenStageReady(frozen: FrozenStageSet, stage: StageId): void {
    const completed = frozen.completedStageIds ?? frozen.stageIds;
    if (frozen.stageIds.some((entry, index) => entry !== SEQUENTIAL_STAGES.filter((stageId) => completed.includes(stageId))[index])) throw new Error("FROZEN_STAGE_METADATA: accepted stage prefix mismatch");
    if (completed.some((entry, index) => entry !== SEQUENTIAL_STAGES[index]) || new Set(completed).size !== completed.length) throw new Error("FROZEN_STAGE_METADATA: completed stage prefix is invalid");
    if (frozen.policies.length !== frozen.stageIds.length) throw new Error("FROZEN_STAGE_METADATA: policy count does not match accepted stages");
    if (frozen.policies.some((policy, index) => policy.stageId !== frozen.stageIds[index]
        || strategyForStage(policy.stageId) !== policy.strategy
        || !stageAcceptsDirection(policy.stageId, policy.direction)
        || policy.applicability !== "AVAILABLE"
        || policy.sourceHash !== frozen.sourceHash
        || policy.configHash !== frozen.configHash
        || policy.resultHash !== frozen.resultHash
        || policy.policyHash !== frozen.policyHash
        || policy.configHash.length === 0
        || policy.resultHash.length === 0
        || policy.policyHash.length === 0)) throw new Error("FROZEN_STAGE_POLICY_INVALID: policy lineage is incomplete");
    if (completed.length > 0 && (frozen.stageDecisions === undefined || frozen.stageDecisions.length < completed.length)) throw new Error("FROZEN_STAGE_METADATA: stage decisions are missing");
    const expected = SEQUENTIAL_STAGES[completed.length];
    if (expected !== stage) throw new Error(`FROZEN_STAGE_ORDER: expected ${expected ?? "COMPLETE"}, received ${stage}`);
}

function statusFromDecision(status: string | undefined, accepted: boolean): StageRunStatus {
    if (status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
    return accepted ? "ACCEPTED" : "REJECTED";
}

async function frozenFor(args: RunnerArgs): Promise<FrozenStageSet> {
    const frozen = args.priorFrozenStage !== undefined
        ? args.priorFrozenStage
        : args.frozenStagePath === undefined
            ? (() => { throw new Error("FROZEN_STAGE_REQUIRED: --frozen-stage is required"); })()
            : await loadFrozenStageSet(args.frozenStagePath);
    assertFrozenStageReady(frozen, args.stage);
    return frozen;
}

async function persist(args: RunnerArgs, result: StageResult, frozen: FrozenStageSet, manifest: unknown): Promise<StageResult> {
    const outputDirectory = join(assertRunnerOutputRoot(args.outputRoot), args.stage, result.runId ?? result.resultHash);
    await mkdir(join(assertRunnerOutputRoot(args.outputRoot), args.stage), { recursive: true });
    try {
        const existing = await readdir(outputDirectory);
        if (existing.length > 0) throw new Error("RESEARCH_ARTIFACT_EXISTS: deterministic stage run directory is immutable");
    } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const index = await writeStageArtifacts(result, outputDirectory);
    await writeFrozenStageSet(join(outputDirectory, "frozen-stage.json"), frozen);
    await writeFile(join(outputDirectory, "run-manifest.json"), JSON.stringify({ manifest, result, frozen }, null, 2), "utf8");
    return { ...result, artifactPaths: index.artifactPaths };
}

export async function runStage(args: RunnerArgs): Promise<StageResult> {
    assertRunnerOutputRoot(args.outputRoot);
    const source = await loadCanonicalSource({
        sourceRoot: args.sourceRoot,
        dataRoot: args.dataRoot,
        productionSha: args.productionSha,
        startTs: args.startTs,
        endTs: args.endTs,
        initialEquity: args.initialEquity,
        deposits: args.deposits,
        feeBps: args.feeBps,
        slippageBps: args.slippageBps,
        fundingSource: args.fundingSource,
    });
    if (source.manifest === undefined) throw new Error("SOURCE_ERROR: canonical source manifest is absent");
    if (source.baselineLedger.length === 0) throw new Error("BASELINE_PARITY_BLOCKED: baseline ledger evidence is absent");
    const frozen = await frozenFor(args);
    if (frozen.sourceHash !== source.manifest.sourceSha) throw new Error("FROZEN_STAGE_SOURCE_MISMATCH");
    const currentPolicy = policyFromSource(source, args.stage);
    const grid = buildCandidateGrid(args.stage, currentPolicy.direction, currentPolicy);
    const selected = grid.find((candidate) => candidate.candidateId === args.candidate);
    if (selected === undefined) throw new Error(`CANDIDATE_NOT_IN_PREDECLARED_GRID: ${args.candidate}`);
    const evidence = await loadEvaluationEvidence(args);
    if (selected.applicability === "AVAILABLE" && evidence === null) throw new Error("METRIC_EVIDENCE_UNAVAILABLE: required OOS, walk-forward, PF, and cost-stress evidence is absent");

    const sourceHash = source.manifest.sourceSha;
    const identityArgs: RunnerArgs = {
        ...args,
        frozenStageHash: hashFrozenStageSet(frozen),
        evaluationEvidenceHash: evidence === null ? "MISSING" : hashEvaluationEvidence(evidence),
    };
    const configHash = buildConfigHash(identityArgs, sourceHash);
    const runId = buildRunId({ sourceHash, configHash, stage: args.stage, candidate: args.candidate });
    const baselineLineage = lineagePolicy(currentPolicy, sourceHash, configHash, runId);
    const candidateLineage = selected.applicability === "AVAILABLE"
        ? { ...selected, sourceHash, configHash, resultHash: runId }
        : null;
    const baselineReplay = replayFor(args, source, frozen, baselineLineage, configHash);
    const baselineMetrics = replayMetrics(baselineReplay, args.initialEquity);
    if (!baselineReplay.accountingReconciliation.balanced) throw new Error("ACCOUNTING_FAILURE: baseline replay reconciliation is not balanced");
    const parity = evaluateBaselineParity(source, baselineLineage, baselineReplay);
    if (!parity.passed) throw new Error(parity.reason);

    if (selected.applicability === "NOT_APPLICABLE") {
        const baselineSummary: BaselineSummary = {
            sourceHash,
            configHash,
            resultHash: runId,
            strategy: baselineLineage.strategy,
            direction: baselineLineage.direction,
            policyHash: baselineLineage.policyHash,
            reason: "baseline-replay",
            fee: baselineReplay.fee,
            funding: baselineReplay.funding,
            slippage: baselineReplay.slippage,
            metrics: baselineMetrics,
        };
        const candidateSummary: CandidateSummary = {
            sourceHash,
            configHash,
            resultHash: runId,
            candidateId: selected.candidateId,
            stageId: args.stage,
            strategy: selected.strategy,
            direction: selected.direction,
            policyHash: selected.policyHash,
            accepted: false,
            status: "NOT_APPLICABLE",
            candidatePolicy: null,
            baselinePolicy: baselineLineage,
            reason: "NOT_APPLICABLE",
            fee: baselineReplay.fee,
            funding: baselineReplay.funding,
            slippage: baselineReplay.slippage,
            metrics: {},
        };
        const gates = predeclareAcceptanceGates({ sourceHash, configHash, resultHash: runId, policyHash: baselineLineage.policyHash, declaredAtTs: args.startTs });
        const decision = acceptCandidate(candidateSummary, baselineSummary, gates);
        const nextFrozen = freezeAcceptedStage(frozen, decision);
        const result: StageResult = {
            sourceHash,
            configHash,
            resultHash: runId,
            stageId: args.stage,
            strategy: selected.strategy,
            direction: selected.direction,
            accepted: false,
            reason: decision.reason,
            fee: baselineReplay.fee,
            funding: baselineReplay.funding,
            slippage: baselineReplay.slippage,
            policyHash: selected.policyHash,
            metrics: {},
            status: statusFromDecision(decision.status, decision.accepted),
            runId,
        };
        return persist(args, result, nextFrozen, source.manifest);
    }

    if (candidateLineage === null) throw new Error("CANDIDATE_POLICY_MISSING");
    const candidateReplay = replayFor(args, source, frozen, candidateLineage, configHash);
    if (!candidateReplay.accountingReconciliation.balanced) throw new Error("ACCOUNTING_FAILURE: candidate replay reconciliation is not balanced");
    const baselineSummary: BaselineSummary = {
        sourceHash,
        configHash,
        resultHash: runId,
        strategy: baselineLineage.strategy,
        direction: baselineLineage.direction,
        policyHash: baselineLineage.policyHash,
        reason: "baseline-replay",
        fee: baselineReplay.fee,
        funding: baselineReplay.funding,
        slippage: baselineReplay.slippage,
        metrics: baselineMetrics,
    };
    const candidateRawMetrics = replayMetrics(candidateReplay, args.initialEquity);
    if (evidence === null) throw new Error("METRIC_EVIDENCE_UNAVAILABLE");
    const evaluationMetrics = requiredMetricEvidence(evidence, sourceHash, candidateLineage.candidateId);
    const metrics = {
        ...evaluationMetrics,
        ...candidateRawMetrics,
        lostPriorLogicPnl: calculateLostPriorLogicPnl(baselineReplay, candidateReplay, frozen),
    };
    const candidateSummary: CandidateSummary = {
        sourceHash,
        configHash,
        resultHash: runId,
        candidateId: candidateLineage.candidateId,
        stageId: args.stage,
        strategy: candidateLineage.strategy,
        direction: candidateLineage.direction,
        policyHash: candidateLineage.policyHash,
        accepted: true,
        status: "AVAILABLE",
        candidatePolicy: candidateLineage,
        baselinePolicy: baselineLineage,
        reason: "candidate-replay",
        fee: candidateReplay.fee,
        funding: candidateReplay.funding,
        slippage: candidateReplay.slippage,
        metrics,
    };
    const gates = predeclareAcceptanceGates({ sourceHash, configHash, resultHash: runId, policyHash: baselineLineage.policyHash, declaredAtTs: args.startTs });
    const decision = acceptCandidate(candidateSummary, baselineSummary, gates);
    const nextFrozen = freezeAcceptedStage(frozen, decision);
    if (decision.accepted && !nextFrozen.stageIds.includes(args.stage)) throw new Error("FROZEN_STAGE_TRANSITION_REJECTED: canonical freeze did not accept the expected stage");
    const comparison = compareStage({
        sourceHash,
        configHash,
        resultHash: runId,
        stageId: args.stage,
        strategy: baselineLineage.strategy,
        direction: baselineLineage.direction,
        accepted: true,
        reason: "baseline-replay",
        fee: baselineReplay.fee,
        funding: baselineReplay.funding,
        slippage: baselineReplay.slippage,
        policyHash: baselineLineage.policyHash,
        metrics: baselineMetrics,
        status: "ACCEPTED",
        runId,
    }, {
        sourceHash,
        configHash,
        resultHash: runId,
        stageId: args.stage,
        strategy: candidateLineage.strategy,
        direction: candidateLineage.direction,
        accepted: decision.accepted,
        reason: decision.reason,
        fee: candidateReplay.fee,
        funding: candidateReplay.funding,
        slippage: candidateReplay.slippage,
        policyHash: candidateLineage.policyHash,
        metrics,
        status: statusFromDecision(decision.status, decision.accepted),
        runId,
    });
    const result: StageResult = {
        sourceHash,
        configHash,
        resultHash: runId,
        stageId: args.stage,
        strategy: candidateLineage.strategy,
        direction: candidateLineage.direction,
        accepted: decision.accepted,
        reason: decision.reason,
        fee: candidateReplay.fee,
        funding: candidateReplay.funding,
        slippage: candidateReplay.slippage,
        policyHash: candidateLineage.policyHash,
        metrics: { ...metrics, directPnl: comparison.directPnl, lostPriorLogicPnl: comparison.lostPriorLogicPnl, grossConflicts: comparison.grossConflicts },
        status: statusFromDecision(decision.status, decision.accepted),
        runId,
    };
    return persist(args, result, nextFrozen, { manifest: source.manifest, gates, parity, evaluationEvidence: evidence, comparison, frozen: nextFrozen });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runStage(parseRunnerArgs()).then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (result.status !== "ACCEPTED" && result.status !== "NOT_APPLICABLE") process.exitCode = 1;
    }).catch((error: unknown) => {
        process.stderr.write(`${errorMessage(error)}\n`);
        process.exitCode = 1;
    });
}
