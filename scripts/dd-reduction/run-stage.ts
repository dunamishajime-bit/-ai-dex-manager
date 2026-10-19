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
    buildSourceCapManifest,
    assertPolicyCaps,
    hashProtectionReadbackEvidence,
    evaluateBaselineParity,
    hashJson,
    hashEvaluationEvidence,
    hashFrozenStageSet,
    loadFrozenStageSet,
    loadProtectionReadback,
    parseRunnerArgs,
    policyFromSource,
    protectionReadbackExpectations,
    validateProtectionReadback,
    type EvaluationEvidence,
    type CanonicalCapManifest,
    type RunnerArgs,
    writeFrozenStageSet,
} from "./run-baseline";
import { compareStage } from "./compare-stage";
import { writeStageArtifacts } from "../../lib/backtest/dd-reduction/reporting";
import { mkdir, writeFile } from "node:fs/promises";
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

function policyCapManifest(policies: readonly ProductionPolicy[]): CanonicalCapManifest {
    const first = policies[0];
    if (first === undefined) throw new Error("SOURCE_ERROR: replay cap manifest is absent");
    const totalGross = first.totalGrossCap ?? first.aggregateGrossCap ?? first.grossCap;
    const cryptoGross = first.cryptoGrossCap ?? totalGross;
    const strategyGross = first.strategyGrossCap ?? first.sharedRiskCap;
    const perStrategy: Record<string, number> = {};
    const perStrategyTotalGross: Record<string, number> = {};
    const perStrategyCryptoGross: Record<string, number> = {};
    const perSymbol: Record<string, number> = {};
    for (const policy of policies) {
        const policyTotal = policy.totalGrossCap ?? policy.aggregateGrossCap ?? policy.grossCap;
        const policyCrypto = policy.cryptoGrossCap ?? policyTotal;
        if (policyTotal !== totalGross || policyCrypto !== cryptoGross) throw new Error("SOURCE_ERROR: conflicting aggregate cap declarations");
        const policyStrategy = policy.strategyGrossCap ?? policy.sharedRiskCap;
        if (perStrategy[policy.strategy] !== undefined && perStrategy[policy.strategy] !== policyStrategy) throw new Error(`SOURCE_ERROR: conflicting strategy cap declaration for ${policy.strategy}`);
        perStrategy[policy.strategy] = policyStrategy;
        perStrategyTotalGross[policy.strategy] = policyTotal;
        perStrategyCryptoGross[policy.strategy] = policyCrypto;
        for (const [strategy, cap] of Object.entries(policy.perStrategyGrossCaps ?? {})) {
            if (perStrategy[strategy] !== undefined && perStrategy[strategy] !== cap) throw new Error(`SOURCE_ERROR: conflicting strategy cap declaration for ${strategy}`);
            perStrategy[strategy] = cap;
        }
        for (const [symbol, cap] of Object.entries(policy.perSymbolGrossCaps ?? {})) {
            if (perSymbol[symbol] !== undefined && perSymbol[symbol] !== cap) throw new Error(`SOURCE_ERROR: conflicting symbol cap declaration for ${symbol}`);
            perSymbol[symbol] = cap;
        }
    }
    const manifest = { totalGross, cryptoGross, strategyGross, perStrategy, perStrategyTotalGross, perStrategyCryptoGross, perSymbol };
    return { ...manifest, hash: hashJson(manifest as unknown as JsonValue) };
}

