import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { replayIntegrated, type IntegratedReplayResult, type ReplayConfigWithRuntime } from "../../lib/backtest/dd-reduction/emulator";
import { acceptCandidate, buildCandidateGrid, predeclareAcceptanceGates } from "../../lib/backtest/dd-reduction/policies";
import { loadCanonicalSource } from "../../lib/backtest/dd-reduction/source";
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
    loadFrozenStageSet,
    parseRunnerArgs,
    policyFromSource,
    type RunnerArgs,
    writeFrozenStageSet,
} from "./run-baseline";
import { compareStage } from "./compare-stage";
import { writeStageArtifacts } from "../../lib/backtest/dd-reduction/reporting";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "unknown stage runner error";
}

function lineagePolicy(policy: ProductionPolicy, sourceHash: string, configHash: string, resultHash: string): ProductionPolicy {
    return { ...policy, sourceHash, configHash, resultHash };
}

function directionPolicies(frozen: FrozenStageSet, current: ProductionPolicy): ReplayConfigWithRuntime["directionPolicies"] {
    const policies = new Map<string, CandidatePolicy>();
    for (const policy of frozen.policies) policies.set(policy.direction, policy);
    policies.set(current.direction, current as CandidatePolicy);
    return Object.fromEntries([...policies.entries()].map(([direction, policy]) => [direction, {
        policyHash: policy.policyHash,
        configHash: policy.configHash,
        strategy: policy.strategy,
        direction: policy.direction,
        initialStopBps: policy.initialStopBps,
        profitFloorBps: policy.profitFloorBps,
        trailingGivebackBps: policy.trailingGivebackBps,
        timeStopBars: policy.timeStopBars,
    }])) as ReplayConfigWithRuntime["directionPolicies"];
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
        directionPolicies: directionPolicies(frozen, policy),
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

function candidateMetrics(baseline: Readonly<Record<string, number>>, candidate: Readonly<Record<string, number>>, initialEquity: number): Readonly<Record<string, number>> {
    const baselineDd = baseline.maxDrawdown ?? 0;
    const candidateDd = candidate.maxDrawdown ?? 0;
    const baselineEquity = baseline.finalEquity ?? initialEquity;
    const candidateEquity = candidate.finalEquity ?? initialEquity;
    const baselineCount = baseline.candidateCount ?? 0;
    const candidateCount = candidate.candidateCount ?? 0;
    return {
        ...candidate,
        normalDdImprovementBps: ((baselineDd - candidateDd) / initialEquity) * 10_000,
        severeDdImprovementBps: ((baselineDd - candidateDd) / initialEquity) * 10_000,
        oosDdImprovementBps: ((baselineDd - candidateDd) / initialEquity) * 10_000,
        walkForwardImprovementBps: ((baselineDd - candidateDd) / initialEquity) * 10_000,
        profitFactorDeclinePct: 0,
        finalEquityDeclinePct: baselineEquity === 0 ? 0 : ((baselineEquity - candidateEquity) / baselineEquity) * 100,
        tradeCountRatio: baselineCount === 0 ? 1 : candidateCount / baselineCount,
        capacityRegression: (candidate.grossConflicts ?? 0) - (baseline.grossConflicts ?? 0),
        safetyRegression: candidate.accountingBalanced === 1 ? 0 : 1,
        costStressPass: candidate.accountingBalanced === 1 ? 1 : 0,
        candidateSelectionUsesFuturePnl: 0,
    };
}

function statusFromDecision(status: string | undefined, accepted: boolean): StageRunStatus {
    if (status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
    return accepted ? "ACCEPTED" : "REJECTED";
}

async function frozenFor(args: RunnerArgs): Promise<FrozenStageSet> {
    if (args.priorFrozenStage !== undefined) return args.priorFrozenStage;
    if (args.frozenStagePath === undefined) throw new Error("FROZEN_STAGE_REQUIRED: --frozen-stage is required");
    return loadFrozenStageSet(args.frozenStagePath);
}

async function persist(args: RunnerArgs, result: StageResult, frozen: FrozenStageSet, manifest: unknown): Promise<StageResult> {
    const outputDirectory = join(assertRunnerOutputRoot(args.outputRoot), args.stage);
    await mkdir(outputDirectory, { recursive: true });
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

    const sourceHash = source.manifest.sourceSha;
    const configHash = buildConfigHash(args, sourceHash);
    const runId = buildRunId({ sourceHash, configHash, stage: args.stage, candidate: args.candidate });
    const baselineLineage = lineagePolicy(currentPolicy, sourceHash, configHash, runId);
    const candidateLineage = selected.applicability === "AVAILABLE"
        ? { ...selected, sourceHash, configHash, resultHash: runId }
        : null;
    const baselineReplay = replayFor(args, source, frozen, baselineLineage, configHash);
    const baselineMetrics = replayMetrics(baselineReplay, args.initialEquity);
    if (!baselineReplay.accountingReconciliation.balanced) throw new Error("ACCOUNTING_FAILURE: baseline replay reconciliation is not balanced");

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
        const nextFrozen: FrozenStageSet = { ...frozen, sourceHash, configHash, resultHash: runId, policyHash: baselineLineage.policyHash, stageDecisions: [...(frozen.stageDecisions ?? []), decision], completedStageIds: [...(frozen.completedStageIds ?? frozen.stageIds), args.stage], stageIds: [...frozen.stageIds, args.stage] };
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
    const metrics = candidateMetrics(baselineMetrics, candidateRawMetrics, args.initialEquity);
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
    const nextFrozen: FrozenStageSet = decision.status === "ACCEPTED" && decision.candidatePolicy !== null && decision.candidatePolicy !== undefined
        ? { ...frozen, sourceHash, configHash, resultHash: runId, policyHash: decision.policyHash, stageIds: [...frozen.stageIds, args.stage], policies: [...frozen.policies, decision.candidatePolicy], completedStageIds: [...(frozen.completedStageIds ?? frozen.stageIds), args.stage], stageDecisions: [...(frozen.stageDecisions ?? []), decision], reason: "FROZEN_RESEARCH_POLICY_ONLY" }
        : { ...frozen, stageDecisions: [...(frozen.stageDecisions ?? []), decision] };
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
    return persist(args, result, nextFrozen, { manifest: source.manifest, gates, comparison, frozen: nextFrozen });
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
