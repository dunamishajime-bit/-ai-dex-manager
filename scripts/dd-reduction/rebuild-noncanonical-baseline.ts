import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DYNAMIC_STRATEGY_IDS, type DynamicStrategyId, type EvidenceLevel } from "../../lib/backtest/dd-reduction/dynamic-types";

type JsonObject = Record<string, unknown>;

export type ProvenanceStatus = EvidenceLevel;

export interface FieldProvenance {
    readonly status: ProvenanceStatus;
    readonly sourceField: string | null;
    readonly value: unknown;
    readonly reason: string | null;
}

export interface RebuiltCandidateRow {
    readonly sourcePath: string;
    readonly sourceSha256: string;
    readonly rowNumber: number;
    readonly candidateId: string | null;
    readonly strategyId: DynamicStrategyId | null;
    readonly decision: string | null;
    readonly fields: Readonly<Record<string, FieldProvenance>>;
    readonly replayReady: boolean;
    readonly replayBlockers: readonly string[];
}

export interface SourceValidation {
    readonly valid: boolean;
    readonly blockers: readonly string[];
    readonly duplicateCandidateIds: readonly string[];
    readonly unknownDecisions: readonly string[];
    readonly unknownStrategies: readonly string[];
    readonly missingStrategies: readonly DynamicStrategyId[];
}

export interface SourceRecoveryReport {
    readonly schemaVersion: 2;
    readonly classification: "REBUILT_BASELINE_NONCANONICAL";
    readonly formalParity: false;
    readonly economicBacktest: false;
    /** Display/provenance metadata only. This field is excluded from report hashes. */
    readonly sourcePath: string;
    readonly sourceSha256: string;
    readonly sourceBytes: number;
    readonly costBps: number;
    readonly observedRows: number;
    readonly replayReadyRows: number;
    readonly failClosedRows: number;
    readonly decisionCounts: Readonly<Record<string, number>>;
    readonly strategyCounts: Readonly<Record<DynamicStrategyId, number>>;
    readonly unknownStrategyCounts: Readonly<Record<string, number>>;
    readonly fieldCoverage: Readonly<Record<string, Readonly<Record<ProvenanceStatus, number>>>>;
    readonly blockerCounts: Readonly<Record<string, number>>;
    readonly sourceValidation: SourceValidation;
    readonly assumptions: readonly string[];
    readonly limitations: readonly string[];
    readonly canonicalOutputSha256: string;
    readonly displayOutputSha256: string;
    readonly reportPayloadHash: string;
    /** Exact SHA of source-recovery-manifest.json, recorded in the report after the manifest is written. */
    readonly manifestFileSha256: string;
}

interface SourceRow extends JsonObject {
    readonly __rowNumber: number;
}

const STRATEGIES = new Set<string>(DYNAMIC_STRATEGY_IDS);
const ALLOWED_DECISIONS = new Set(["ACCEPTED_MODELED_ENTRY", "REJECTED_PORTFOLIO", "EXCLUDED_PREALLOCATION"]);
const ALLOWED_SOURCE_KINDS = new Set(["RAW_CANDIDATE_DECISIONS", "SAVED_MARKET_DATA", "STRATEGY_ADAPTER"]);

const FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = {
    candidateId: ["candidate_id", "candidateId"],
    strategyId: ["strategy_id", "strategyId"],
    symbol: ["symbol"],
    side: ["side"],
    decisionTsMs: ["decision_ts_ms", "decisionTsMs"],
    signalTsMs: ["signal_ts_ms", "signalTsMs"],
    entryTsMs: ["entry_ts_ms", "entryTsMs"],
    decision: ["decision"],
    reason: ["reason"],
    route: ["route"],
    requestedGross: ["requested_gross", "requestedGross"],
    acceptedGross: ["accepted_gross", "acceptedGross"],
    entryPrice: ["candidate_entry_price_usd", "candidateEntryPriceUsd"],
    exitPrice: ["candidate_exit_price_usd", "candidateExitPriceUsd"],
    exitTsMs: ["candidate_exit_ts_ms", "candidateExitTsMs"],
    exitReason: ["candidate_exit_reason", "candidateExitReason"],
    quantity: ["modeled_entry_quantity", "modeledEntryQuantity"],
    entryEquitySettlement: ["entry_equity_settlement", "entryEquitySettlement"],
    modeledEntryPrice: ["modeled_entry_price_usd", "modeledEntryPriceUsd"],
    modeledEntryNotional: ["modeled_entry_notional_settlement", "modeledEntryNotionalSettlement"],
    modeledEntryFee: ["modeled_entry_fee_settlement", "modeledEntryFeeSettlement"],
    rank: ["rank"],
    priority: ["priority"],
    validity: ["validity", "entry_validity"],
    entryValidUntilMs: ["entry_valid_until_ms", "entryValidUntilMs"],
    assetClass: ["asset_class", "assetClass"],
    evidenceLevel: ["evidence_level", "evidenceLevel"],
    evidenceSourceKind: ["evidence_source_kind", "evidenceSourceKind"],
    evidenceSourcePath: ["evidence_source_path", "evidenceSourcePath"],
    evidenceSourceSha256: ["evidence_source_sha256", "evidenceSourceSha256"],
    evidenceRowNumber: ["evidence_row_number", "evidenceRowNumber"],
    evidenceSourceBytes: ["evidence_source_bytes", "evidenceSourceBytes"],
    sourceSha: ["source_sha", "sourceSha"],
    positionId: ["position_id", "positionId"],
    referenceFx: ["reference_fx_jpy_per_usd", "referenceFxJpyPerUsd"],
};

const REQUIRED_REPLAY_FIELDS = [
    "candidateId", "strategyId", "symbol", "side", "decisionTsMs", "entryPrice", "requestedGross", "quantity",
    "entryValidUntilMs", "priority", "assetClass", "validity", "evidenceLevel", "evidenceSourceKind",
    "evidenceSourcePath", "evidenceSourceSha256", "evidenceRowNumber", "evidenceSourceBytes", "sourceSha",
] as const;

function hash(content: Uint8Array): string {
    return createHash("sha256").update(content).digest("hex");
}

function firstPresent(row: SourceRow, aliases: readonly string[]): { readonly key: string; readonly value: unknown } | null {
    for (const key of aliases) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") return { key, value };
    }
    return null;
}

