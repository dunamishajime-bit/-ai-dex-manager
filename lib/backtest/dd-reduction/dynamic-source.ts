import {
    CANDIDATE_SOURCE_KINDS,
    DYNAMIC_STRATEGY_IDS,
    EVIDENCE_LEVELS,
    type CandidateEvidence,
    type CandidateSide,
    type CandidateSourceInput,
    type CandidateSourceKind,
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
    type PlannedExit,
    type ObservedCandidateStatus,
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

function error(code: string, message: string): never {
    throw new DynamicCandidateSourceError(code, message);
}

function requiredString(row: Readonly<Record<string, unknown>>, key: string, context: string): string {
    const value = row[key];
    if (typeof value !== "string" || value.trim().length === 0) error(`INVALID_${context}`, `${key} must be a non-empty string`);
    return value;
}

type CandidateRow = Readonly<Record<string, unknown>>;

function nestedValue(row: CandidateRow, path: string): unknown {
    return path.split(".").reduce<unknown>((value, key) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
        return (value as CandidateRow)[key];
    }, row);
}

function firstValue(row: CandidateRow, paths: readonly string[]): unknown {
    for (const path of paths) {
        const value = nestedValue(row, path);
        if (value !== undefined) return value;
    }
    return undefined;
}

function candidateField(row: CandidateRow, kind: CandidateSourceRecord["kind"], field: string, paths: readonly string[], required = true): unknown {
    const value = firstValue(row, paths);
    if (value === undefined && required) error(`INVALID_${kind}`, `${field} is required for ${kind}`);
    return value;
}

export interface AdaptedCandidateRow {
    readonly candidateId: unknown;
    readonly eventId: unknown;
    readonly strategy: unknown;
    readonly stageId: unknown;
    readonly route: unknown;
    readonly family: unknown;
    readonly symbol: unknown;
    readonly side: unknown;
    readonly signalTsMs: unknown;
    readonly decisionTsMs: unknown;
    readonly eventSeq: unknown;
    readonly rank: unknown;
    readonly score: unknown;
    readonly priority: unknown;
    readonly status: unknown;
    readonly entryValidUntilMs: unknown;
    readonly requestedGross: unknown;
    readonly worstCaseGross: unknown;
    readonly entryPrice: unknown;
    readonly entryPriceSource: unknown;
    readonly plannedExit: unknown;
    readonly sourceSha: unknown;
    readonly configSha: unknown;
    readonly dataSha: unknown;
    readonly validity: unknown;
    readonly accepted: unknown;
    readonly evidenceLevel: unknown;
}

