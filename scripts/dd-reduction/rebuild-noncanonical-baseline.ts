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

export interface SourceRecoveryReport {
    readonly schemaVersion: 1;
    readonly classification: "REBUILT_BASELINE_NONCANONICAL";
    readonly formalParity: false;
    readonly economicBacktest: false;
    readonly sourcePath: string;
    readonly sourceSha256: string;
    readonly sourceBytes: number;
    readonly costBps: number;
    readonly observedRows: number;
    readonly replayReadyRows: number;
    readonly failClosedRows: number;
    readonly decisionCounts: Readonly<Record<string, number>>;
    readonly strategyCounts: Readonly<Record<DynamicStrategyId, number>>;
    readonly fieldCoverage: Readonly<Record<string, Readonly<Record<ProvenanceStatus, number>>>>;
    readonly blockerCounts: Readonly<Record<string, number>>;
    readonly assumptions: readonly string[];
    readonly limitations: readonly string[];
    readonly manifestHash: string;
}

interface SourceRow extends JsonObject {
    readonly __rowNumber: number;
}

const STRATEGIES = new Set<string>(DYNAMIC_STRATEGY_IDS);

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
    positionId: ["position_id", "positionId"],
    referenceFx: ["reference_fx_jpy_per_usd", "referenceFxJpyPerUsd"],
};

const REQUIRED_REPLAY_FIELDS = [
    "candidateId",
    "strategyId",
    "symbol",
    "side",
    "decisionTsMs",
    "entryPrice",
    "requestedGross",
    "quantity",
    "entryValidUntilMs",
    "priority",
    "assetClass",
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
    return {
        status: "MISSING",
        sourceField: null,
        value: null,
        reason: `source row does not contain a value for ${field}`,
    };
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

function buildRow(row: SourceRow, sourcePath: string, sourceSha256: string): RebuiltCandidateRow {
    const fields: Record<string, FieldProvenance> = {};
    for (const field of outputFieldNames()) fields[field] = fieldFromSource(row, field);

    // These are not safely derivable from the legacy ledger. Do not derive an
    // immediate validity window, priority, asset class, or quantity from gross.
    // Quantity needs the original lot/step/min-notional/equity policy.
    for (const field of ["entryValidUntilMs", "priority", "assetClass"] as const) {
        if (fields[field]?.status === "MISSING") fields[field] = unverifiable(field, "the legacy ledger does not preserve the allocator contract");
    }
    if (fields.quantity?.status === "MISSING") fields.quantity = unverifiable("quantity", "gross/price division would discard lot, min-notional, and dynamic-equity rules");
    if (fields.validity?.status === "MISSING") fields.validity = unverifiable("validity", "entry validity semantics are not preserved");

    const blockers = REQUIRED_REPLAY_FIELDS.filter((field) => fields[field]?.status !== "ORIGINAL_EVIDENCE").map((field) => {
        const evidence = fields[field];
        return `${field}:${evidence?.status ?? "MISSING"}`;
    });
    const candidateId = asString(fields.candidateId?.value);
    const strategyId = strategy(fields.strategyId?.value);
    return {
        sourcePath,
        sourceSha256,
        rowNumber: row.__rowNumber,
        candidateId,
        strategyId,
        decision: asString(fields.decision?.value),
        fields,
        replayReady: blockers.length === 0 && candidateId !== null && strategyId !== null,
        replayBlockers: blockers.length === 0 && (candidateId === null || strategyId === null)
            ? ["candidateId/strategyId:INVALID"]
            : blockers,
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

function sha256Json(value: unknown): string {
    return hash(Buffer.from(JSON.stringify(value), "utf8"));
}

export async function rebuildNoncanonicalBaseline(inputPath: string, outputDir: string, costBps: number): Promise<SourceRecoveryReport> {
    if (!Number.isInteger(costBps) || costBps < 0) throw new Error("costBps must be a non-negative integer");
    const sourcePath = resolve(inputPath);
    const output = resolve(outputDir);
    const bytes = await readFile(sourcePath);
    const sourceSha256 = hash(bytes);
    const rows = readJsonl(bytes.toString("utf8"), sourcePath);
    const rebuilt = rows.map((row) => buildRow(row, sourcePath, sourceSha256));
    const decisionCounts: Record<string, number> = {};
    const strategyCounts = emptyStrategyCounts();
    const blockerCounts: Record<string, number> = {};
    const fieldCoverage: Record<string, Record<ProvenanceStatus, number>> = Object.fromEntries(outputFieldNames().map((field) => [field, emptyEvidenceCounts()]));
    for (const row of rebuilt) {
        increment(decisionCounts, row.decision ?? "MISSING");
        if (row.strategyId !== null) strategyCounts[row.strategyId] += 1;
        for (const [field, evidence] of Object.entries(row.fields)) increment(fieldCoverage[field] as unknown as Record<string, number>, evidence.status);
        for (const blocker of row.replayBlockers) increment(blockerCounts, blocker);
    }
    const assumptions = [
        "Only values physically present in candidate-decisions.jsonl are classified as ORIGINAL_EVIDENCE.",
        "No validity window, priority/tie-break, quantity, asset class, or entry equity is inferred from gross, rank, timestamps, or outcome fields.",
        "The source file hash and row number are provenance metadata for this reconstruction and are not market or allocator evidence.",
    ];
    const limitations = [
        "This adapter does not run an economic replay and cannot establish formal baseline parity.",
        "Rejected rows do not preserve the equity/quantity/lot-sizing inputs required for dynamic re-admission.",
        "Missing priority/tie-break and entry expiry prevent deterministic shared-allocator replay.",
        "The ledger is a modeled H1 price-model source, not independent venue execution evidence or full MTM marks.",
    ];
    const reportWithoutHash = {
        schemaVersion: 1 as const,
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
        fieldCoverage,
        blockerCounts,
        assumptions,
        limitations,
    };
    const report: SourceRecoveryReport = { ...reportWithoutHash, manifestHash: sha256Json(reportWithoutHash) };
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "reconstructed-candidate-ledger.jsonl"), rebuilt.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
    await writeFile(resolve(output, "source-recovery-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(resolve(output, "source-recovery-manifest.json"), `${JSON.stringify({ ...report, outputSha256: hash(Buffer.from(rebuilt.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8")) }, null, 2)}\n`, "utf8");
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
    process.stdout.write(`${JSON.stringify({ sourcePath: report.sourcePath, costBps: report.costBps, observedRows: report.observedRows, replayReadyRows: report.replayReadyRows, failClosedRows: report.failClosedRows, classification: report.classification, formalParity: report.formalParity }, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    rebuildNoncanonicalBaselineCli().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
