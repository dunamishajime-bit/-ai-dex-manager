import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDynamicCandidates } from "../../lib/backtest/dd-reduction/dynamic-source";
import { hashAllocatorState } from "../../lib/backtest/dd-reduction/dynamic-state";
import {
    replayDynamicPortfolio,
    type DynamicReplayPolicy,
    type ReplayEvent,
    type ReplayLedgerEntry,
} from "../../lib/backtest/dd-reduction/dynamic-replay";
import type {
    CandidateSourceKind,
    CandidateSourceRecord,
    DynamicCandidateEvent,
    DynamicCandidateSourceResult,
    DynamicStrategyId,
    EvidenceLevel,
} from "../../lib/backtest/dd-reduction/dynamic-types";
import type { DynamicAllocatorCandidate, DynamicAllocatorPolicy } from "../../lib/backtest/dd-reduction/dynamic-allocator";
import {
    compareDynamicBaseline,
    DEFAULT_BASELINE_ANCHORS,
    type BaselineAnchor,
    type DynamicBaselineComparison,
} from "./compare-dynamic-baseline";

export type BaselineCaseName = "baseline";
export type BaselineCostBps = 10 | 30;
export type BaselineParityClassification =
    | "FORMAL_PARITY"
    | "REBUILT_BASELINE"
    | "BLOCKED_SOURCE_MISSING"
    | "BLOCKED_SOURCE_CLASSIFICATION"
    | "BLOCKED_INCOMPLETE_SOURCE_COVERAGE"
    | "BLOCKED_REPLAY";

export interface DynamicSourceSpec {
    readonly path: string;
    readonly kind: CandidateSourceKind;
    readonly evidence?: EvidenceLevel;
}

export interface DynamicRunnerArgs {
    readonly caseName: BaselineCaseName;
    readonly costBps: BaselineCostBps;
    readonly outputDir: string;
    readonly sourceSpecs: readonly DynamicSourceSpec[];
    readonly verifyDeterminism: boolean;
}

export interface DynamicRunnerOptions {
    readonly caseName: BaselineCaseName;
    readonly costBps: BaselineCostBps;
    readonly outputDir: string;
    readonly sourceRecords?: readonly CandidateSourceRecord[];
    readonly sourceSpecs?: readonly DynamicSourceSpec[];
    readonly verifyDeterminism?: boolean;
    readonly adverseStopRules?: readonly unknown[];
}

export interface DynamicBaselineLedgerEntry {
    readonly event_id: string;
    readonly timestamp_ms: number;
    readonly kind: string;
    readonly candidate_id: string | null;
    readonly strategy_id: DynamicStrategyId | null;
    readonly symbol: string | null;
    readonly side: "LONG" | "SHORT" | null;
    readonly allocator_state_before: unknown;
    readonly allocator_state_after: unknown;
    readonly wallet_before_jpy: number;
    readonly wallet_after_jpy: number;
    readonly gross: number | null;
    readonly accepted: boolean;
    readonly rejection_reason: string | null;
    readonly preemption_reason: string | null;
}

export interface DynamicBaselineResultSummary {
    readonly status: "PASS" | "FAIL";
    readonly replay_rejection: string | null;
    readonly final_equity_jpy: number;
    readonly wallet_jpy: number;
    readonly jpy_profit_factor: number | null;
    readonly trades: number;
    readonly mtm_drawdown_pct: number;
    readonly rejection_count: number;
    readonly preemption_count: number;
    readonly replay_event_count: number;
    readonly accounting: unknown;
    readonly execution_ledger: readonly DynamicBaselineLedgerEntry[];
    readonly maximum_mtm_dd: unknown;
    readonly top5_dd_windows: readonly unknown[];
    readonly comparison?: DynamicBaselineComparison;
}