function adaptCandidateRow(row: CandidateRow, kind: CandidateSourceRecord["kind"]): AdaptedCandidateRow {
    const prefix = kind === "SAVED_MARKET_DATA" ? ["candidate.", "event.", ""] : kind === "STRATEGY_ADAPTER" ? ["candidate.", "signal.", ""] : [""];
    const paths = (names: readonly string[]): string[] => prefix.flatMap((base) => names.map((name) => `${base}${name}`));
    return {
        candidateId: candidateField(row, kind, "candidateId", paths(["candidateId", "candidate_id", "id"])),
        eventId: firstValue(row, paths(["eventId", "event_id"])),
        strategy: candidateField(row, kind, "strategy", paths(["strategy", "strategy_id", "strategyId"])),
        stageId: firstValue(row, paths(["stageId", "stage_id", "stage"])),
        route: firstValue(row, paths(["route"])),
        family: firstValue(row, paths(["family"])),
        symbol: candidateField(row, kind, "symbol", paths(["symbol"])),
        side: firstValue(row, paths(["side"])),
        signalTsMs: firstValue(row, paths(["signalTsMs", "signal_ts_ms", "signal_ts", "timestamps.signal_ts_ms"])),
        decisionTsMs: firstValue(row, paths(["decisionTsMs", "decision_ts_ms", "decision_ts", "ts", "timestamps.decision_ts_ms"])),
        eventSeq: firstValue(row, paths(["eventSeq", "event_seq", "seq", "timestamps.event_seq"])),
        rank: firstValue(row, paths(["rank", "ranking.rank"])),
        score: firstValue(row, paths(["score", "ranking.score"])),
        priority: firstValue(row, paths(["priority", "ranking.priority"])),
        status: firstValue(row, paths(["candidateStatus", "candidate_status", "status", "decision_status"])),
        entryValidUntilMs: firstValue(row, paths(["entryValidUntilMs", "entry_valid_until_ms", "entry_valid_until"])),
        requestedGross: firstValue(row, paths(["requestedGross", "requested_gross", "gross.requested_gross"])),
        worstCaseGross: firstValue(row, paths(["worstCaseGross", "worst_case_gross", "gross.worst_case_gross"])),
        entryPrice: firstValue(row, paths(["entryPrice", "entry_price", "price", "entry.price"])),
        entryPriceSource: firstValue(row, paths(["entryPriceSource", "entry_price_source", "entry.price_source"])),
        plannedExit: firstValue(row, paths(["plannedExit", "planned_exit", "exit", "planned.exit"])),
        sourceSha: firstValue(row, paths(["sourceSha", "source_sha", "sourceHash", "hashes.source_sha"])),
        configSha: firstValue(row, paths(["configSha", "config_sha", "configHash", "hashes.config_sha"])),
        dataSha: firstValue(row, paths(["dataSha", "data_sha", "dataHash", "hashes.data_sha"])),
        validity: firstValue(row, paths(["validity", "entryValidity", "entry_validity"])),
        accepted: firstValue(row, paths(["allocatorAccepted", "allocator_accepted", "accepted"])),
        evidenceLevel: firstValue(row, ["evidence_level", "evidenceLevel", "provenance.evidence_level", "provenance.evidence"]),
    };
}

export interface CandidateSourceAdapter {
    readonly kind: CandidateSourceKind;
    readonly adapt: (row: CandidateRow) => AdaptedCandidateRow;
}

export const CANDIDATE_SOURCE_ADAPTERS: Readonly<Record<CandidateSourceKind, CandidateSourceAdapter>> = {
    RAW_CANDIDATE_DECISIONS: { kind: "RAW_CANDIDATE_DECISIONS", adapt: (row) => adaptCandidateRow(row, "RAW_CANDIDATE_DECISIONS") },
    SAVED_MARKET_DATA: { kind: "SAVED_MARKET_DATA", adapt: (row) => adaptCandidateRow(row, "SAVED_MARKET_DATA") },
    STRATEGY_ADAPTER: { kind: "STRATEGY_ADAPTER", adapt: (row) => adaptCandidateRow(row, "STRATEGY_ADAPTER") },
};

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

function optionalNumber(value: unknown, field: string, context: string): number | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value)) error(`INVALID_${context}`, `${field} must be a finite number`);
    return value;
}

function optionalStringValue(value: unknown, field: string, context: string): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.trim().length === 0) error(`INVALID_${context}`, `${field} must be a non-empty string`);
    return value;
}

function optionalHash(value: unknown, fallback: string | null, field: string, context: string): string | null {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string") error(`INVALID_${context}`, `${field} must be a SHA256 hex string`);
    return sourceHash(value, field);
}

function observedStatus(value: unknown, context: string): ObservedCandidateStatus {
    if (value === undefined || value === null || value === "") return "UNKNOWN";
    if (value === "ACCEPTED" || value === "REJECTED" || value === "NOT_APPLICABLE" || value === "UNKNOWN") return value;
    error(`INVALID_${context}`, "candidate status must be ACCEPTED, REJECTED, NOT_APPLICABLE, or UNKNOWN");
}