function asString(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

function strategy(value: unknown): DynamicStrategyId | null {
    return typeof value === "string" && STRATEGIES.has(value) ? value as DynamicStrategyId : null;
}

function fieldFromSource(row: SourceRow, field: string): FieldProvenance {
    const found = firstPresent(row, FIELD_ALIASES[field] ?? []);
    if (found !== null) return { status: "ORIGINAL_EVIDENCE", sourceField: found.key, value: found.value, reason: null };
    return { status: "MISSING", sourceField: null, value: null, reason: `source row does not contain a value for ${field}` };
}

function unverifiable(field: string, reason: string): FieldProvenance {
    return { status: "UNVERIFIABLE", sourceField: null, value: null, reason: `${field}: ${reason}` };
}

function readJsonl(content: string, sourcePath: string): SourceRow[] {
    const rows: SourceRow[] = [];
    for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (line.trim() === "") continue;
        const parsed = JSON.parse(line) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${sourcePath}:${index + 1} must be a JSON object`);
        rows.push({ ...(parsed as JsonObject), __rowNumber: index + 1 });
    }
    return rows;
}

function outputFieldNames(): readonly string[] {
    return Object.keys(FIELD_ALIASES);
}

function finitePositive(value: unknown): boolean {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteInteger(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

function validSha(value: unknown): boolean {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function buildRow(row: SourceRow, sourcePath: string, sourceSha256: string): RebuiltCandidateRow {
    const fields: Record<string, FieldProvenance> = {};
    for (const field of outputFieldNames()) fields[field] = fieldFromSource(row, field);

    // These are not safely derivable from the legacy ledger. Do not derive an
    // immediate validity window, priority, asset class, or quantity from gross.
    if (fields.entryValidUntilMs?.status === "MISSING") fields.entryValidUntilMs = unverifiable("entryValidUntilMs", "the legacy ledger does not preserve the allocator contract");
    if (fields.priority?.status === "MISSING") fields.priority = unverifiable("priority", "the legacy ledger does not preserve the allocator contract");
    if (fields.assetClass?.status === "MISSING") fields.assetClass = unverifiable("assetClass", "the legacy ledger does not preserve the allocator contract");
    if (fields.quantity?.status === "MISSING") fields.quantity = unverifiable("quantity", "gross/price division would discard lot, min-notional, and dynamic-equity rules");
    if (fields.validity?.status === "MISSING") fields.validity = unverifiable("validity", "entry validity semantics are not preserved");

    const blockers: string[] = [];
    for (const field of REQUIRED_REPLAY_FIELDS) {
        const evidence = fields[field];
        if (evidence?.status !== "ORIGINAL_EVIDENCE") blockers.push(`${field}:${evidence?.status ?? "MISSING"}`);
    }
    const candidateId = asString(fields.candidateId?.value);
    const strategyId = strategy(fields.strategyId?.value);
    const side = typeof fields.side?.value === "string" ? fields.side.value.toUpperCase() : null;
    const validity = fields.validity?.value;
    const evidenceLevel = fields.evidenceLevel?.value;
    if (candidateId === null) blockers.push("candidateId:INVALID");
    if (strategyId === null) blockers.push("strategyId:INVALID");
    if (side !== "LONG" && side !== "SHORT") blockers.push("side:INVALID");
    if (!asString(fields.symbol?.value)) blockers.push("symbol:INVALID");
    if (!finiteInteger(fields.decisionTsMs?.value)) blockers.push("decisionTsMs:INVALID");
    if (!finitePositive(fields.entryPrice?.value)) blockers.push("entryPrice:INVALID");
    if (!finitePositive(fields.requestedGross?.value)) blockers.push("requestedGross:INVALID");
    if (!finitePositive(fields.quantity?.value)) blockers.push("quantity:INVALID");
    if (!finiteInteger(fields.entryValidUntilMs?.value)) blockers.push("entryValidUntilMs:INVALID");
    if (typeof fields.priority?.value !== "number" || !Number.isFinite(fields.priority.value)) blockers.push("priority:INVALID");
    if (fields.assetClass?.value !== "CRYPTO" && fields.assetClass?.value !== "NON_CRYPTO") blockers.push("assetClass:INVALID");
    if (validity !== "VALID") blockers.push("validity:INVALID");
    if (evidenceLevel !== "ORIGINAL_EVIDENCE" && evidenceLevel !== "CAUSALLY_REGENERATED") blockers.push("evidenceLevel:INVALID");
    if (!ALLOWED_SOURCE_KINDS.has(String(fields.evidenceSourceKind?.value))) blockers.push("evidenceSourceKind:INVALID");
    if (!asString(fields.evidenceSourcePath?.value)) blockers.push("evidenceSourcePath:INVALID");
    if (!validSha(fields.evidenceSourceSha256?.value) || fields.evidenceSourceSha256.value !== fields.sourceSha?.value) blockers.push("provenance:SOURCE_SHA_MISMATCH");
    if (fields.sourceSha?.value !== sourceSha256) blockers.push("provenance:SOURCE_SHA_NOT_INPUT");
    if (!finiteInteger(fields.evidenceRowNumber?.value) || (fields.evidenceRowNumber?.value as number) <= 0) blockers.push("evidenceRowNumber:INVALID");
    if (!finiteInteger(fields.evidenceSourceBytes?.value) || (fields.evidenceSourceBytes?.value as number) < 0) blockers.push("evidenceSourceBytes:INVALID");
    if (!validSha(fields.sourceSha?.value)) blockers.push("sourceSha:INVALID");
    return {
        sourcePath,
        sourceSha256,
        rowNumber: row.__rowNumber,
        candidateId,
        strategyId,
        decision: asString(fields.decision?.value),
        fields,
        replayReady: blockers.length === 0,
        replayBlockers: [...new Set(blockers)],
    };
}

function increment(map: Record<string, number>, key: string): void {
    map[key] = (map[key] ?? 0) + 1;
}

function emptyStrategyCounts(): Record<DynamicStrategyId, number> {
    return Object.fromEntries(DYNAMIC_STRATEGY_IDS.map((id) => [id, 0])) as Record<DynamicStrategyId, number>;
}

function emptyEvidenceCounts(): Record<ProvenanceStatus, number> {
    return { ORIGINAL_EVIDENCE: 0, CAUSALLY_REGENERATED: 0, MISSING: 0, UNVERIFIABLE: 0 };
}

function stableCanonicalize(value: unknown, omitKeys: ReadonlySet<string> = new Set()): unknown {
    if (Array.isArray(value)) return value.map((item) => stableCanonicalize(item, omitKeys));
    if (value !== null && typeof value === "object") {
        const object = value as Record<string, unknown>;
        return Object.fromEntries(Object.keys(object).filter((key) => !omitKeys.has(key)).sort().map((key) => [key, stableCanonicalize(object[key], omitKeys)]));
    }
    return value;
}

function canonicalJson(value: unknown, omitKeys: ReadonlySet<string> = new Set()): string {
    return JSON.stringify(stableCanonicalize(value, omitKeys));
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
}

function validateSource(rows: readonly SourceRow[], rebuilt: readonly RebuiltCandidateRow[], decisionCounts: Readonly<Record<string, number>>): SourceValidation {
    const ids = rebuilt.map((row) => row.candidateId).filter((value): value is string => value !== null);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of ids) {
        if (seen.has(id)) duplicates.push(id);
        seen.add(id);
    }
    const unknownDecisions = unique(rows.map((row) => asString(firstPresent(row, FIELD_ALIASES.decision)?.value) ?? "MISSING").filter((value) => !ALLOWED_DECISIONS.has(value)));
    const rawCandidateIds = rows.map((row) => asString(firstPresent(row, FIELD_ALIASES.candidateId)?.value) ?? "MISSING");
    const rawStrategies = rows.map((row) => asString(firstPresent(row, FIELD_ALIASES.strategyId)?.value) ?? "MISSING");
    const unknownStrategies = unique(rawStrategies.filter((value) => value !== "MISSING" && !STRATEGIES.has(value)));
    const presentStrategies = new Set(rawStrategies.filter((value) => STRATEGIES.has(value)));
    const missingStrategies = DYNAMIC_STRATEGY_IDS.filter((id) => !presentStrategies.has(id));
    const blockers = [
        ...unique(duplicates.map((id) => `DUPLICATE_CANDIDATE_ID:${id}`)),
        ...(rawCandidateIds.includes("MISSING") ? ["MISSING_CANDIDATE_ID"] : []),
        ...unknownDecisions.map((value) => `UNKNOWN_DECISION:${value}`),
        ...unknownStrategies.map((value) => `UNKNOWN_STRATEGY:${value}`),
        ...(rawStrategies.includes("MISSING") ? ["MISSING_STRATEGY_ID"] : []),
        ...missingStrategies.map((id) => `MISSING_STRATEGY_COVERAGE:${id}`),
        ...(Object.values(decisionCounts).reduce((sum, count) => sum + count, 0) !== rows.length ? ["DECISION_COUNT_MISMATCH"] : []),
    ];
    return { valid: blockers.length === 0, blockers, duplicateCandidateIds: unique(duplicates), unknownDecisions, unknownStrategies, missingStrategies };
}

function sha256Json(value: unknown): string {
    return hash(Buffer.from(canonicalJson(value), "utf8"));
}

export async function rebuildNoncanonicalBaseline(inputPath: string, outputDir: string, costBps: number): Promise<SourceRecoveryReport> {
    if (!Number.isInteger(costBps) || costBps < 0) throw new Error("costBps must be a non-negative integer");
    const sourcePath = resolve(inputPath);
    const output = resolve(outputDir);
    const bytes = await readFile(sourcePath);
    const sourceSha256 = hash(bytes);
    const rows = readJsonl(bytes.toString("utf8"), sourcePath);
    const initialRows = rows.map((row) => buildRow(row, sourcePath, sourceSha256));
    const decisionCounts: Record<string, number> = {};
    const strategyCounts = emptyStrategyCounts();
    const unknownStrategyCounts: Record<string, number> = {};
    const blockerCounts: Record<string, number> = {};
    const fieldCoverage: Record<string, Record<ProvenanceStatus, number>> = Object.fromEntries(outputFieldNames().map((field) => [field, emptyEvidenceCounts()]));
    for (const row of initialRows) {
        increment(decisionCounts, row.decision ?? "MISSING");
        if (row.strategyId !== null) strategyCounts[row.strategyId] += 1;
        else increment(unknownStrategyCounts, String(row.fields.strategyId?.value ?? "MISSING"));
        for (const [field, evidence] of Object.entries(row.fields)) increment(fieldCoverage[field] as unknown as Record<string, number>, evidence.status);
    }
    const sourceValidation = validateSource(rows, initialRows, decisionCounts);
    const rebuilt = initialRows.map((row) => {
        const replayBlockers = sourceValidation.valid ? row.replayBlockers : [...row.replayBlockers, "SOURCE_COVERAGE_INVALID"];
        return { ...row, replayReady: sourceValidation.valid && replayBlockers.length === 0, replayBlockers: [...new Set(replayBlockers)] };
    });
    for (const row of rebuilt) for (const blocker of row.replayBlockers) increment(blockerCounts, blocker);
    const assumptions = [
        "Only values physically present in candidate-decisions.jsonl are classified as ORIGINAL_EVIDENCE.",
        "No validity window, priority/tie-break, quantity, asset class, or entry equity is inferred from gross, rank, timestamps, or outcome fields.",
        "sourcePath is display/provenance metadata only and is excluded from canonical report and ledger hashes.",
        "A row is replayReady only when it satisfies the Dynamic Allocator validity, provenance, identity, domain, and coverage contracts.",
    ];
    const limitations = [
        "This adapter does not run an economic replay and cannot establish formal baseline parity.",
        "Rejected rows do not preserve the equity/quantity/lot-sizing inputs required for dynamic re-admission.",
        "Missing priority/tie-break and entry expiry prevent deterministic shared-allocator replay.",
        "The ledger is a modeled H1 price-model source, not independent venue execution evidence or full MTM marks.",
    ];
    const displayLedger = rebuilt.map((row) => JSON.stringify(row)).join("\n") + "\n";
    const canonicalLedger = rebuilt.map((row) => canonicalJson(row, new Set(["sourcePath"]))).join("\n") + "\n";
    const displayOutputSha256 = hash(Buffer.from(displayLedger, "utf8"));
    const canonicalOutputSha256 = hash(Buffer.from(canonicalLedger, "utf8"));
    const reportBase = {
        schemaVersion: 2 as const,
        classification: "REBUILT_BASELINE_NONCANONICAL" as const,
        formalParity: false as const,
        economicBacktest: false as const,
        sourcePath,
        sourceSha256,
        sourceBytes: bytes.byteLength,
        costBps,
        observedRows: rebuilt.length,
        replayReadyRows: rebuilt.filter((row) => row.replayReady).length,
        failClosedRows: rebuilt.filter((row) => !row.replayReady).length,
        decisionCounts,
        strategyCounts,
        unknownStrategyCounts,
        fieldCoverage,
        blockerCounts,
        sourceValidation,
        assumptions,
        limitations,
        canonicalOutputSha256,
        displayOutputSha256,
    };
    const { sourcePath: _displaySourcePath, displayOutputSha256: _displayOutputSha256, ...canonicalReportPayload } = reportBase;
    const reportPayloadHash = sha256Json(canonicalReportPayload);
    const manifestDocument = { ...reportBase, reportPayloadHash, canonicalOutputSha256, displayOutputSha256 };
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "reconstructed-candidate-ledger.jsonl"), displayLedger, "utf8");
    const manifestBytes = Buffer.from(`${JSON.stringify(manifestDocument, null, 2)}\n`, "utf8");
    const manifestFileSha256 = hash(manifestBytes);
    const report: SourceRecoveryReport = { ...reportBase, reportPayloadHash, manifestFileSha256 };
    await writeFile(resolve(output, "source-recovery-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(resolve(output, "source-recovery-manifest.json"), manifestBytes, "utf8");
    await writeFile(resolve(output, "source-recovery-integrity.json"), `${JSON.stringify({ reportPayloadHash, canonicalOutputSha256, displayOutputSha256, manifestFileSha256 }, null, 2)}\n`, "utf8");
    return report;
}

function flag(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
}

export async function rebuildNoncanonicalBaselineCli(args: readonly string[] = process.argv.slice(2)): Promise<void> {
    const report = await rebuildNoncanonicalBaseline(flag(args, "--source"), flag(args, "--output-dir"), Number(flag(args, "--cost-bps")));
    process.stdout.write(`${JSON.stringify({ sourcePath: report.sourcePath, costBps: report.costBps, observedRows: report.observedRows, replayReadyRows: report.replayReadyRows, failClosedRows: report.failClosedRows, classification: report.classification, formalParity: report.formalParity, reportPayloadHash: report.reportPayloadHash, manifestFileSha256: report.manifestFileSha256 }, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    rebuildNoncanonicalBaselineCli().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
