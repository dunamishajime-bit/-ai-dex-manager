import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { replayIntegrated, type IntegratedReplayResult, type ReplayConfigWithRuntime } from "../../lib/backtest/dd-reduction/emulator";
import { attributeReplay, writeStageArtifacts } from "../../lib/backtest/dd-reduction/reporting";
import { loadCanonicalSource, SourceContractError } from "../../lib/backtest/dd-reduction/source";
import { directionForStage, SEQUENTIAL_STAGES, stageAcceptsDirection, strategyForStage } from "../../lib/backtest/dd-reduction/stages";
import type {
    CanonicalSource,
    Direction,
    FrozenStageSet,
    JsonObject,
    JsonValue,
    ProductionPolicy,
    StageId,
    StageResult,
} from "../../lib/backtest/dd-reduction/types";

const SCRIPT_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_RESEARCH_ROOT = "C:/Users/dis/Desktop/DisDex_AI_Files/01_BT_Research";
const SHA256 = /^[a-f0-9]{64}$/i;

export interface RunnerArgs {
    readonly sourceRoot: string;
    readonly dataRoot: string;
    readonly productionSha: string;
    readonly startTs: number;
    readonly endTs: number;
    readonly outputRoot: string;
    readonly stage: StageId;
    readonly candidate: string;
    readonly initialEquity: number;
    readonly deposits: readonly { readonly ts: number; readonly amount: number }[];
    readonly feeBps: number;
    readonly slippageBps: number;
    readonly fundingSource: string;
    readonly frozenStagePath?: string;
    readonly priorFrozenStage?: FrozenStageSet;
    readonly frozenStageHash?: string;
    readonly evaluationEvidencePath?: string;
    readonly evaluationEvidenceHash?: string;
    readonly evaluationEvidence?: EvaluationEvidence;
}

export interface EvaluationEvidence {
    readonly sourceHash: string;
    readonly candidateId: string;
    readonly lineageHash: string;
    readonly metrics: Readonly<Record<string, number>>;
}

export interface RunIdInput {
    readonly sourceHash: string;
    readonly configHash: string;
    readonly stage: string;
    readonly candidate: string;
}

export interface FrozenStageFile {
    readonly path: string;
    readonly stage: FrozenStageSet;
}

function stableJson(value: JsonValue | readonly JsonValue[]): string {
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
    if (typeof value === "object" && value !== null) {
        const object = value as JsonObject;
        return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key] as JsonValue)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

export function hashJson(value: JsonValue | readonly JsonValue[]): string {
    return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function hashFrozenStageSet(frozen: FrozenStageSet): string {
    return hashJson(frozen as unknown as JsonValue);
}

export function hashEvaluationEvidence(evidence: EvaluationEvidence): string {
    return hashJson({
        candidateId: evidence.candidateId,
        metrics: evidence.metrics as JsonValue,
        sourceHash: evidence.sourceHash,
    });
}

function isWithin(root: string, candidate: string): boolean {
    const fromRoot = relative(root, candidate);
    return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "unknown runner error";
}

function requiredFlag(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (value === undefined || value.startsWith("--")) throw new Error(`missing required flag ${name}`);
    if (args.indexOf(name, index + 1) >= 0) throw new Error(`duplicate flag ${name}`);
    return value;
}

function optionalFlag(args: readonly string[], name: string, fallback: string): string {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
    if (args.indexOf(name, index + 1) >= 0) throw new Error(`duplicate flag ${name}`);
    return value;
}

function finiteFlag(args: readonly string[], name: string, fallback?: number): number {
    const text = fallback === undefined ? requiredFlag(args, name) : optionalFlag(args, name, String(fallback));
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
    return value;
}

function parseDeposits(args: readonly string[]): readonly { readonly ts: number; readonly amount: number }[] {
    const deposits: { ts: number; amount: number }[] = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] !== "--deposit") continue;
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) throw new Error("--deposit requires <ts>:<amount>");
        const pieces = value.split(":");
        if (pieces.length !== 2) throw new Error("--deposit requires <ts>:<amount>");
        const ts = Number(pieces[0]);
        const amount = Number(pieces[1]);
        if (!Number.isFinite(ts) || !Number.isFinite(amount)) throw new Error("--deposit requires numeric <ts>:<amount>");
        deposits.push({ ts, amount });
        index += 1;
    }
    return deposits.sort((left, right) => left.ts - right.ts);
}