function evidenceLevel(value: unknown, fallback: EvidenceLevel, context: string): EvidenceLevel {
    if (value === undefined || value === null || value === "") return fallback;
    if (!EVIDENCE.has(value as string)) error("UNSUPPORTED_EVIDENCE", `${String(value)} is not an allowed evidence level`);
    return value as EvidenceLevel;
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
    if (!Number.isInteger(record.sourceBytes) || record.sourceBytes < 0) error("INVALID_SOURCE_BYTES", `${record.path} must provide a non-negative integer source byte length`);
    if (!EVIDENCE.has(record.evidence)) error("UNSUPPORTED_EVIDENCE", `${String(record.evidence)} is not an allowed evidence level`);
    if (!Array.isArray(record.rows)) error("INVALID_SOURCE_RECORD", `${record.path} rows must be an array`);
}

function normalizeRow(row: Readonly<Record<string, unknown>>, record: CandidateSourceRecord, rowIndex: number, seen: Set<string>): DynamicCandidateEvent {
    if (typeof row !== "object" || row === null || Array.isArray(row)) error("INVALID_CANDIDATE_ROW", `${record.path}:${rowIndex} must be an object`);
    const adapter = CANDIDATE_SOURCE_ADAPTERS[record.kind];
    if (adapter === undefined) error("UNSUPPORTED_SOURCE_KIND", `${String(record.kind)} is not supported`);
    const adapted = adapter.adapt(row);
    const candidateId = typeof adapted.candidateId === "string" && adapted.candidateId.trim().length > 0
        ? adapted.candidateId
        : error(`INVALID_${record.kind}`, `candidateId must be a non-empty string`);
    if (seen.has(candidateId)) error("DUPLICATE_CANDIDATE_ID", `${candidateId} appears more than once`);
    seen.add(candidateId);

    const strategy = typeof adapted.strategy === "string" && adapted.strategy.trim().length > 0
        ? adapted.strategy
        : error(`INVALID_${record.kind}`, "strategy must be a non-empty string");
    if (!STRATEGIES.has(strategy)) error("UNKNOWN_STRATEGY", `${strategy} is not an allowed dynamic strategy`);
    const decisionTsMs = optionalNumber(adapted.decisionTsMs, "decision_ts_ms", "TIMESTAMP");
    const ts = decisionTsMs;
    if (typeof ts !== "number" || !Number.isFinite(ts)) error("INVALID_TIMESTAMP", `${record.path}:${rowIndex} ts must be finite`);
    const symbol = typeof adapted.symbol === "string" && adapted.symbol.trim().length > 0
        ? adapted.symbol
        : error(`INVALID_${record.kind}`, "symbol must be a non-empty string");

    const missingFields: ("side" | "price" | "validity")[] = [];
    const sideValue = adapted.side;
    let side: CandidateSide | null = null;
    if (sideValue === undefined || sideValue === null || sideValue === "") missingFields.push("side");
    else if (sideValue === "LONG" || sideValue === "SHORT") side = sideValue;
    else error("INVALID_SIDE", `${record.path}:${rowIndex} side must be LONG or SHORT`);

    const priceValue = adapted.entryPrice;
    let price: number | null = null;
    if (priceValue === undefined || priceValue === null || priceValue === "") missingFields.push("price");
    else if (typeof priceValue === "number" && Number.isFinite(priceValue) && priceValue > 0) price = priceValue;
    else error("INVALID_PRICE", `${record.path}:${rowIndex} price must be a positive finite number`);

    const validityValue = adapted.validity;
    let validity: CandidateValidity = "UNKNOWN";
    if (validityValue === undefined || validityValue === null || validityValue === "") missingFields.push("validity");
    else if (validityValue === "VALID" || validityValue === "INVALID" || validityValue === "UNKNOWN") validity = validityValue;
    else error("INVALID_VALIDITY", `${record.path}:${rowIndex} validity must be VALID, INVALID, or UNKNOWN`);

    const level = evidenceLevel(adapted.evidenceLevel, record.evidence, "CANDIDATE_ROW");
    const sourceSha = optionalHash(adapted.sourceSha, record.sourceSha256, "source_sha", "CANDIDATE_ROW");
    if (sourceSha === null) error("INVALID_CANDIDATE_ROW", "source_sha is required");
    const evidence: CandidateEvidence = {
        level,
        sourceKind: record.kind,
        sourcePath: record.path,
        sourceSha256: sourceSha,
        rowNumber: rowIndex,
        sourceBytes: record.sourceBytes,
    };
    const evidenceFailClosed = level === "MISSING" || level === "UNVERIFIABLE";
    const failClosed = missingFields.length > 0 || evidenceFailClosed || validity !== "VALID";
    const reason = missingFields.length > 0
        ? `missing required fields: ${missingFields.join(", ")}`
        : evidenceFailClosed
            ? `evidence level ${level} is fail-closed`
            : validity !== "VALID"
                ? `candidate validity is ${validity}`
                : null;
    const observed = observedStatus(adapted.status, "CANDIDATE_ROW");
    const allocatorAccepted = optionalBoolean({ accepted: adapted.accepted }, "accepted", "CANDIDATE_ROW");
    const configSha = optionalHash(adapted.configSha, null, "config_sha", "CANDIDATE_ROW");
    const dataSha = optionalHash(adapted.dataSha, null, "data_sha", "CANDIDATE_ROW");
    const stageId = optionalStringValue(adapted.stageId, "stage_id", "CANDIDATE_ROW");
    const route = optionalStringValue(adapted.route, "route", "CANDIDATE_ROW");
    const family = optionalStringValue(adapted.family, "family", "CANDIDATE_ROW");
    const eventId = optionalStringValue(adapted.eventId, "event_id", "CANDIDATE_ROW");
    const entryPriceSource = optionalStringValue(adapted.entryPriceSource, "entry_price_source", "CANDIDATE_ROW");
    const plannedExit = (adapted.plannedExit === undefined ? null : adapted.plannedExit) as PlannedExit;
    const signalTsMs = optionalNumber(adapted.signalTsMs, "signal_ts_ms", "CANDIDATE_ROW");
    const eventSeq = optionalNumber(adapted.eventSeq, "event_seq", "CANDIDATE_ROW");
    const rank = optionalNumber(adapted.rank, "rank", "CANDIDATE_ROW");
    const score = optionalNumber(adapted.score, "score", "CANDIDATE_ROW");
    const priority = optionalNumber(adapted.priority, "priority", "CANDIDATE_ROW");
    const entryValidUntilMs = optionalNumber(adapted.entryValidUntilMs, "entry_valid_until_ms", "CANDIDATE_ROW");
    const requestedGross = optionalNumber(adapted.requestedGross, "requested_gross", "CANDIDATE_ROW");
    const worstCaseGross = optionalNumber(adapted.worstCaseGross, "worst_case_gross", "CANDIDATE_ROW");
    return {
        candidate_id: candidateId,
        event_id: eventId,
        strategy_id: strategy as DynamicStrategyId,
        stage_id: stageId,
        route,
        family,
        signal_ts_ms: signalTsMs,
        decision_ts_ms: decisionTsMs,
        event_seq: eventSeq,
        rank,
        score,
        priority,
        candidate_status: observed,
        entry_valid_until_ms: entryValidUntilMs,
        requested_gross: requestedGross,
        worst_case_gross: worstCaseGross,
        entry_price: price,
        entry_price_source: entryPriceSource,
        planned_exit: plannedExit,
        source_sha: sourceSha,
        config_sha: configSha,
        data_sha: dataSha,
        evidence_level: level,
        observed_status: observed,
        allocator_accepted: allocatorAccepted,
        candidateId,
        strategy: strategy as DynamicStrategyId,
        ts,
        symbol,
        side,
        price,
        validity,
        accepted: allocatorAccepted,
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
            bytes: record.sourceBytes,
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
        normalizedRowCount: result.events.filter((event) => !event.failClosed).length,
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
