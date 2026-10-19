import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { replayIntegrated, type ExecutionLifecycleEvent, type IntegratedReplayResult, type ReplayConfigWithRuntime } from "../../lib/backtest/dd-reduction/emulator";
import { attributeReplay, writeStageArtifacts } from "../../lib/backtest/dd-reduction/reporting";
import { loadCanonicalSource, SourceContractError } from "../../lib/backtest/dd-reduction/source";
import { directionForStage, SEQUENTIAL_STAGES, stageAcceptsDirection, strategyForStage } from "../../lib/backtest/dd-reduction/stages";
import type {
    CanonicalSource,
    Direction,
    FrozenStageSet,
    BaselineLedgerEntry,
    JsonObject,
    JsonValue,
    ProductionPolicy,
    ProtectionReadbackEvidence,
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
    readonly protectionReadbackHash?: string;
    readonly evaluationEvidence?: EvaluationEvidence;
    readonly executionEvents?: readonly ExecutionLifecycleEvent[];
    readonly protectionReadbackPath?: string;
    readonly protectionReadbackEvidence?: ProtectionReadbackEvidence;
}

export interface EvaluationEvidence {
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
    readonly lineageHash: string;
    readonly metrics: Readonly<Record<string, number>>;
}

export function hashProtectionReadbackEvidence(evidence: ProtectionReadbackEvidence): string {
    return hashJson({
        available: evidence.available,
        candidateId: evidence.candidateId,
        orders: [...evidence.orders].sort((left, right) => left.candidateId.localeCompare(right.candidateId)) as unknown as JsonValue,
        sourceHash: evidence.sourceHash,
        stageId: evidence.stageId,
    });
}

export interface ProtectionReadbackExpectation {
    readonly candidateId: string;
    readonly clientOrderId: string;
    readonly symbol: string;
    readonly side: Direction;
    readonly quantity: number;
    readonly price: number;
}

export function protectionReadbackExpectations(source: CanonicalSource): readonly ProtectionReadbackExpectation[] {
    return source.candidateEvents.filter((candidate) => candidate.fill !== null).map((candidate) => ({
        candidateId: candidate.candidateId,
        clientOrderId: candidate.clientOrderId ?? candidate.candidateId,
        symbol: candidate.symbol,
        side: candidate.direction,
        quantity: candidate.fill!.quantity,
        price: candidate.fill!.price,
    }));
}

export function validateProtectionReadback(evidence: ProtectionReadbackEvidence, expected: {
    readonly sourceHash: string;
    readonly configHash: string;
    readonly frozenStageHash: string;
    readonly stageId: StageId;
    readonly candidateId: string;
    readonly filledCandidates: readonly ProtectionReadbackExpectation[];
}): void {
    if (!evidence.available || evidence.sourceHash !== expected.sourceHash || evidence.configHash !== expected.configHash
        || evidence.frozenStageHash !== expected.frozenStageHash || evidence.stageId !== expected.stageId || evidence.candidateId !== expected.candidateId
        || hashProtectionReadbackEvidence(evidence) !== evidence.lineageHash) throw new Error("PROTECTION_READBACK_INVALID_LINEAGE");
    if (evidence.orders.some((order) => order.status !== "READ_BACK" || order.clientOrderId.length === 0 || !Number.isFinite(order.quantity) || order.quantity <= 0
        || order.symbol.length === 0 || (order.side !== "LONG" && order.side !== "SHORT") || !Number.isFinite(order.price) || order.price <= 0
        || order.candidateId.length === 0)) throw new Error("PROTECTION_READBACK_INVALID");
    if (evidence.orders.length !== expected.filledCandidates.length) throw new Error("PROTECTION_READBACK_ONE_TO_ONE_MISMATCH");
    const expectedByCandidate = new Map(expected.filledCandidates.map((candidate) => [candidate.candidateId, candidate]));
    const actualByCandidate = new Map(evidence.orders.map((order) => [order.candidateId, order]));
    const expectedClientOrderIds = new Set(expected.filledCandidates.map((candidate) => candidate.clientOrderId));
    const actualClientOrderIds = new Set(evidence.orders.map((order) => order.clientOrderId));
    if (expectedClientOrderIds.size !== expected.filledCandidates.length || actualClientOrderIds.size !== evidence.orders.length) throw new Error("PROTECTION_READBACK_DUPLICATE_CLIENT_ORDER");
    if (actualByCandidate.size !== evidence.orders.length) throw new Error("PROTECTION_READBACK_DUPLICATE_CANDIDATE");
    for (const expectedCandidate of expected.filledCandidates) {
        const actual = actualByCandidate.get(expectedCandidate.candidateId);
        if (actual === undefined || actual.clientOrderId !== expectedCandidate.clientOrderId || actual.symbol !== expectedCandidate.symbol
            || actual.side !== expectedCandidate.side || actual.quantity !== expectedCandidate.quantity || actual.price !== expectedCandidate.price) {
            throw new Error(`PROTECTION_READBACK_ORDER_MISMATCH:${expectedCandidate.candidateId}`);
        }
    }
    if (actualByCandidate.size !== expectedByCandidate.size) throw new Error("PROTECTION_READBACK_ONE_TO_ONE_MISMATCH");
}