function stageId(value: string): StageId {
    if (!(SEQUENTIAL_STAGES as readonly string[]).includes(value)) throw new Error(`--stage must be a sequential stage id: ${value}`);
    return value as StageId;
}

export function parseRunnerArgs(args: readonly string[] = process.argv.slice(2)): RunnerArgs {
    const sourceRoot = resolve(requiredFlag(args, "--source-root"));
    const dataRoot = resolve(requiredFlag(args, "--data-root"));
    const outputRoot = resolve(requiredFlag(args, "--output-root"));
    const stage = stageId(requiredFlag(args, "--stage"));
    const candidate = requiredFlag(args, "--candidate");
    const startTs = finiteFlag(args, "--start");
    const endTs = finiteFlag(args, "--end");
    if (endTs < startTs) throw new Error("--end must be greater than or equal to --start");
    const productionSha = requiredFlag(args, "--production-sha");
    if (!SHA256.test(productionSha)) throw new Error("--production-sha must be a SHA256 hex string");
    const fundingSource = requiredFlag(args, "--funding-source");
    const result: RunnerArgs = {
        sourceRoot,
        dataRoot,
        productionSha,
        startTs,
        endTs,
        outputRoot,
        stage,
        candidate,
        initialEquity: finiteFlag(args, "--initial-equity", 10_000),
        deposits: parseDeposits(args),
        feeBps: finiteFlag(args, "--fee-bps", 0),
        slippageBps: finiteFlag(args, "--slippage-bps", 0),
        fundingSource,
        frozenStagePath: args.includes("--frozen-stage") ? resolve(requiredFlag(args, "--frozen-stage")) : undefined,
        evaluationEvidencePath: args.includes("--evaluation-evidence") ? resolve(requiredFlag(args, "--evaluation-evidence")) : undefined,
    };
    if (result.candidate.trim().length === 0) throw new Error("--candidate must be non-empty");
    return result;
}

export function buildRunId(input: RunIdInput): string {
    return hashJson({
        candidate: input.candidate,
        configHash: input.configHash,
        sourceHash: input.sourceHash,
        stage: input.stage,
    });
}

export function assertRunnerOutputRoot(outputRoot: string): string {
    const resolved = resolve(outputRoot);
    if (isWithin(SCRIPT_REPOSITORY_ROOT, resolved)) throw new Error("RESEARCH_OUTPUT_MUST_NOT_BE_INSIDE_REPOSITORY");
    const desktopRoot = resolve("C:/Users/dis/Desktop");
    if (resolved === desktopRoot) throw new Error("RESEARCH_OUTPUT_MUST_NOT_BE_DESKTOP_ROOT");
    const configuredRoot = process.env.DISDEX_AI_OUTPUT_ROOT?.trim();
    const approvedRoot = resolve(configuredRoot || DEFAULT_RESEARCH_ROOT);
    if (approvedRoot === desktopRoot) throw new Error("RESEARCH_OUTPUT_ROOT_MUST_NOT_BE_DESKTOP_ROOT");
    if (isWithin(desktopRoot, approvedRoot) && !isWithin(resolve(DEFAULT_RESEARCH_ROOT), approvedRoot)) {
        throw new Error("RESEARCH_OUTPUT_ROOT_MUST_BE_APPROVED_RESEARCH_HIERARCHY");
    }
    if (!isWithin(approvedRoot, resolved)) throw new Error("RESEARCH_OUTPUT_MUST_BE_WITHIN_APPROVED_ROOT");
    return resolved;
}