export function buildReplayConfig(args: RunnerArgs, source: CanonicalSource, frozen: FrozenStageSet, policy: ProductionPolicy, configHash: string): ReplayConfigWithRuntime {
    const policies = buildReplayPolicySet(frozen, policy);
    const manifest = source.strategyConfigs.length > 0 ? buildSourceCapManifest(source) : policyCapManifest(policies);
    assertPolicyCaps(policies, manifest);
    const perStrategyCaps = manifest.perStrategy;
    const perSymbolCaps = manifest.perSymbol;
    return {
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
        strategyPolicies: policies.map((entry) => ({
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
        caps: {
            totalGross: manifest.totalGross,
            cryptoGross: manifest.cryptoGross,
            strategyGross: manifest.perStrategy[policy.strategy] ?? manifest.strategyGross,
            perStrategy: perStrategyCaps,
            perSymbol: perSymbolCaps,
        },
        perStrategyCaps,
        perSymbolCaps,
        executionEvents: args.executionEvents,
        protectionReadbackEvidence: args.protectionReadbackEvidence,
    };
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
    return replayIntegrated(source, buildReplayConfig(args, source, frozen, policy, configHash));
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

export function validateReplayBoundary(replay: Pick<IntegratedReplayResult, "reason" | "decisionLedger" | "portfolio">, startTs = Number.NEGATIVE_INFINITY, endTs = Number.POSITIVE_INFINITY): void {
    if (replay.reason === "MANUAL_REVIEW_REQUIRED") throw new Error("MANUAL_REVIEW_REQUIRED: replay safety marker is present");
    for (const decision of replay.decisionLedger) {
        const fill = decision.fill;
        if (fill !== null && fill !== undefined) {
            if (fill.ts < decision.ts) throw new Error(`CANDIDATE_FILL_BEFORE_DECISION:${decision.candidateId}`);
            if (fill.ts < startTs || fill.ts > endTs) throw new Error(`CANDIDATE_FILL_OUTSIDE_WINDOW:${decision.candidateId}`);
            if (!decision.accepted) throw new Error(`UNADMITTED_CANDIDATE_FILL:${decision.candidateId}`);
        }
    }
    for (const point of replay.portfolio) {
        const state = point as unknown as { readonly manualReview?: readonly string[]; readonly events?: readonly { readonly executionStatus?: string }[] };
        if ((state.manualReview?.length ?? 0) > 0) throw new Error(`MANUAL_REVIEW_REQUIRED:${state.manualReview?.join(",")}`);
        if (state.events?.some((event) => event.executionStatus === "UNKNOWN")) throw new Error("UNKNOWN_EXECUTION: replay contains unknown execution status");
    }
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

export function buildEvaluationConfigHash(args: RunnerArgs, sourceHash: string, frozenStageHash: string): string {
    return buildConfigHash({ ...args, frozenStageHash, evaluationEvidenceHash: undefined }, sourceHash);
}

export function buildEvaluationGateHash(sourceHash: string, configHash: string, policyHash: string, startTs: number): string {
    return predeclareAcceptanceGates({ sourceHash, configHash, resultHash: configHash, policyHash, declaredAtTs: startTs }).gateHash ?? "";
}

function requiredMetricEvidence(evidence: EvaluationEvidence, expected: {
    readonly sourceHash: string;
    readonly configHash: string;
    readonly frozenStageHash: string;
    readonly stageId: StageId;
    readonly candidateId: string;
    readonly startTs: number;
    readonly endTs: number;
    readonly initialEquity: number;
    readonly deposits: readonly { readonly ts: number; readonly amount: number }[];
    readonly feeBps: number;
    readonly slippageBps: number;
    readonly fundingSource: string;
    readonly gateHash: string;
}): Readonly<Record<string, number>> {
    if (evidence.sourceHash !== expected.sourceHash || evidence.configHash !== expected.configHash || evidence.frozenStageHash !== expected.frozenStageHash
        || evidence.stageId !== expected.stageId || evidence.candidateId !== expected.candidateId || evidence.startTs !== expected.startTs || evidence.endTs !== expected.endTs
        || evidence.initialEquity !== expected.initialEquity || JSON.stringify(evidence.deposits) !== JSON.stringify(expected.deposits)
        || evidence.feeBps !== expected.feeBps || evidence.slippageBps !== expected.slippageBps || evidence.fundingSource !== expected.fundingSource
        || evidence.gateHash !== expected.gateHash || hashEvaluationEvidence(evidence) !== evidence.lineageHash) {
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
    if (typeof object.sourceHash !== "string" || typeof object.configHash !== "string" || typeof object.frozenStageHash !== "string" || typeof object.stageId !== "string"
        || typeof object.candidateId !== "string" || typeof object.startTs !== "number" || typeof object.endTs !== "number" || typeof object.initialEquity !== "number"
        || !Array.isArray(object.deposits) || typeof object.feeBps !== "number" || typeof object.slippageBps !== "number" || typeof object.fundingSource !== "string"
        || typeof object.gateHash !== "string" || typeof object.lineageHash !== "string" || typeof object.metrics !== "object" || object.metrics === null || Array.isArray(object.metrics)) throw new Error("METRIC_EVIDENCE_INVALID");
    return {
        sourceHash: object.sourceHash, configHash: object.configHash, frozenStageHash: object.frozenStageHash, stageId: object.stageId as StageId,
        candidateId: object.candidateId, startTs: object.startTs, endTs: object.endTs, initialEquity: object.initialEquity,
        deposits: object.deposits as unknown as EvaluationEvidence["deposits"], feeBps: object.feeBps, slippageBps: object.slippageBps,
        fundingSource: object.fundingSource, gateHash: object.gateHash, lineageHash: object.lineageHash, metrics: object.metrics as Readonly<Record<string, number>>,
    };
}

export function assertFrozenStageReady(frozen: FrozenStageSet, stage: StageId): void {
    const completed = frozen.completedStageIds ?? frozen.stageIds;
    if (completed.some((entry, index) => entry !== SEQUENTIAL_STAGES[index]) || new Set(completed).size !== completed.length) throw new Error("FROZEN_STAGE_METADATA: completed stage prefix is invalid");
    if (frozen.stageLineages !== undefined) {
        if (frozen.stageLineages.length !== completed.length) throw new Error("FROZEN_STAGE_METADATA: stage lineage count does not match completed stages");
        if (frozen.stageLineages.some((lineage, index) => lineage.stageId !== completed[index] || (lineage.status !== "ACCEPTED" && lineage.status !== "NOT_APPLICABLE"))) throw new Error("FROZEN_STAGE_METADATA: stage lineage prefix is invalid");
        const accepted = frozen.stageLineages.filter((lineage) => lineage.status === "ACCEPTED");
        if (accepted.map((lineage) => lineage.stageId).join(",") !== frozen.stageIds.join(",")) throw new Error("FROZEN_STAGE_METADATA: accepted stage prefix mismatch");
        if (frozen.policies.length !== accepted.length) throw new Error("FROZEN_STAGE_METADATA: policy count does not match accepted stages");
        if (frozen.policies.some((policy, index) => {
            const lineage = accepted[index];
            return lineage === undefined || policy.stageId !== lineage.stageId || strategyForStage(policy.stageId) !== policy.strategy
                || !stageAcceptsDirection(policy.stageId, policy.direction) || policy.applicability !== "AVAILABLE"
                || policy.sourceHash !== lineage.sourceHash || policy.configHash !== lineage.configHash || policy.resultHash !== lineage.resultHash || policy.policyHash !== lineage.policyHash;
        })) throw new Error("FROZEN_STAGE_POLICY_INVALID: policy lineage is incomplete");
        if (frozen.stageLineages.some((lineage) => {
            const decision = frozen.stageDecisions?.[lineage.decisionIndex];
            return decision === undefined || decision.stageId !== lineage.stageId || decision.status !== lineage.status
                || decision.sourceHash !== lineage.sourceHash || decision.configHash !== lineage.configHash || decision.resultHash !== lineage.resultHash || decision.policyHash !== lineage.policyHash;
        })) throw new Error("FROZEN_STAGE_DECISION_INVALID: stage decision does not match lineage");
    } else {
        if (frozen.stageIds.length > 0 || frozen.policies.length > 0 || completed.length > 0) throw new Error("FROZEN_STAGE_LINEAGE_REQUIRED: non-empty frozen sets require stageLineages");
        if (frozen.stageIds.some((entry, index) => entry !== SEQUENTIAL_STAGES.filter((stageId) => completed.includes(stageId))[index])) throw new Error("FROZEN_STAGE_METADATA: accepted stage prefix mismatch");
        if (frozen.policies.length !== frozen.stageIds.length) throw new Error("FROZEN_STAGE_METADATA: policy count does not match accepted stages");
        if (frozen.policies.some((policy, index) => policy.stageId !== frozen.stageIds[index]
            || strategyForStage(policy.stageId) !== policy.strategy
            || !stageAcceptsDirection(policy.stageId, policy.direction)
            || policy.applicability !== "AVAILABLE"
            || policy.configHash.length === 0
            || policy.resultHash.length === 0
            || policy.policyHash.length === 0)) throw new Error("FROZEN_STAGE_POLICY_INVALID: policy lineage is incomplete");
    }
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
        await mkdir(outputDirectory);
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("RESEARCH_ARTIFACT_EXISTS: deterministic stage run directory is immutable");
        throw error;
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
    const frozenStageHash = hashFrozenStageSet(frozen);
    const protectionReadback = await loadProtectionReadback(args);
    const protectionReadbackHash = protectionReadback === null ? undefined : hashProtectionReadbackEvidence(protectionReadback);
    const identityArgs = { ...args, protectionReadbackHash };
    const evaluationConfigHash = buildEvaluationConfigHash(identityArgs, sourceHash, frozenStageHash);
    const evaluationGateHash = buildEvaluationGateHash(sourceHash, evaluationConfigHash, currentPolicy.policyHash, args.startTs);
    const filledCandidates = protectionReadbackExpectations(source);
    if (selected.applicability === "AVAILABLE" && filledCandidates.length > 0 && protectionReadback === null) throw new Error("PROTECTION_READBACK_UNAVAILABLE");
    if (protectionReadback !== null) validateProtectionReadback(protectionReadback, {
        sourceHash,
        configHash: evaluationConfigHash,
        frozenStageHash,
        stageId: args.stage,
        candidateId: args.candidate,
        filledCandidates,
    });
    const identityRunnerArgs: RunnerArgs = {
        ...identityArgs,
        protectionReadbackEvidence: protectionReadback ?? undefined,
        frozenStageHash,
        evaluationEvidenceHash: evidence === null ? "MISSING" : hashEvaluationEvidence(evidence),
    };
    const configHash = buildConfigHash(identityRunnerArgs, sourceHash);
    const runId = buildRunId({ sourceHash, configHash, stage: args.stage, candidate: args.candidate });
    const baselineLineage = lineagePolicy(currentPolicy, sourceHash, configHash, runId);
    const candidateLineage = selected.applicability === "AVAILABLE"
        ? { ...selected, sourceHash, configHash, resultHash: runId }
        : null;
    const replayArgs = { ...args, protectionReadbackEvidence: protectionReadback ?? undefined };
    const baselineReplay = replayFor(replayArgs, source, frozen, baselineLineage, configHash);
    validateReplayBoundary(baselineReplay, args.startTs, args.endTs);
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
    const candidateReplay = replayFor(replayArgs, source, frozen, candidateLineage, configHash);
    validateReplayBoundary(candidateReplay, args.startTs, args.endTs);
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
    const evaluationMetrics = requiredMetricEvidence(evidence, {
        sourceHash,
        configHash: evaluationConfigHash,
        frozenStageHash,
        stageId: args.stage,
        candidateId: candidateLineage.candidateId,
        startTs: args.startTs,
        endTs: args.endTs,
        initialEquity: args.initialEquity,
        deposits: args.deposits,
        feeBps: args.feeBps,
        slippageBps: args.slippageBps,
        fundingSource: args.fundingSource,
        gateHash: evaluationGateHash,
    });
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