export interface DynamicBaselineManifest {
    readonly manifestVersion: 1;
    readonly caseName: BaselineCaseName;
    readonly costBps: BaselineCostBps;
    readonly period: { readonly start: "2025-08-10"; readonly end: "2026-08-10"; readonly timezone: "UTC" };
    readonly initialWalletJpy: 10_000;
    readonly depositsJpy: 0;
    readonly compounding: true;
    readonly priceModel: "H1";
    readonly overlayPolicy: "NONE";
    readonly adverseStopRulesApplied: false;
    readonly sourceCoverage: DynamicSourceCoverageSummary;
    readonly policy: {
        readonly feeBps: BaselineCostBps;
        readonly slippageBps: BaselineCostBps;
        readonly allocator: DynamicAllocatorPolicy;
    };
    readonly parityClassification: BaselineParityClassification;
    readonly limitations: readonly string[];
    readonly hashes: {
        readonly result: string;
        readonly allocator: string;
        readonly ledgers: Readonly<Record<string, string>>;
    };
}

export interface DynamicSourceCoverageSummary {
    readonly observedRows: number;
    readonly normalizedRows: number;
    readonly failClosedRows: number;
    readonly replayableRows: number;
    readonly nonReplayableRows: number;
    readonly expectedCandidateRows: 3_185;
    readonly strategyCounts: Readonly<Record<DynamicStrategyId, number>>;
    readonly missingStrategies: readonly DynamicStrategyId[];
    readonly status: "COMPLETE" | "INCOMPLETE";
    readonly reasons: readonly string[];
    readonly sourceHashes: DynamicCandidateSourceResult["sourceHashes"];
    readonly coverageMatrix: DynamicCandidateSourceResult["coverageMatrix"];
    readonly sourceReferences: readonly {
        readonly path: string;
        readonly kind: CandidateSourceKind;
        readonly evidence: EvidenceLevel;
        readonly sha256: string;
        readonly bytes: number;
    }[];
}

export interface DynamicBaselineHashes {
    readonly result: string;
    readonly allocator: string;
    readonly ledgers: Readonly<Record<string, string>>;
}

export interface DynamicBaselineRun {
    readonly manifest: DynamicBaselineManifest;
    readonly result: DynamicBaselineResultSummary;
    readonly comparison: DynamicBaselineComparison;
    readonly hashes: DynamicBaselineHashes;
    readonly writtenFiles: readonly string[];
}

export class DynamicBaselineInputError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(`${code}: ${message}`);
        this.name = "DynamicBaselineInputError";
        this.code = code;
    }
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PERIOD = { start: "2025-08-10", end: "2026-08-10", timezone: "UTC" } as const;
const DYNAMIC_SOURCE_EXTENSIONS = new Set([".jsonl", ".ndjson", ".json"]);

function fail(code: string, message: string): never {
    throw new DynamicBaselineInputError(code, message);
}

function isInside(root: string, candidate: string): boolean {
    const path = relative(root, candidate);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]));
    }
    return value;
}