function jsonString(object: JsonObject, key: string): string | null {
    const value = object[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function jsonNumber(object: JsonObject, key: string): number | null {
    const value = object[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonDirections(object: JsonObject): readonly Direction[] | null {
    const value = object.supportedDirections;
    if (!Array.isArray(value)) return null;
    const directions = value.filter((item): item is Direction => item === "LONG" || item === "SHORT");
    return directions.length === value.length && directions.length > 0 ? directions : null;
}

function requiredConfigNumber(config: JsonObject, key: string): number {
    const value = jsonNumber(config, key);
    if (value === null) throw new Error(`SOURCE_ERROR: production config missing finite ${key}`);
    return value;
}

function requiredConfigString(config: JsonObject, key: string): string {
    const value = jsonString(config, key);
    if (value === null) throw new Error(`SOURCE_ERROR: production config missing ${key}`);
    return value;
}

export function policyFromSource(source: CanonicalSource, stage: StageId): ProductionPolicy {
    const strategy = strategyForStage(stage);
    const strategyConfig = source.strategyConfigs.find((entry) => entry.strategy === strategy);
    if (strategyConfig === undefined) throw new Error(`SOURCE_ERROR: production policy for ${strategy} is absent`);
    const configuredDirection = jsonString(strategyConfig.config, "direction");
    const direction = directionForStage(stage) ?? configuredDirection;
    if (direction !== "LONG" && direction !== "SHORT") throw new Error(`SOURCE_ERROR: direction for ${stage} is absent`);
    const supportedDirections = jsonDirections(strategyConfig.config);
    if (supportedDirections === null) throw new Error(`SOURCE_ERROR: supportedDirections for ${strategy} is absent`);
    const timeStopValue = strategyConfig.config.timeStopBars;
    const timeStopBars = timeStopValue === null ? null : jsonNumber(strategyConfig.config, "timeStopBars");
    if (timeStopValue !== null && timeStopBars === null) throw new Error(`SOURCE_ERROR: production config missing finite timeStopBars`);
    const base: ProductionPolicy = {
        sourceHash: source.manifest?.sourceSha ?? source.productionSha,
        configHash: strategyConfig.configHash,
        resultHash: hashJson({ source: source.productionSha, config: strategyConfig.config } as JsonObject),
        strategy,
        direction,
        policyHash: "",
        reason: "PRODUCTION_BASELINE_POLICY",
        fee: source.input.feeBps,
        funding: 0,
        slippage: source.input.slippageBps,
        entryPolicy: requiredConfigString(strategyConfig.config, "entryPolicy"),
        sizingPolicy: requiredConfigString(strategyConfig.config, "sizingPolicy"),
        grossCap: requiredConfigNumber(strategyConfig.config, "grossCap"),
        sharedRiskCap: requiredConfigNumber(strategyConfig.config, "sharedRiskCap"),
        marginGuard: requiredConfigString(strategyConfig.config, "marginGuard"),
        leverage: requiredConfigNumber(strategyConfig.config, "leverage"),
        initialStopBps: requiredConfigNumber(strategyConfig.config, "initialStopBps"),
        profitFloorBps: requiredConfigNumber(strategyConfig.config, "profitFloorBps"),
        trailingGivebackBps: requiredConfigNumber(strategyConfig.config, "trailingGivebackBps"),
        timeStopBars,
        supportedDirections,
    };
    return { ...base, policyHash: hashJson(base as unknown as JsonObject) };
}

export interface BaselineParityCheck {
    readonly passed: boolean;
    readonly reason: string;
    readonly ledgerHash: string;
    readonly expectedTradeCount: number;
    readonly actualOpenTradeCount: number;
    readonly expectedOpenAcceptedGross: number;
    readonly actualOpenAcceptedGross: number;
}

function baselineParityObject(source: CanonicalSource, policy: ProductionPolicy): JsonObject | null {
    const config = source.strategyConfigs.find((entry) => entry.strategy === policy.strategy)?.config;
    const value = config?.baselineParity;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function parityNumber(value: JsonValue | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function evaluateBaselineParity(source: CanonicalSource, policy: ProductionPolicy, replay: { readonly positions: readonly { readonly positionId: string; readonly acceptedGross: number }[] }): BaselineParityCheck {
    const ledgerHash = hashJson(source.baselineLedger as unknown as JsonValue);
    const evidence = baselineParityObject(source, policy);
    const expectedTradeCount = source.baselineLedger.length;
    const expectedOpen = source.baselineLedger.filter((entry) => entry.finalExit === null && entry.entry !== null);
    const expectedOpenAcceptedGross = expectedOpen.reduce((total, entry) => total + entry.acceptedGross, 0);
    const actualOpen = replay.positions.filter((position) => position.positionId.startsWith("baseline:"));
    const actualOpenAcceptedGross = actualOpen.reduce((total, position) => total + position.acceptedGross, 0);
    const mismatches: string[] = [];
    if (evidence === null) mismatches.push("production.baselineParity.missing");
    if (evidence?.ledgerHash !== ledgerHash) mismatches.push("ledgerHash");
    if (parityNumber(evidence?.tradeCount) !== expectedTradeCount) mismatches.push("tradeCount");
    if (parityNumber(evidence?.openTradeCount) !== expectedOpen.length) mismatches.push("openTradeCount");
    if (parityNumber(evidence?.openAcceptedGross) !== expectedOpenAcceptedGross) mismatches.push("openAcceptedGross");
    if (actualOpen.length !== expectedOpen.length) mismatches.push("replay.openTradeCount");
    if (actualOpenAcceptedGross !== expectedOpenAcceptedGross) mismatches.push("replay.openAcceptedGross");
    const expectedIds = expectedOpen.map((entry) => `baseline:${entry.tradeId}`).sort();
    const actualIds = actualOpen.map((position) => position.positionId).sort();
    if (expectedIds.join(",") !== actualIds.join(",")) mismatches.push("replay.tradeIds");
    return {
        passed: mismatches.length === 0,
        reason: mismatches.length === 0 ? "BASELINE_PARITY_PASS" : `BASELINE_PARITY_BLOCKED:${mismatches.join(",")}`,
        ledgerHash,
        expectedTradeCount,
        actualOpenTradeCount: actualOpen.length,
        expectedOpenAcceptedGross,
        actualOpenAcceptedGross,
    };
}

function inputFor(args: RunnerArgs): Parameters<typeof loadCanonicalSource>[0] {
    return {
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
    };
}

function resultHashes(args: RunnerArgs, sourceHash: string): { readonly configHash: string; readonly runId: string; } {
    const configHash = buildConfigHash(args, sourceHash);
    return { configHash, runId: buildRunId({ sourceHash, configHash, stage: args.stage, candidate: args.candidate }) };
}

export function buildConfigHash(args: RunnerArgs, sourceHash: string): string {
    return hashJson({
        sourceHash,
        candidate: args.candidate,
        deposits: args.deposits,
        endTs: args.endTs,
        feeBps: args.feeBps,
        fundingSource: args.fundingSource,
        initialEquity: args.initialEquity,
        slippageBps: args.slippageBps,
        startTs: args.startTs,
        stage: args.stage,
        frozenStageHash: args.frozenStageHash ?? null,
        evaluationEvidenceHash: args.evaluationEvidenceHash ?? null,
    });
}

function emptyMetrics(): Readonly<Record<string, number>> {
    return {
        accountingBalanced: 0,
        candidateCount: 0,
        finalEquity: 0,
        realizedPnl: 0,
        netPnl: 0,
        maxDrawdown: 0,
        firstDivergenceTs: -1,
        directPnl: 0,
        lostPriorLogicPnl: 0,
        grossConflicts: 0,
    };
}

function failedResult(args: RunnerArgs, status: StageResult["status"], reason: string, sourceHash = hashJson({ sourceRoot: args.sourceRoot, dataRoot: args.dataRoot, productionSha: args.productionSha })): StageResult {
    const hashes = resultHashes(args, sourceHash);
    return {
        sourceHash,
        configHash: hashes.configHash,
        resultHash: hashes.runId,
        stageId: args.stage,
        strategy: strategyForStage(args.stage),
        direction: directionForStage(args.stage) ?? "LONG",
        accepted: false,
        reason,
        fee: args.feeBps,
        funding: 0,
        slippage: args.slippageBps,
        policyHash: sourceHash,
        metrics: emptyMetrics(),
        status,
        runId: hashes.runId,
    };
}

function replayConfig(args: RunnerArgs, source: CanonicalSource, policy: ProductionPolicy, configHash: string): ReplayConfigWithRuntime {
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
        directionPolicies: {
            [policy.direction]: {
                policyHash: policy.policyHash,
                configHash: policy.configHash,
                strategy: policy.strategy,
                direction: policy.direction,
                initialStopBps: policy.initialStopBps,
                profitFloorBps: policy.profitFloorBps,
                trailingGivebackBps: policy.trailingGivebackBps,
                timeStopBars: policy.timeStopBars,
            },
        },
        caps: { totalGross: policy.grossCap, cryptoGross: policy.grossCap, strategyGross: policy.grossCap },
    };
}

function replayMetrics(replay: IntegratedReplayResult, initialEquity: number): Readonly<Record<string, number>> {
    const attribution = attributeReplay(replay);
    const finalEquity = replay.portfolio.at(-1)?.equity ?? initialEquity;
    let peak = initialEquity;
    let maxDrawdown = 0;
    let firstDivergenceTs = -1;
    for (const point of replay.portfolio) {
        peak = Math.max(peak, point.equity);
        maxDrawdown = Math.max(maxDrawdown, peak - point.equity);
    }
    if (replay.events.length > 0) firstDivergenceTs = replay.events[0]?.ts ?? -1;
    return {
        accountingBalanced: replay.accountingReconciliation.balanced ? 1 : 0,
        candidateCount: replay.decisionLedger.length,
        finalEquity,
        realizedPnl: replay.accountingReconciliation.realizedPnl,
        netPnl: attribution.netPnl,
        maxDrawdown,
        firstDivergenceTs,
        directPnl: attribution.netPnl,
        lostPriorLogicPnl: attribution.lostCorePnl,
        grossConflicts: replay.rejectionCount,
    };
}

async function persistResult(args: RunnerArgs, result: StageResult, extra: Record<string, object | string | number | boolean | null> = {}): Promise<StageResult> {
    const runDirectory = join(assertRunnerOutputRoot(args.outputRoot), args.stage, result.runId ?? result.resultHash);
    await mkdir(dirname(runDirectory), { recursive: true });
    try {
        const existing = await readdir(runDirectory);
        if (existing.length > 0) throw new Error("RESEARCH_ARTIFACT_EXISTS: deterministic run directory is immutable");
    } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const artifactIndex = await writeStageArtifacts(result, runDirectory);
    await writeFile(join(runDirectory, "run-manifest.json"), JSON.stringify({ ...extra, result, artifactIndex }, null, 2), "utf8");
    return { ...result, artifactPaths: artifactIndex.artifactPaths };
}

async function loadSource(args: RunnerArgs): Promise<CanonicalSource> {
    const source = await loadCanonicalSource(inputFor(args));
    if (source.manifest === undefined) throw new Error("SOURCE_ERROR: canonical source manifest is absent");
    return source;
}

export async function runBaseline(args: RunnerArgs): Promise<StageResult> {
    assertRunnerOutputRoot(args.outputRoot);
    let source: CanonicalSource;
    try {
        source = await loadSource(args);
        const manifest = source.manifest;
        if (manifest === undefined) throw new Error("SOURCE_ERROR: canonical source manifest is absent");
        const hashes = resultHashes(args, manifest.sourceSha);
        const policy = policyFromSource(source, args.stage);
        if (source.baselineLedger.length === 0) {
            return persistResult(args, failedResult(args, "BASELINE_PARITY_BLOCKED", "BASELINE_PARITY_BLOCKED: baseline ledger evidence is absent", manifest.sourceSha), {
                manifest,
                runId: hashes.runId,
                parity: "ABSENT",
            });
        }
        const replay = replayIntegrated(source, replayConfig(args, source, policy, hashes.configHash));
        if (!replay.accountingReconciliation.balanced) throw new Error("ACCOUNTING_FAILURE: replay reconciliation is not balanced");
        const parity = evaluateBaselineParity(source, policy, replay);
        if (!parity.passed) {
            return persistResult(args, failedResult(args, "BASELINE_PARITY_BLOCKED", parity.reason, manifest.sourceSha), {
                manifest,
                runId: hashes.runId,
                parity,
            });
        }
        const result: StageResult = {
            sourceHash: manifest.sourceSha,
            configHash: hashes.configHash,
            resultHash: hashes.runId,
            stageId: args.stage,
            strategy: policy.strategy,
            direction: policy.direction,
            accepted: true,
            reason: parity.reason,
            fee: replay.fee,
            funding: replay.funding,
            slippage: replay.slippage,
            policyHash: policy.policyHash,
            metrics: replayMetrics(replay, args.initialEquity),
            status: "ACCEPTED",
            runId: hashes.runId,
        };
        return persistResult(args, result, { manifest, parity, runId: hashes.runId });
    } catch (error) {
        const result = failedResult(args, error instanceof SourceContractError ? "SOURCE_ERROR" : "SOURCE_ERROR", `SOURCE_ERROR: ${errorMessage(error)}`);
        return persistResult(args, result, { parity: "SOURCE_ERROR", error: errorMessage(error) });
    }
}

function isHash(value: JsonValue | undefined): value is string {
    return typeof value === "string" && SHA256.test(value);
}

function parseFrozenStage(value: JsonValue, path: string): FrozenStageSet {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`FROZEN_STAGE_INVALID: ${path} must contain an object`);
    const object = value as JsonObject;
    const sourceHash = object.sourceHash;
    const configHash = object.configHash;
    const resultHash = object.resultHash;
    const policyHash = object.policyHash;
    const stageIds = object.stageIds;
    const policies = object.policies;
    const reason = object.reason;
    if (!isHash(sourceHash) || !isHash(configHash) || !isHash(resultHash) || !isHash(policyHash) || !Array.isArray(stageIds) || !Array.isArray(policies) || typeof reason !== "string") {
        throw new Error(`FROZEN_STAGE_INVALID: ${path} is missing frozen lineage fields`);
    }
    const normalizedStageIds = stageIds.filter((entry): entry is StageId => typeof entry === "string" && (SEQUENTIAL_STAGES as readonly string[]).includes(entry));
    if (normalizedStageIds.length !== stageIds.length || normalizedStageIds.some((entry, index) => entry !== SEQUENTIAL_STAGES[index])) {
        throw new Error(`FROZEN_STAGE_INVALID: ${path} is not a cumulative sequential prefix`);
    }
    const completedStageIdsValue = object.completedStageIds;
    const completedStageIds = Array.isArray(completedStageIdsValue)
        ? completedStageIdsValue.filter((entry): entry is StageId => typeof entry === "string" && (SEQUENTIAL_STAGES as readonly string[]).includes(entry))
        : normalizedStageIds;
    if (completedStageIds.length !== (Array.isArray(completedStageIdsValue) ? completedStageIdsValue.length : normalizedStageIds.length)
        || completedStageIds.some((entry, index) => entry !== SEQUENTIAL_STAGES[index])) {
        throw new Error(`FROZEN_STAGE_METADATA: ${path} completedStageIds is not an exact sequential prefix`);
    }
    if (policies.length !== stageIds.length) throw new Error(`FROZEN_STAGE_INVALID: ${path} must contain one policy for every accepted stage`);
    const policyStages: StageId[] = [];
    for (const [index, policyValue] of policies.entries()) {
        if (typeof policyValue !== "object" || policyValue === null || Array.isArray(policyValue)) throw new Error(`FROZEN_STAGE_POLICY_INVALID: ${path} policy ${index} is not an object`);
        const policy = policyValue as JsonObject;
        const policyStage = policy.stageId;
        const policyStrategy = policy.strategy;
        const policyDirection = policy.direction;
        const policyApplicability = policy.applicability;
        const candidateId = policy.candidateId;
        const policyHashValue = policy.policyHash;
        if (typeof policyStage !== "string" || !(SEQUENTIAL_STAGES as readonly string[]).includes(policyStage)
            || typeof policyStrategy !== "string" || policyStrategy !== strategyForStage(policyStage as StageId)
            || (policyDirection !== "LONG" && policyDirection !== "SHORT")
            || !stageAcceptsDirection(policyStage as StageId, policyDirection)
            || policyApplicability !== "AVAILABLE"
            || typeof candidateId !== "string" || candidateId.length === 0
            || typeof policyHashValue !== "string" || policyHashValue.length === 0
            || policy.sourceHash !== sourceHash || policy.configHash !== configHash || policy.resultHash !== resultHash) {
            throw new Error(`FROZEN_STAGE_POLICY_INVALID: ${path} policy ${index} lineage or metadata mismatch`);
        }
        policyStages.push(policyStage as StageId);
    }
    if (policyStages.some((entry, index) => entry !== normalizedStageIds[index])) throw new Error(`FROZEN_STAGE_POLICY_INVALID: ${path} policy stage order mismatch`);
    if (completedStageIds.length > 0 && (!Array.isArray(object.stageDecisions) || object.stageDecisions.length < completedStageIds.length)) throw new Error(`FROZEN_STAGE_METADATA: ${path} stageDecisions are required for completed stages`);
    if (Array.isArray(object.stageDecisions)) {
        for (const [index, decisionValue] of object.stageDecisions.entries()) {
            if (typeof decisionValue !== "object" || decisionValue === null || Array.isArray(decisionValue)) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} decision ${index} is not an object`);
            const decision = decisionValue as JsonObject;
            const decisionStage = decision.stageId;
            if (index < completedStageIds.length && decisionStage !== completedStageIds[index]) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} decision ${index} stage mismatch`);
            if (decisionStage !== undefined && (typeof decisionStage !== "string" || !(SEQUENTIAL_STAGES as readonly string[]).includes(decisionStage))) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} decision ${index} stage is invalid`);
            if (index < completedStageIds.length && decision.status === "ACCEPTED") {
                const decisionPolicy = decision.candidatePolicy;
                if (typeof decisionPolicy !== "object" || decisionPolicy === null || Array.isArray(decisionPolicy)) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} decision ${index} accepted policy is missing`);
                const policyObject = decisionPolicy as JsonObject;
                if (policyObject.stageId !== decisionStage || policyObject.candidateId !== decision.candidateId || policyObject.policyHash !== decision.policyHash || policyObject.sourceHash !== decision.sourceHash || policyObject.configHash !== decision.configHash || policyObject.resultHash !== decision.resultHash) {
                    throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} decision ${index} policy lineage mismatch`);
                }
            }
            if (index < completedStageIds.length && decision.status === "NOT_APPLICABLE" && decision.candidatePolicy !== null && decision.candidatePolicy !== undefined) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} NOT_APPLICABLE decision ${index} carries a policy`);
        }
    }
    return {
        sourceHash,
        configHash,
        resultHash,
        policyHash,
        stageIds: normalizedStageIds,
        policies: policies as unknown as FrozenStageSet["policies"],
        reason,
        completedStageIds,
        stageDecisions: Array.isArray(object.stageDecisions) ? object.stageDecisions as unknown as FrozenStageSet["stageDecisions"] : undefined,
    };
}

export async function loadFrozenStageSet(path: string): Promise<FrozenStageSet> {
    const resolved = resolve(path);
    const content = await readFile(resolved, "utf8");
    let parsed: JsonValue;
    try {
        parsed = JSON.parse(content) as JsonValue;
    } catch (error) {
        throw new Error(`FROZEN_STAGE_INVALID: ${resolved}: ${errorMessage(error)}`);
    }
    return parseFrozenStage(parsed, resolved);
}

export async function writeFrozenStageSet(path: string, frozen: FrozenStageSet): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(frozen, null, 2), "utf8");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runBaseline(parseRunnerArgs()).then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (result.status !== "ACCEPTED") process.exitCode = 1;
    }).catch((error: unknown) => {
        process.stderr.write(`${errorMessage(error)}\n`);
        process.exitCode = 1;
    });
}