export async function loadProtectionReadback(args: RunnerArgs): Promise<ProtectionReadbackEvidence | null> {
    if (args.protectionReadbackEvidence !== undefined) return args.protectionReadbackEvidence;
    if (args.protectionReadbackPath === undefined) return null;
    const parsed = JSON.parse(await readFile(args.protectionReadbackPath, "utf8")) as JsonValue;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("PROTECTION_READBACK_INVALID");
    const object = parsed as JsonObject;
    const ordersValue = object.orders;
    if (typeof object.sourceHash !== "string" || typeof object.configHash !== "string" || typeof object.frozenStageHash !== "string" || typeof object.stageId !== "string"
        || typeof object.candidateId !== "string" || typeof object.available !== "boolean" || !Array.isArray(ordersValue) || typeof object.lineageHash !== "string") throw new Error("PROTECTION_READBACK_INVALID");
    const orders = ordersValue.map((value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("PROTECTION_READBACK_INVALID");
        const order = value as JsonObject;
        if (typeof order.candidateId !== "string" || typeof order.clientOrderId !== "string" || typeof order.symbol !== "string" || (order.side !== "LONG" && order.side !== "SHORT")
            || order.status !== "READ_BACK" || typeof order.quantity !== "number" || typeof order.price !== "number") throw new Error("PROTECTION_READBACK_INVALID");
        return { candidateId: order.candidateId, clientOrderId: order.clientOrderId, symbol: order.symbol, side: order.side as Direction, status: "READ_BACK" as const, quantity: order.quantity, price: order.price };
    });
    return { sourceHash: object.sourceHash, configHash: object.configHash, frozenStageHash: object.frozenStageHash, stageId: object.stageId as StageId, candidateId: object.candidateId, available: object.available, orders, lineageHash: object.lineageHash };
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
    return hashJson(JSON.parse(JSON.stringify(frozen)) as JsonValue);
}

