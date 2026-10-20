import { createHash } from "node:crypto";

import {
    CANDIDATE_SOURCE_KINDS,
    DYNAMIC_STRATEGY_IDS,
    EVIDENCE_LEVELS,
    type CandidateEvidence,
    type CandidateSide,
    type CandidateSourceInput,
    type CandidateSourceRecord,
    type CandidateValidity,
    type CostScenario,
    type CoverageEntry,
    type DynamicCandidateEvent,
    type DynamicCandidateSourceResult,
    type DynamicStrategyId,
    type EvidenceLevel,
    type CandidateSourceManifest,
    type SourceHashIndexEntry,
} from "./dynamic-types";

export class DynamicCandidateSourceError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(`${code}: ${message}`);
        this.name = "DynamicCandidateSourceError";
        this.code = code;
    }
}

const STRATEGIES = new Set<string>(DYNAMIC_STRATEGY_IDS);
const EVIDENCE = new Set<string>(EVIDENCE_LEVELS);
const SOURCE_KINDS = new Set<string>(CANDIDATE_SOURCE_KINDS);
const VALIDITIES = new Set<string>(["VALID", "INVALID", "UNKNOWN"]);
const REQUIRED_FIELDS = ["side", "price", "validity"] as const;

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function error(code: string, message: string): never {
    throw new DynamicCandidateSourceError(code, message);
}

function requiredString(row: Readonly<Record<string, unknown>>, key: string, context: string): string {
    const value = row[key];
    if (typeof value !== "string" || value.trim().length === 0) error(`INVALID_${context}`, `${key} must be a non-empty string`);
    return value;
}

function optionalBoolean(row: Readonly<Record<string, unknown>>, key: string, context: string): boolean | null {
    const value = row[key];
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "boolean") error(`INVALID_${context}`, `${key} must be boolean`);
    return value;
}

function sourceHash(value: string, path: string): string {
    if (!/^[a-f0-9]{64}$/i.test(value)) error("INVALID_SOURCE_HASH", `${path} must provide a SHA256 hex digest`);
    return value.toLowerCase();
}

function numberList(value: number | readonly number[] | undefined, fallback: readonly number[]): number[] {
    const values = value === undefined ? [...fallback] : typeof value === "number" ? [value] : [...value];
    if (values.length === 0 || values.some((item) => !Number.isFinite(item) || item < 0)) error("INVALID_COST_SCENARIO", "costs must be non-negative finite numbers");
    return values;
}

function costScenarios(input: CandidateSourceInput): readonly CostScenario[] {
    const fees = numberList(input.feeBps, [10, 30]);
    const slippage = numberList(input.slippageBps, [10, 30]);
    if (fees.length === slippage.length) return fees.map((feeBps, index) => ({ feeBps, slippageBps: slippage[index] as number }));
    if (fees.length === 1) return slippage.map((slippageBps) => ({ feeBps: fees[0] as number, slippageBps }));
    if (slippage.length === 1) return fees.map((feeBps) => ({ feeBps, slippageBps: slippage[0] as number }));
    error("INVALID_COST_SCENARIO", "feeBps and slippageBps must have equal lengths or one side must contain one value");
}

function validateRecord(record: CandidateSourceRecord): void {
    if (!SOURCE_KINDS.has(record.kind)) error("UNSUPPORTED_SOURCE_KIND", `${String(record.kind)} is not supported`);
    if (typeof record.path !== "string" || record.path.trim().length === 0) error("INVALID_SOURCE_RECORD", "path must be a non-empty string");
    sourceHash(record.sourceSha256, record.path);
    if (!EVIDENCE.has(record.evidence)) error("UNSUPPORTED_EVIDENCE", `${String(record.evidence)} is not an allowed evidence level`);
    if (!Array.isArray(record.rows)) error("INVALID_SOURCE_RECORD", `${record.path} rows must be an array`);
}