export function hashCanonical(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function hashBytes(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}

function objectRows(value: unknown, path: string): readonly Readonly<Record<string, unknown>>[] {
    if (Array.isArray(value)) return value.map((row, index) => {
        if (row === null || typeof row !== "object" || Array.isArray(row)) fail("SOURCE_SCHEMA", `${path}:${index + 1} must be an object`);
        return row as Readonly<Record<string, unknown>>;
    });
    if (value === null || typeof value !== "object") fail("SOURCE_SCHEMA", `${path} must contain an object or array`);
    const object = value as Record<string, unknown>;
    for (const key of ["rows", "candidates", "candidateDecisions", "events"]) {
        if (Array.isArray(object[key])) return objectRows(object[key], `${path}.${key}`);
    }
    return [object];
}

async function loadSourceRecord(spec: DynamicSourceSpec): Promise<CandidateSourceRecord> {
    const path = resolve(spec.path);
    const extension = extname(path).toLowerCase();
    if (!DYNAMIC_SOURCE_EXTENSIONS.has(extension)) fail("SOURCE_SCHEMA", `${path} must be JSONL, NDJSON, or JSON`);
    let bytes: Uint8Array;
    try {
        bytes = await readFile(path);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        fail("SOURCE_MISSING", `${path}: ${detail}`);
    }
    const content = Buffer.from(bytes).toString("utf8");
    let rows: readonly Readonly<Record<string, unknown>>[];
    try {
        if (extension === ".jsonl" || extension === ".ndjson") {
            rows = content.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line, index) => {
                const value = JSON.parse(line) as unknown;
                if (value === null || typeof value !== "object" || Array.isArray(value)) fail("SOURCE_SCHEMA", `${path}:${index + 1} must be an object`);
                return value as Readonly<Record<string, unknown>>;
            });
        } else rows = objectRows(JSON.parse(content) as unknown, path);
    } catch (error) {
        if (error instanceof DynamicBaselineInputError) throw error;
        fail("SOURCE_SCHEMA", `${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { kind: spec.kind, path, sourceSha256: hashBytes(bytes), sourceBytes: bytes.byteLength, evidence: spec.evidence ?? "ORIGINAL_EVIDENCE", rows };
}

async function resolveSourceRecords(options: DynamicRunnerOptions): Promise<readonly CandidateSourceRecord[]> {
    if (options.sourceRecords !== undefined) {
        if (options.sourceRecords.length === 0) fail("SOURCE_MISSING", "at least one candidate source is required");
        return options.sourceRecords;
    }
    if (options.sourceSpecs === undefined || options.sourceSpecs.length === 0) fail("SOURCE_MISSING", "at least one candidate source is required");
    return Promise.all(options.sourceSpecs.map(loadSourceRecord));
}

function valueFlag(args: readonly string[], name: string): string | undefined {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) fail("CLI_ARGUMENT", `${name} requires a value`);
    return value;
}

function repeatedValues(args: readonly string[], name: string): readonly string[] {
    const result: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] !== name) continue;
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) fail("CLI_ARGUMENT", `${name} requires a value`);
        result.push(value);
        index += 1;
    }
    return result;
}

function parseCost(value: string | undefined): BaselineCostBps {
    if (value !== "10" && value !== "30") fail("CLI_ARGUMENT", "--cost-bps must be 10 or 30");
    return Number(value) as BaselineCostBps;
}

function parseKind(value: string): CandidateSourceKind {
    if (value === "RAW_CANDIDATE_DECISIONS" || value === "SAVED_MARKET_DATA" || value === "STRATEGY_ADAPTER") return value;
    fail("AMBIGUOUS_SOURCE_CLASSIFICATION", `${value} is not a supported candidate source kind`);
}

function parseEvidence(value: string | undefined): EvidenceLevel | undefined {
    if (value === undefined) return undefined;
    if (value === "ORIGINAL_EVIDENCE" || value === "CAUSALLY_REGENERATED" || value === "MISSING" || value === "UNVERIFIABLE") return value;
    fail("CLI_ARGUMENT", `${value} is not an allowed evidence level`);
}

export function parseDynamicRunnerArgs(args: readonly string[]): DynamicRunnerArgs {
    const caseName = valueFlag(args, "--case");
    if (caseName !== "baseline") fail("CLI_ARGUMENT", "--case baseline is required");
    const output = valueFlag(args, "--output");
    if (output === undefined) fail("CLI_ARGUMENT", "--output is required");
    const sourcePaths = repeatedValues(args, "--source");
    const sourceKinds = repeatedValues(args, "--source-kind");
    if (sourcePaths.length === 0) fail("SOURCE_MISSING", "at least one --source is required");
    if (sourcePaths.length !== sourceKinds.length) fail("AMBIGUOUS_SOURCE_CLASSIFICATION", "each --source must have exactly one adjacent --source-kind");
    const evidenceValues = repeatedValues(args, "--source-evidence");
    if (evidenceValues.length > 0 && evidenceValues.length !== sourcePaths.length) fail("AMBIGUOUS_SOURCE_CLASSIFICATION", "each --source must have exactly one --source-evidence or omit it for all sources");
    return {
        caseName: "baseline",
        costBps: parseCost(valueFlag(args, "--cost-bps")),
        outputDir: resolve(output),
        sourceSpecs: sourcePaths.map((path, index) => ({ path, kind: parseKind(sourceKinds[index] as string), evidence: parseEvidence(evidenceValues[index]) })),
        verifyDeterminism: args.includes("--verify-determinism"),
    };
}

function allocatorPolicy(initialWalletJpy: number): DynamicAllocatorPolicy {
    return {
        total_gross_cap: initialWalletJpy,
        crypto_gross_cap: initialWalletJpy,
        strategy_gross_caps: {},
        symbol_gross_caps: {},
        pending_gross_cap: initialWalletJpy,
        reserved_gross_cap: initialWalletJpy,
        reservation_ttl_ms: 24 * 60 * 60 * 1000,
        min_qty: 0,
        min_notional: 0,
        require_protection: false,
    };
}

function allocatorCandidate(event: DynamicCandidateEvent): DynamicAllocatorCandidate | null {
    if (event.failClosed || event.side === null || event.price === null || event.entry_valid_until_ms === null || event.requested_gross === null || event.priority === null) return null;
    return {
        candidate_id: event.candidate_id,
        strategy_id: event.strategy_id,
        symbol: event.symbol,
        side: event.side,
        signal_ts_ms: event.signal_ts_ms,
        decision_ts_ms: event.decision_ts_ms,
        entry_valid_until_ms: event.entry_valid_until_ms,
        requested_gross: event.requested_gross,
        worst_case_gross: event.worst_case_gross,
        entry_price: event.price,
        priority: event.priority,
        evidence_level: event.evidence_level,
        source_sha: event.source_sha,
        evidence: event.evidence,
        validity: event.validity,
        asset_class: "CRYPTO",
        protection_verified: false,
    };
}

function replayEvents(events: readonly DynamicCandidateEvent[]): { readonly events: readonly ReplayEvent[]; readonly contexts: ReadonlyMap<string, DynamicCandidateEvent> } {
    const contexts = new Map<string, DynamicCandidateEvent>();
    const replay: ReplayEvent[] = [];
    for (const event of events) {
        const candidate = allocatorCandidate(event);
        if (candidate === null || event.decision_ts_ms === null || event.event_seq === null) continue;
        const replayEvent: ReplayEvent = {
            event_id: event.event_id ?? `candidate:${event.candidate_id}`,
            event_seq: event.event_seq,
            timestamp_ms: event.decision_ts_ms,
            timestamp: event.decision_ts_ms,
            kind: "ENTRY",
            candidate,
        };
        replay.push(replayEvent);
        contexts.set(replayEvent.event_id, event);
    }
    return { events: replay, contexts };
}

function coverageSummary(source: DynamicCandidateSourceResult, replayableRows: number, nonReplayableRows: number, records: readonly CandidateSourceRecord[]): DynamicSourceCoverageSummary {
    const missingStrategies = (Object.entries(source.strategyCounts) as [DynamicStrategyId, number][]).filter(([, count]) => count === 0).map(([strategy]) => strategy);
    const reasons: string[] = [];
    if (source.observedRowCount !== 3_185) reasons.push(`observed candidate rows ${source.observedRowCount} do not equal the expected 3185-row source`);
    if (source.failClosedRowCount > 0) reasons.push(`${source.failClosedRowCount} candidate rows are fail-closed by source normalization`);
    if (nonReplayableRows > 0) reasons.push(`${nonReplayableRows} normalized candidate rows lack the allocator fields needed for causal replay`);
    if (missingStrategies.length > 0) reasons.push(`missing strategy coverage: ${missingStrategies.join(", ")}`);
    return {
        observedRows: source.observedRowCount,
        normalizedRows: source.events.length - source.failClosedRowCount,
        failClosedRows: source.failClosedRowCount,
        replayableRows,
        nonReplayableRows,
        expectedCandidateRows: 3_185,
        strategyCounts: source.strategyCounts,
        missingStrategies,
        status: reasons.length === 0 ? "COMPLETE" : "INCOMPLETE",
        reasons,
        sourceHashes: source.sourceHashes,
        coverageMatrix: source.coverageMatrix,
        sourceReferences: records.map((record) => ({ path: record.path, kind: record.kind, evidence: record.evidence, sha256: record.sourceSha256, bytes: record.sourceBytes })),
    };
}

function compactLedgerEntry(entry: ReplayLedgerEntry, contexts: ReadonlyMap<string, DynamicCandidateEvent>): DynamicBaselineLedgerEntry {
    const context = contexts.get(entry.event_id);
    return {
        event_id: entry.event_id,
        timestamp_ms: entry.timestamp_ms,
        kind: entry.kind,
        candidate_id: context?.candidate_id ?? null,
        strategy_id: context?.strategy_id ?? null,
        symbol: context?.symbol ?? null,
        side: context?.side ?? null,
        allocator_state_before: entry.allocator_before,
        allocator_state_after: entry.allocator_after,
        wallet_before_jpy: entry.wallet_before_jpy,
        wallet_after_jpy: entry.wallet_after_jpy,
        gross: context?.requested_gross ?? null,
        accepted: entry.accepted,
        rejection_reason: entry.reason,
        preemption_reason: entry.kind === "PREEMPTION_EXIT" ? entry.reason : null,
    };
}

function profitFactor(charges: readonly { readonly pnl_jpy: number }[]): number | null {
    const gains = charges.filter((charge) => charge.pnl_jpy > 0).reduce((sum, charge) => sum + charge.pnl_jpy, 0);
    const losses = charges.filter((charge) => charge.pnl_jpy < 0).reduce((sum, charge) => sum + Math.abs(charge.pnl_jpy), 0);
    return losses > 0 ? gains / losses : null;
}

function preliminaryClassification(coverage: DynamicSourceCoverageSummary, replay: ReturnType<typeof replayDynamicPortfolio>): BaselineParityClassification {
    if (coverage.status !== "COMPLETE") return coverage.replayableRows === 0 ? "BLOCKED_INCOMPLETE_SOURCE_COVERAGE" : "REBUILT_BASELINE";
    if (replay.status !== "PASS") return "BLOCKED_REPLAY";
    return "REBUILT_BASELINE";
}

function writeJsonLines(path: string, values: readonly unknown[]): Promise<void> {
    return writeFile(path, values.map((value) => JSON.stringify(value)).join("\n") + (values.length === 0 ? "" : "\n"), "utf8");
}

async function runOnce(options: DynamicRunnerOptions, records: readonly CandidateSourceRecord[], writeArtifacts: boolean): Promise<DynamicBaselineRun> {
    if (options.adverseStopRules !== undefined && options.adverseStopRules.length > 0) fail("BASELINE_OVERLAY_FORBIDDEN", "baseline case is overlay-free and cannot accept Task 9 adverse-stop rules");
    const outputDir = resolve(options.outputDir);
    if (isInside(REPOSITORY_ROOT, outputDir)) fail("OUTPUT_IN_REPOSITORY", `raw baseline output must be outside ${REPOSITORY_ROOT}`);
    if (options.caseName !== "baseline") fail("CLI_ARGUMENT", "only the baseline case is implemented by Task 6");
    if (options.costBps !== 10 && options.costBps !== 30) fail("CLI_ARGUMENT", "costBps must be 10 or 30");

    const normalized = normalizeDynamicCandidates({ records, feeBps: options.costBps, slippageBps: options.costBps });
    const replayInput = replayEvents(normalized.events);
    const coverage = coverageSummary(normalized, replayInput.events.length, normalized.events.filter((event) => !event.failClosed && allocatorCandidate(event) === null).length, records);
    const initialWalletJpy = 10_000;
    const policy: DynamicReplayPolicy = {
        allocator: allocatorPolicy(initialWalletJpy),
        initial_wallet_jpy: initialWalletJpy,
        settlement_currency: "USD",
        require_canonical_same_bar_order: true,
        h1_interval_ms: 60 * 60 * 1000,
    };
    const replay = replayDynamicPortfolio(replayInput.events, policy);
    const executionLedger = replay.execution_ledger.map((entry) => compactLedgerEntry(entry, replayInput.contexts));
    const finalEquity = replay.mtm_timeline.at(-1)?.equity_jpy ?? replay.accounting.wallet_jpy;
    const preliminary: DynamicBaselineResultSummary = {
        status: replay.status,
        replay_rejection: replay.rejection,
        final_equity_jpy: finalEquity,
        wallet_jpy: replay.accounting.wallet_jpy,
        jpy_profit_factor: profitFactor(replay.charge_ledger),
        trades: executionLedger.filter((entry) => entry.kind === "ENTRY" && entry.accepted).length,
        mtm_drawdown_pct: replay.maximum_mtm_dd?.drawdown_pct ?? 0,
        rejection_count: executionLedger.filter((entry) => !entry.accepted).length,
        preemption_count: replay.preemption_ledger.length,
        replay_event_count: replayInput.events.length,
        accounting: replay.accounting,
        execution_ledger: executionLedger,
        maximum_mtm_dd: replay.maximum_mtm_dd,
        top5_dd_windows: replay.top5_dd_windows,
    };
    const preliminaryManifest: DynamicBaselineManifest = {
        manifestVersion: 1,
        caseName: options.caseName,
        costBps: options.costBps,
        period: PERIOD,
        initialWalletJpy: initialWalletJpy,
        depositsJpy: 0,
        compounding: true,
        priceModel: "H1",
        overlayPolicy: "NONE",
        adverseStopRulesApplied: false,
        sourceCoverage: coverage,
        policy: { feeBps: options.costBps, slippageBps: options.costBps, allocator: policy.allocator },
        parityClassification: preliminaryClassification(coverage, replay),
        limitations: [
            "This Task 6 runner does not synthesize missing candidate validity, entry price, lifecycle, or preemption evidence.",
            "The historical fixed baseline anchors are comparison-only and are not used to alter replay output.",
        ],
        hashes: { result: "", allocator: hashAllocatorState(replay.allocator_state), ledgers: {} },
    };
    const comparison = compareDynamicBaseline({ manifest: preliminaryManifest, result: preliminary }, DEFAULT_BASELINE_ANCHORS[options.costBps]);
    const result: DynamicBaselineResultSummary = { ...preliminary, comparison };
    const ledgerValues: Readonly<Record<string, readonly unknown[]>> = {
        "execution-ledger.jsonl": replay.execution_ledger,
        "reservation-ledger.jsonl": replay.reservation_ledger,
        "preemption-ledger.jsonl": replay.preemption_ledger,
        "allocator-state-snapshots.jsonl": replay.allocator_state_snapshots,
        "mtm-timeline.jsonl": replay.mtm_timeline,
    };
    const ledgerHashes = Object.fromEntries(Object.entries(ledgerValues).map(([name, values]) => [name, hashCanonical(values)]));
    const hashes: DynamicBaselineHashes = {
        result: hashCanonical({ manifest: { ...preliminaryManifest, hashes: undefined }, result }),
        allocator: hashAllocatorState(replay.allocator_state),
        ledgers: ledgerHashes,
    };
    const manifest: DynamicBaselineManifest = { ...preliminaryManifest, parityClassification: comparison.parityClassification, hashes };
    const writtenFiles: string[] = [];
    if (writeArtifacts) {
        await mkdir(outputDir, { recursive: true });
        const manifestPath = resolve(outputDir, "manifest.json");
        const resultPath = resolve(outputDir, "result-summary.json");
        const comparisonPath = resolve(outputDir, "first-divergence.json");
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
        await writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
        writtenFiles.push(manifestPath, resultPath, comparisonPath);
        for (const [name, values] of Object.entries(ledgerValues)) {
            const path = resolve(outputDir, name);
            await writeJsonLines(path, values);
            writtenFiles.push(path);
        }
    }
    return { manifest, result, comparison, hashes, writtenFiles };
}

export async function runDynamicBaseline(options: DynamicRunnerOptions): Promise<DynamicBaselineRun> {
    const records = await resolveSourceRecords(options);
    const first = await runOnce(options, records, true);
    if (options.verifyDeterminism === true) {
        const second = await runOnce(options, records, false);
        if (first.hashes.result !== second.hashes.result || hashCanonical(first.hashes.ledgers) !== hashCanonical(second.hashes.ledgers) || first.hashes.allocator !== second.hashes.allocator) {
            fail("NONDETERMINISTIC_REPLAY", "independent replay hashes differ");
        }
    }
    return first;
}

export async function runDynamicCli(args: readonly string[] = process.argv.slice(2)): Promise<DynamicBaselineRun> {
    const parsed = parseDynamicRunnerArgs(args);
    return runDynamicBaseline(parsed);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runDynamicCli().then((run) => {
        process.stdout.write(`${JSON.stringify({
            outputDir: dirname(run.writtenFiles[0] ?? ""),
            costBps: run.manifest.costBps,
            parityClassification: run.manifest.parityClassification,
            observedRows: run.manifest.sourceCoverage.observedRows,
            replayableRows: run.manifest.sourceCoverage.replayableRows,
            resultHash: run.hashes.result,
            ledgerHashes: run.hashes.ledgers,
            independentReplayVerified: true,
        }, null, 2)}\n`);
        if (run.manifest.parityClassification.startsWith("BLOCKED_")) process.exitCode = 2;
    }).catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