export function hashEvaluationEvidence(evidence: EvaluationEvidence): string {
    return hashJson({
        configHash: evidence.configHash,
        candidateId: evidence.candidateId,
        deposits: evidence.deposits,
        endTs: evidence.endTs,
        feeBps: evidence.feeBps,
        fundingSource: evidence.fundingSource,
        frozenStageHash: evidence.frozenStageHash,
        gateHash: evidence.gateHash,
        initialEquity: evidence.initialEquity,
        metrics: evidence.metrics as JsonValue,
        sourceHash: evidence.sourceHash,
        slippageBps: evidence.slippageBps,
        stageId: evidence.stageId,
        startTs: evidence.startTs,
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
        protectionReadbackPath: args.includes("--protection-readback") ? resolve(requiredFlag(args, "--protection-readback")) : undefined,
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

function jsonNumberRecord(object: JsonObject, key: string): Readonly<Record<string, number>> | undefined {
    const value = object[key];
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`SOURCE_ERROR: production config ${key} must be an object`);
    const result: Record<string, number> = {};
    for (const [name, raw] of Object.entries(value)) {
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) throw new Error(`SOURCE_ERROR: production config ${key}.${name} must be a finite non-negative number`);
        result[name] = raw;
    }
    return result;
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

export interface CanonicalCapManifest {
    readonly totalGross: number;
    readonly cryptoGross: number;
    readonly strategyGross: number;
    readonly perStrategy: Readonly<Record<string, number>>;
    readonly perStrategyTotalGross: Readonly<Record<string, number>>;
    readonly perStrategyCryptoGross: Readonly<Record<string, number>>;
    readonly perSymbol: Readonly<Record<string, number>>;
    readonly hash: string;
}

function capNumber(config: JsonObject, key: string, fallback: number): number {
    return jsonNumber(config, key) ?? fallback;
}

export function buildSourceCapManifest(source: CanonicalSource): CanonicalCapManifest {
    const first = source.strategyConfigs[0]?.config;
    if (first === undefined) throw new Error("SOURCE_ERROR: production cap manifest is absent");
    const grossFallback = requiredConfigNumber(first, "grossCap");
    const totalGross = capNumber(first, "totalGrossCap", capNumber(first, "aggregateGrossCap", grossFallback));
    const cryptoGross = capNumber(first, "cryptoGrossCap", totalGross);
    const strategyGross = capNumber(first, "strategyGrossCap", requiredConfigNumber(first, "sharedRiskCap"));
    const perStrategy: Record<string, number> = {};
    const perStrategyTotalGross: Record<string, number> = {};
    const perStrategyCryptoGross: Record<string, number> = {};
    const perSymbol: Record<string, number> = {};
    for (const entry of source.strategyConfigs) {
        const config = entry.config;
        const effectiveTotal = capNumber(config, "totalGrossCap", capNumber(config, "aggregateGrossCap", requiredConfigNumber(config, "grossCap")));
        const effectiveCrypto = capNumber(config, "cryptoGrossCap", effectiveTotal);
        const explicitStrategy = jsonNumber(config, "strategyGrossCap");
        if (effectiveTotal !== totalGross || effectiveCrypto !== cryptoGross) {
            throw new Error(`SOURCE_ERROR: conflicting aggregate cap manifest for ${entry.strategy}`);
        }
        const strategyCap = explicitStrategy ?? requiredConfigNumber(config, "sharedRiskCap");
        if (perStrategy[entry.strategy] !== undefined && perStrategy[entry.strategy] !== strategyCap) throw new Error(`SOURCE_ERROR: conflicting strategy cap manifest for ${entry.strategy}`);
        if (perStrategyTotalGross[entry.strategy] !== undefined && perStrategyTotalGross[entry.strategy] !== effectiveTotal) throw new Error(`SOURCE_ERROR: conflicting total cap manifest for ${entry.strategy}`);
        if (perStrategyCryptoGross[entry.strategy] !== undefined && perStrategyCryptoGross[entry.strategy] !== effectiveCrypto) throw new Error(`SOURCE_ERROR: conflicting crypto cap manifest for ${entry.strategy}`);
        perStrategy[entry.strategy] = strategyCap;
        perStrategyTotalGross[entry.strategy] = effectiveTotal;
        perStrategyCryptoGross[entry.strategy] = effectiveCrypto;
        for (const [symbol, cap] of Object.entries(jsonNumberRecord(config, "perSymbolGrossCaps") ?? {})) {
            if (perSymbol[symbol] !== undefined && perSymbol[symbol] !== cap) throw new Error(`SOURCE_ERROR: conflicting symbol cap manifest for ${symbol}`);
            perSymbol[symbol] = cap;
        }
        for (const [strategy, cap] of Object.entries(jsonNumberRecord(config, "perStrategyGrossCaps") ?? {})) {
            if (perStrategy[strategy] !== undefined && perStrategy[strategy] !== cap) throw new Error(`SOURCE_ERROR: conflicting strategy cap manifest for ${strategy}`);
            perStrategy[strategy] = cap;
        }
    }
    const manifest = { totalGross, cryptoGross, strategyGross, perStrategy, perStrategyTotalGross, perStrategyCryptoGross, perSymbol };
    return { ...manifest, hash: hashJson(manifest as unknown as JsonValue) };
}

export function assertPolicyCaps(policies: readonly ProductionPolicy[], manifest: CanonicalCapManifest): void {
    for (const policy of policies) {
        if (policy.capManifestHash !== undefined && policy.capManifestHash !== manifest.hash) throw new Error("SOURCE_ERROR: policy cap manifest hash mismatch");
        const total = policy.totalGrossCap ?? policy.aggregateGrossCap ?? policy.grossCap;
        const crypto = policy.cryptoGrossCap ?? total;
        const strategy = policy.strategyGrossCap ?? policy.sharedRiskCap;
        if (total !== manifest.totalGross || crypto !== manifest.cryptoGross || total !== manifest.perStrategyTotalGross[policy.strategy]
            || crypto !== manifest.perStrategyCryptoGross[policy.strategy] || strategy !== manifest.perStrategy[policy.strategy]) throw new Error(`SOURCE_ERROR: policy cap declaration is not authoritative for ${policy.strategy}`);
        for (const [name, cap] of Object.entries(policy.perStrategyGrossCaps ?? {})) if (manifest.perStrategy[name] !== cap) throw new Error(`SOURCE_ERROR: policy strategy cap mismatch for ${name}`);
        for (const [name, cap] of Object.entries(policy.perSymbolGrossCaps ?? {})) if (manifest.perSymbol[name] !== cap) throw new Error(`SOURCE_ERROR: policy symbol cap mismatch for ${name}`);
    }
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
    const missingPolicyFields = ["initialStopBps", "profitFloorBps", "trailingGivebackBps"]
        .filter((field) => jsonNumber(strategyConfig.config, field) === null);
    if (timeStopValue !== null && timeStopBars === null) missingPolicyFields.push("timeStopBars");
    if (missingPolicyFields.length > 0) {
        throw new Error(`SOURCE_ERROR: production config missing finite policy fields: ${missingPolicyFields.join(", ")}`);
    }
    const grossCap = requiredConfigNumber(strategyConfig.config, "grossCap");
    const sharedRiskCap = requiredConfigNumber(strategyConfig.config, "sharedRiskCap");
    const totalGrossCap = jsonNumber(strategyConfig.config, "totalGrossCap") ?? jsonNumber(strategyConfig.config, "aggregateGrossCap") ?? grossCap;
    const cryptoGrossCap = jsonNumber(strategyConfig.config, "cryptoGrossCap") ?? totalGrossCap;
    const strategyGrossCap = jsonNumber(strategyConfig.config, "strategyGrossCap") ?? sharedRiskCap;
    const capManifest = buildSourceCapManifest(source);
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
        grossCap,
        sharedRiskCap,
        marginGuard: requiredConfigString(strategyConfig.config, "marginGuard"),
        leverage: requiredConfigNumber(strategyConfig.config, "leverage"),
        initialStopBps: requiredConfigNumber(strategyConfig.config, "initialStopBps"),
        profitFloorBps: requiredConfigNumber(strategyConfig.config, "profitFloorBps"),
        trailingGivebackBps: requiredConfigNumber(strategyConfig.config, "trailingGivebackBps"),
        timeStopBars,
        supportedDirections,
        aggregateGrossCap: totalGrossCap,
        totalGrossCap,
        cryptoGrossCap,
        strategyGrossCap,
        perStrategyGrossCaps: jsonNumberRecord(strategyConfig.config, "perStrategyGrossCaps"),
        perSymbolGrossCaps: jsonNumberRecord(strategyConfig.config, "perSymbolGrossCaps"),
        capManifestHash: capManifest.hash,
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

function ledgerNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1e8) / 1e8 : null;
}

function ledgerFill(value: unknown): JsonValue {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object" || Array.isArray(value)) return "INVALID";
    const object = value as Record<string, unknown>;
    return {
        ts: ledgerNumber(object.ts),
        price: ledgerNumber(object.price),
        quantity: ledgerNumber(object.quantity),
        gross: ledgerNumber(object.gross),
        fee: ledgerNumber(object.fee),
        funding: ledgerNumber(object.funding),
        slippage: ledgerNumber(object.slippage),
        realizedPnl: ledgerNumber(object.realizedPnl),
    };
}

function canonicalLedgerEntry(value: unknown): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { invalid: true };
    const object = value as Record<string, unknown>;
    return {
        tradeId: typeof object.tradeId === "string" ? object.tradeId : null,
        status: object.finalExit === null || object.finalExit === undefined ? "OPEN" : "CLOSED",
        strategy: typeof object.strategy === "string" ? object.strategy : null,
        direction: typeof object.direction === "string" ? object.direction : null,
        symbol: typeof object.symbol === "string" ? object.symbol : null,
        requestedGross: ledgerNumber(object.requestedGross),
        acceptedGross: ledgerNumber(object.acceptedGross),
        entry: ledgerFill(object.entry),
        finalExit: ledgerFill(object.finalExit),
        fee: ledgerNumber(object.fee),
        funding: ledgerNumber(object.funding),
        slippage: ledgerNumber(object.slippage),
    };
}