function normalizeRow(row: Readonly<Record<string, unknown>>, record: CandidateSourceRecord, rowIndex: number, seen: Set<string>): DynamicCandidateEvent {
    if (typeof row !== "object" || row === null || Array.isArray(row)) error("INVALID_CANDIDATE_ROW", `${record.path}:${rowIndex} must be an object`);
    const candidateId = requiredString(row, "candidateId", "CANDIDATE_ROW");
    if (seen.has(candidateId)) error("DUPLICATE_CANDIDATE_ID", `${candidateId} appears more than once`);
    seen.add(candidateId);

    const strategy = requiredString(row, "strategy", "CANDIDATE_ROW");
    if (!STRATEGIES.has(strategy)) error("UNKNOWN_STRATEGY", `${strategy} is not an allowed dynamic strategy`);
    const ts = row.ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) error("INVALID_TIMESTAMP", `${record.path}:${rowIndex} ts must be finite`);
    const symbol = requiredString(row, "symbol", "CANDIDATE_ROW");

    const missingFields: ("side" | "price" | "validity")[] = [];
    const sideValue = row.side;
    let side: CandidateSide | null = null;
    if (sideValue === undefined || sideValue === null || sideValue === "") missingFields.push("side");
    else if (sideValue === "LONG" || sideValue === "SHORT") side = sideValue;
    else error("INVALID_SIDE", `${record.path}:${rowIndex} side must be LONG or SHORT`);

    const priceValue = row.price;
    let price: number | null = null;
    if (priceValue === undefined || priceValue === null || priceValue === "") missingFields.push("price");
    else if (typeof priceValue === "number" && Number.isFinite(priceValue) && priceValue > 0) price = priceValue;
    else error("INVALID_PRICE", `${record.path}:${rowIndex} price must be a positive finite number`);

    const validityValue = row.validity;
    let validity: CandidateValidity = "UNKNOWN";
    if (validityValue === undefined || validityValue === null || validityValue === "") missingFields.push("validity");
    else if (validityValue === "VALID" || validityValue === "INVALID" || validityValue === "UNKNOWN") validity = validityValue;
    else error("INVALID_VALIDITY", `${record.path}:${rowIndex} validity must be VALID, INVALID, or UNKNOWN`);

    const evidence: CandidateEvidence = {
        level: record.evidence,
        sourceKind: record.kind,
        sourcePath: record.path,
        sourceSha256: sourceHash(record.sourceSha256, record.path),
        rowNumber: rowIndex,
    };
    const evidenceFailClosed = record.evidence === "MISSING" || record.evidence === "UNVERIFIABLE";
    const failClosed = missingFields.length > 0 || evidenceFailClosed || validity !== "VALID";
    const reason = missingFields.length > 0
        ? `missing required fields: ${missingFields.join(", ")}`
        : evidenceFailClosed
            ? `evidence level ${record.evidence} is fail-closed`
            : validity !== "VALID"
                ? `candidate validity is ${validity}`
                : null;
    return {
        candidateId,
        strategy: strategy as DynamicStrategyId,
        ts,
        symbol,
        side,
        price,
        validity,
        accepted: optionalBoolean(row, "accepted", "CANDIDATE_ROW"),
        evidence,
        failClosed,
        missingFields,
        reason,
    };
}

function sourceHashIndex(records: readonly CandidateSourceRecord[]): readonly SourceHashIndexEntry[] {
    return records
        .map((record) => ({
            path: record.path,
            sha256: sourceHash(record.sourceSha256, record.path),
            rowCount: record.rows.length,
            bytes: Buffer.byteLength(stableJson(record.rows), "utf8"),
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
}

function emptyStrategyCounts(): Record<DynamicStrategyId, number> {
    return Object.fromEntries(DYNAMIC_STRATEGY_IDS.map((strategy) => [strategy, 0])) as Record<DynamicStrategyId, number>;
}

function buildCoverage(events: readonly DynamicCandidateEvent[], scenarios: readonly CostScenario[]): readonly CoverageEntry[] {
    return scenarios.flatMap((scenario) => DYNAMIC_STRATEGY_IDS.map((strategy) => {
        const strategyEvents = events.filter((event) => event.strategy === strategy);
        return {
            strategy,
            feeBps: scenario.feeBps,
            slippageBps: scenario.slippageBps,
            observedRows: strategyEvents.length,
            normalizedRows: strategyEvents.filter((event) => !event.failClosed).length,
            failClosedRows: strategyEvents.filter((event) => event.failClosed).length,
            evidenceLevels: [...new Set(strategyEvents.map((event) => event.evidence.level))].sort(),
            sourcePaths: [...new Set(strategyEvents.map((event) => event.evidence.sourcePath))].sort(),
            missingReasons: [...new Set(strategyEvents.flatMap((event) => event.reason === null ? [] : [event.reason]))].sort(),
        };
    }));
}

export function normalizeDynamicCandidates(input: CandidateSourceInput): DynamicCandidateSourceResult {
    if (!Array.isArray(input.records) || input.records.length === 0) error("SOURCE_RECORDS_MISSING", "at least one candidate source record is required");
    for (const record of input.records) validateRecord(record);
    const seen = new Set<string>();
    const events: DynamicCandidateEvent[] = [];
    for (const record of input.records) {
        for (let index = 0; index < record.rows.length; index += 1) {
            const row = record.rows[index];
            if (row === undefined) continue;
            events.push(normalizeRow(row, record, index + 1, seen));
        }
    }
    const strategyCounts = emptyStrategyCounts();
    for (const event of events) strategyCounts[event.strategy] += 1;
    const scenarios = costScenarios(input);
    return {
        events,
        observedRowCount: events.length,
        failClosedRowCount: events.filter((event) => event.failClosed).length,
        sourceHashes: sourceHashIndex(input.records),
        costScenarios: scenarios,
        coverageMatrix: buildCoverage(events, scenarios),
        strategyCounts,
    };
}

export function buildCandidateSourceManifest(result: DynamicCandidateSourceResult): CandidateSourceManifest {
    return {
        manifestVersion: 1,
        observedRowCount: result.observedRowCount,
        normalizedRowCount: result.events.length,
        failClosedRowCount: result.failClosedRowCount,
        strategyCounts: result.strategyCounts,
        costScenarios: result.costScenarios,
        coverageMatrix: result.coverageMatrix,
        sourceHashes: result.sourceHashes,
        sha256Index: result.sourceHashes,
    };
}

export const normalizeCandidateSources = normalizeDynamicCandidates;
export const buildDynamicCandidateSourceManifest = buildCandidateSourceManifest;

export type { CandidateSourceRecord } from "./dynamic-types";