function canonicalLedgerHash(entries: readonly unknown[]): string {
    return hashJson([...entries].map(canonicalLedgerEntry).sort((left, right) => String(left.tradeId).localeCompare(String(right.tradeId))) as unknown as JsonValue);
}

export function evaluateBaselineParity(source: CanonicalSource, policy: ProductionPolicy, replay: { readonly positions: readonly { readonly positionId: string; readonly acceptedGross: number }[]; readonly baselineTradeLedger?: readonly BaselineLedgerEntry[] }): BaselineParityCheck {
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
    const productionEntries = evidence?.entries ?? evidence?.ledger;
    if (!Array.isArray(productionEntries)) mismatches.push("production.baselineParity.entries");
    else if (canonicalLedgerHash(source.baselineLedger) !== canonicalLedgerHash(productionEntries)) mismatches.push("canonicalLedger");
    const replayLedger = replay.baselineTradeLedger;
    if (!Array.isArray(replayLedger)) mismatches.push("replay.completeLedgerMissing");
    else if (canonicalLedgerHash(source.baselineLedger) !== canonicalLedgerHash(replayLedger)) mismatches.push("replay.completeLedger");
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
        protectionReadbackHash: args.protectionReadbackHash ?? null,
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

export function buildBaselineReplayConfig(args: RunnerArgs, source: CanonicalSource, policy: ProductionPolicy, configHash: string): ReplayConfigWithRuntime {
    const manifest = buildSourceCapManifest(source);
    assertPolicyCaps([policy], manifest);
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

function assertReplaySafety(replay: IntegratedReplayResult): void {
    if (replay.reason === "MANUAL_REVIEW_REQUIRED") throw new Error("MANUAL_REVIEW_REQUIRED: replay safety marker is present");
    if (replay.portfolio.some((point) => ((point as unknown as { readonly manualReview?: readonly string[] }).manualReview?.length ?? 0) > 0)) {
        throw new Error("MANUAL_REVIEW_REQUIRED: replay portfolio contains a safety marker");
    }
}

async function persistResult(args: RunnerArgs, result: StageResult, extra: Record<string, object | string | number | boolean | null> = {}): Promise<StageResult> {
    const runDirectory = join(assertRunnerOutputRoot(args.outputRoot), args.stage, result.runId ?? result.resultHash);
    await mkdir(dirname(runDirectory), { recursive: true });
    try {
        await mkdir(runDirectory);
    } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new Error("RESEARCH_ARTIFACT_EXISTS: deterministic run directory is immutable");
        }
        throw error;
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
        const policy = policyFromSource(source, args.stage);
        const protectionReadback = await loadProtectionReadback(args);
        const protectionReadbackHash = protectionReadback === null ? undefined : hashProtectionReadbackEvidence(protectionReadback);
        const hashes = resultHashes({ ...args, protectionReadbackHash }, manifest.sourceSha);
        const filledCandidates = protectionReadbackExpectations(source);
        if (filledCandidates.length > 0 && protectionReadback === null) throw new Error("PROTECTION_READBACK_UNAVAILABLE");
        if (protectionReadback !== null) {
            validateProtectionReadback(protectionReadback, {
                sourceHash: manifest.sourceSha,
                configHash: hashes.configHash,
                frozenStageHash: hashJson({ baseline: true, sourceHash: manifest.sourceSha, configHash: hashes.configHash }),
                stageId: args.stage,
                candidateId: args.candidate,
                filledCandidates,
            });
        }
        if (source.baselineLedger.length === 0) {
            return persistResult(args, failedResult(args, "BASELINE_PARITY_BLOCKED", "BASELINE_PARITY_BLOCKED: baseline ledger evidence is absent", manifest.sourceSha), {
                manifest,
                runId: hashes.runId,
                parity: "ABSENT",
            });
        }
        const replay = replayIntegrated(source, buildBaselineReplayConfig({ ...args, protectionReadbackEvidence: protectionReadback ?? undefined }, source, policy, hashes.configHash));
        assertReplaySafety(replay);
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
    const completedValue = object.completedStageIds;
    const completedStageIds = Array.isArray(completedValue)
        ? completedValue.filter((entry): entry is StageId => typeof entry === "string" && (SEQUENTIAL_STAGES as readonly string[]).includes(entry))
        : stageIds.filter((entry): entry is StageId => typeof entry === "string" && (SEQUENTIAL_STAGES as readonly string[]).includes(entry));
    if (completedStageIds.length !== (Array.isArray(completedValue) ? completedValue.length : stageIds.length)
        || completedStageIds.some((entry, index) => entry !== SEQUENTIAL_STAGES[index])) {
        throw new Error(`FROZEN_STAGE_METADATA: ${path} completedStageIds is not an exact sequential prefix`);
    }
    const lineagesValue = object.stageLineages;
    if (Array.isArray(lineagesValue)) {
        if (lineagesValue.length !== completedStageIds.length) throw new Error(`FROZEN_STAGE_METADATA: ${path} stageLineages must cover every completed stage`);
        const lineages = lineagesValue.map((entry, index) => {
            if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`FROZEN_STAGE_LINEAGE_INVALID: ${path} lineage ${index}`);
            const lineage = entry as JsonObject;
            if (lineage.stageId !== completedStageIds[index] || (lineage.status !== "ACCEPTED" && lineage.status !== "NOT_APPLICABLE")
                || !isHash(lineage.sourceHash) || !isHash(lineage.configHash) || !isHash(lineage.resultHash) || !isHash(lineage.policyHash)
                || typeof lineage.decisionIndex !== "number" || !Number.isInteger(lineage.decisionIndex) || lineage.decisionIndex < 0) {
                throw new Error(`FROZEN_STAGE_LINEAGE_INVALID: ${path} lineage ${index}`);
            }
            if (lineage.status === "ACCEPTED") {
                const candidate = lineage.candidatePolicy as JsonObject | null | undefined;
                if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)
                    || candidate.stageId !== lineage.stageId || candidate.applicability !== "AVAILABLE"
                    || candidate.sourceHash !== lineage.sourceHash || candidate.configHash !== lineage.configHash || candidate.resultHash !== lineage.resultHash || candidate.policyHash !== lineage.policyHash) {
                    throw new Error(`FROZEN_STAGE_LINEAGE_INVALID: ${path} accepted lineage ${index} policy mismatch`);
                }
            } else if (lineage.candidatePolicy !== null && lineage.candidatePolicy !== undefined) {
                throw new Error(`FROZEN_STAGE_LINEAGE_INVALID: ${path} NOT_APPLICABLE lineage ${index} carries a policy`);
            }
            return lineage;
        });
        const accepted = lineages.filter((entry) => entry.status === "ACCEPTED");
        const normalizedAcceptedStageIds = stageIds.filter((entry): entry is StageId => typeof entry === "string" && (SEQUENTIAL_STAGES as readonly string[]).includes(entry));
        if (normalizedAcceptedStageIds.length !== stageIds.length || accepted.map((entry) => entry.stageId).join(",") !== normalizedAcceptedStageIds.join(",")) throw new Error(`FROZEN_STAGE_METADATA: ${path} accepted stageIds do not match stageLineages`);
        if (policies.length !== accepted.length) throw new Error(`FROZEN_STAGE_INVALID: ${path} must contain one policy for every accepted stage`);
        if (completedStageIds.length > 0 && (!Array.isArray(object.stageDecisions) || object.stageDecisions.length < completedStageIds.length)) throw new Error(`FROZEN_STAGE_METADATA: ${path} stageDecisions are required for completed stages`);
        if (Array.isArray(object.stageDecisions)) {
            for (const [index, lineage] of lineages.entries()) {
                const decisionIndex = lineage.decisionIndex as number;
                const decisionValue = (object.stageDecisions as readonly JsonValue[])[decisionIndex];
                if (decisionValue === undefined || typeof decisionValue !== "object" || decisionValue === null || Array.isArray(decisionValue)) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} decision ${decisionIndex}`);
                const decision = decisionValue as JsonObject;
                if (decision.stageId !== lineage.stageId || decision.status !== lineage.status || decision.sourceHash !== lineage.sourceHash || decision.configHash !== lineage.configHash || decision.resultHash !== lineage.resultHash || decision.policyHash !== lineage.policyHash) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} decision ${decisionIndex} lineage mismatch`);
                if (lineage.status === "ACCEPTED" && (typeof decision.candidatePolicy !== "object" || decision.candidatePolicy === null || Array.isArray(decision.candidatePolicy))) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} accepted decision ${decisionIndex} policy missing`);
                if (lineage.status === "NOT_APPLICABLE" && decision.candidatePolicy !== null && decision.candidatePolicy !== undefined) throw new Error(`FROZEN_STAGE_DECISION_INVALID: ${path} NOT_APPLICABLE decision ${decisionIndex} carries a policy`);
            }
        }
        const aggregateHash = object.aggregateHash;
        if (!isHash(aggregateHash) || aggregateHash !== hashJson(lineages as unknown as JsonValue)) throw new Error(`FROZEN_STAGE_METADATA: ${path} aggregateHash mismatch`);
        return {
            sourceHash, configHash, resultHash, policyHash, stageIds: normalizedAcceptedStageIds,
            policies: policies as unknown as FrozenStageSet["policies"], reason,
            completedStageIds,
            stageDecisions: Array.isArray(object.stageDecisions) ? object.stageDecisions as unknown as FrozenStageSet["stageDecisions"] : undefined,
            stageLineages: lineages as unknown as FrozenStageSet["stageLineages"],
            aggregateHash: typeof aggregateHash === "string" ? aggregateHash : undefined,
        };
    }
    const normalizedStageIds = stageIds.filter((entry): entry is StageId => typeof entry === "string" && (SEQUENTIAL_STAGES as readonly string[]).includes(entry));
    if (normalizedStageIds.length !== stageIds.length || normalizedStageIds.some((entry, index) => entry !== SEQUENTIAL_STAGES[index])) throw new Error(`FROZEN_STAGE_INVALID: ${path} is not a cumulative sequential prefix`);
    if (normalizedStageIds.length > 0 || policies.length > 0 || completedStageIds.length > 0) throw new Error(`FROZEN_STAGE_LINEAGE_REQUIRED: ${path} non-empty legacy frozen sets require stageLineages and aggregateHash`);
    return { sourceHash, configHash, resultHash, policyHash, stageIds: normalizedStageIds, policies: policies as unknown as FrozenStageSet["policies"], reason, completedStageIds: normalizedStageIds, stageDecisions: Array.isArray(object.stageDecisions) ? object.stageDecisions as unknown as FrozenStageSet["stageDecisions"] : undefined };
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
