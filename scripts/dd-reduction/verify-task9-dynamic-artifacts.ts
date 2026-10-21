import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TASK6_DIR = "docs/research/results/dd-reduction-dynamic-baseline-task6-20261021";
const TASK7_DIR = "docs/research/results/dd-reduction-initial-adverse-stop-audit-20261020";
const FIXED_REPLAY_MANIFEST = join(TASK7_DIR, "manifest.json");
const TASK6_MANIFEST = join(TASK6_DIR, "task6-dynamic-baseline-manifest.json");
const TASK7_STATUS = join(TASK7_DIR, "task9-dynamic-status.json");
const TASK8_COMPARISON = join(TASK7_DIR, "task8-comparison-status.json");
const TASK8_AUDIT = join(TASK7_DIR, "task8-research-only-audit.json");
const TASK8_REPORT = join(TASK7_DIR, "TASK8_FINAL_RESEARCH_REPORT_JA.md");
const REQUIRED_LEDGER_NAMES = [
    "execution-ledger.jsonl",
    "reservation-ledger.jsonl",
    "preemption-ledger.jsonl",
    "allocator-state-snapshots.jsonl",
    "mtm-timeline.jsonl",
] as const;
const REQUIRED_STRATEGIES = ["V12", "Q102", "PENGU", "FET", "RESIDUAL", "IDLE", "V52", "HYPE_LONG"] as const;
const BLOCKED = "BLOCKED_INCOMPLETE_SOURCE_COVERAGE";
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

export interface Task9ArtifactVerificationOptions {
    readonly repositoryRoot?: string;
    readonly checkExternalLedgers?: boolean;
}

export interface Task9ArtifactVerificationResult {
    readonly status: "PASS";
    readonly dynamicClassification: typeof BLOCKED;
    readonly observedRows: 3185;
    readonly replayableRows: 0;
    readonly productionChanges: 0;
    readonly liveClaim: false;
    readonly externalLedgerVerification: "CHECKED" | "REFERENCES_ONLY";
    readonly repeatedHashesMatch: boolean;
    readonly blockedCaseCount: 16;
}

export class Task9ArtifactVerificationError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(`${code}: ${message}`);
        this.name = "Task9ArtifactVerificationError";
        this.code = code;
    }
}

type JsonRecord = Record<string, unknown>;

function fail(code: string, message: string): never {
    throw new Task9ArtifactVerificationError(code, message);
}

function record(value: unknown, name: string): JsonRecord {
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail("ARTIFACT_SCHEMA", `${name} must be an object`);
    return value as JsonRecord;
}

function stringValue(value: unknown, name: string): string {
    if (typeof value !== "string" || value.length === 0) fail("ARTIFACT_SCHEMA", `${name} must be a non-empty string`);
    return value;
}

function integerValue(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isInteger(value)) fail("ARTIFACT_SCHEMA", `${name} must be an integer`);
    return value;
}

function hashValue(value: unknown, name: string): string {
    const hash = stringValue(value, name);
    if (!HASH_PATTERN.test(hash)) fail("ARTIFACT_SHA_INVALID", `${name} must be a SHA-256 hex digest`);
    return hash.toLowerCase();
}

function arrayValue(value: unknown, name: string): unknown[] {
    if (!Array.isArray(value)) fail("ARTIFACT_SCHEMA", `${name} must be an array`);
    return value;
}

function assertBlocked(value: unknown, name: string): void {
    if (value !== BLOCKED) fail("TASK9_CLASSIFICATION_INVALID", `${name} must remain ${BLOCKED}`);
}

function assertNoProductionMarkers(value: unknown, path = "artifact"): void {
    if (Array.isArray(value)) {
        value.forEach((child, index) => assertNoProductionMarkers(child, `${path}[${index}]`));
        return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as JsonRecord)) {
        const keyLower = key.toLowerCase();
        if (keyLower === "production_changes" && child !== 0) fail("PRODUCTION_MUTATION_MARKER", `${path}.${key} must be 0`);
        if (keyLower === "live_claim" && child !== false) fail("PRODUCTION_MUTATION_MARKER", `${path}.${key} must be false`);
        assertNoProductionMarkers(child, `${path}.${key}`);
    }
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as JsonRecord)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonicalize(child)]));
    }
    return value;
}

function canonicalHash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

async function readJson(path: string): Promise<unknown> {
    let contents: string;
    try {
        contents = await readFile(path, "utf8");
    } catch (error) {
        fail("ARTIFACT_MISSING", `${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        return JSON.parse(contents) as unknown;
    } catch (error) {
        fail("ARTIFACT_JSON_INVALID", `${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function hashJsonl(path: string): Promise<string> {
    const contents = await readFile(path, "utf8");
    const rows: unknown[] = [];
    for (const [index, line] of contents.split(/\r?\n/).entries()) {
        if (line.trim().length === 0) continue;
        try {
            rows.push(JSON.parse(line) as unknown);
        } catch (error) {
            fail("LEDGER_JSON_INVALID", `${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return canonicalHash(rows);
}

function sourceCoverageFromTask6(manifest: JsonRecord): JsonRecord {
    const source = record(manifest.candidate_source, "task6.candidate_source");
    if (integerValue(source.expected_rows, "task6.candidate_source.expected_rows") !== 3185
        || integerValue(source.observed_rows, "task6.candidate_source.observed_rows") !== 3185
        || integerValue(source.normalized_rows, "task6.candidate_source.normalized_rows") !== 0
        || integerValue(source.fail_closed_rows, "task6.candidate_source.fail_closed_rows") !== 3185
        || integerValue(source.replayable_rows, "task6.candidate_source.replayable_rows") !== 0) {
        fail("SOURCE_COVERAGE_INVALID", "Task 6 must preserve 3,185 observed and fail-closed rows with zero replayable rows");
    }
    assertBlockedForManifestRuns(manifest);
    const strategies = arrayValue(source.strategy_coverage, "task6.candidate_source.strategy_coverage").map((value, index) => stringValue(value, `task6.strategy_coverage[${index}]`));
    if (REQUIRED_STRATEGIES.some((strategy) => !strategies.includes(strategy))) fail("SOURCE_COVERAGE_INVALID", "Task 6 strategy coverage is incomplete");
    if (source.status !== "INCOMPLETE") fail("SOURCE_COVERAGE_INVALID", "Task 6 source status must be INCOMPLETE");
    return source;
}

function assertBlockedForManifestRuns(manifest: JsonRecord): void {
    const runs = record(manifest.runs, "task6.runs");
    for (const cost of ["10", "30"]) {
        const run = record(runs[cost], `task6.runs.${cost}`);
        assertBlocked(run.parity_classification, `task6.runs.${cost}.parity_classification`);
        hashValue(run.result_hash, `task6.runs.${cost}.result_hash`);
        hashValue(run.allocator_hash, `task6.runs.${cost}.allocator_hash`);
        const ledgers = record(run.ledger_hashes, `task6.runs.${cost}.ledger_hashes`);
        for (const name of REQUIRED_LEDGER_NAMES) hashValue(ledgers[name], `task6.runs.${cost}.ledger_hashes.${name}`);
        stringValue(run.output_dir, `task6.runs.${cost}.output_dir`);
    }
}

export function assertTask9Task6Manifest(manifestValue: unknown, options: { readonly requireExternalFiles: boolean }): void {
    const manifest = record(manifestValue, "task6 manifest");
    sourceCoverageFromTask6(manifest);
    if (manifest.overlay_policy !== "NONE" || manifest.adverse_stop_rules_applied !== false) fail("TASK6_POLICY_INVALID", "Task 6 must be overlay-free");
    if (options.requireExternalFiles) fail("TASK6_LEDGER_SHA_UNVERIFIABLE", "async external ledger verification must be used");
}

export function assertTask9DynamicStatus(statusValue: unknown): void {
    const status = record(statusValue, "task7 status");
    assertBlocked(status.classification, "task7.classification");
    if (status.economic_acceptance_eligible !== false) fail("TASK7_CLASSIFICATION_INVALID", "Task 7 economic acceptance must be false");
    if (status.production_changes !== 0 || status.live_claim !== false) fail("PRODUCTION_MUTATION_MARKER", "Task 7 must be research-only");
    const coverage = record(status.source_coverage, "task7.source_coverage");
    if (integerValue(coverage.expected_rows, "task7.source_coverage.expected_rows") !== 3185) fail("SOURCE_COVERAGE_INVALID", "Task 7 expected rows must be 3,185");
    for (const field of ["observed_rows", "normalized_rows", "fail_closed_rows", "replayable_rows"] as const) {
        const values = record(coverage[field], `task7.source_coverage.${field}`);
        const expected = field === "normalized_rows" || field === "replayable_rows" ? 0 : 3185;
        for (const cost of ["10", "30"]) if (integerValue(values[cost], `task7.source_coverage.${field}.${cost}`) !== expected) fail("SOURCE_COVERAGE_INVALID", `Task 7 ${field} must preserve ${expected}`);
    }
    const cases = arrayValue(status.cases, "task7.cases");
    if (cases.length !== 16) fail("TASK7_CASES_INVALID", "Task 7 must contain 16 cost/case classifications");
    for (const [index, itemValue] of cases.entries()) {
        const item = record(itemValue, `task7.cases[${index}]`);
        assertBlocked(item.classification, `task7.cases[${index}].classification`);
    }
    const gate = record(status.cumulative_gate, "task7.cumulative_gate");
    assertBlocked(gate.status, "task7.cumulative_gate.status");
    const diagnostic = record(status.diagnostic_only, "task7.diagnostic_only");
    if (diagnostic.zero_trade_result_is_not_a_backtest_metric !== true) fail("TASK7_DIAGNOSTIC_INVALID", "zero-trade output must remain diagnostic-only");
    assertNoProductionMarkers(status);
}

export function assertTask9ResearchOnlyAudit(auditValue: unknown): void {
    const audit = record(auditValue, "research-only audit");
    if (audit.production_changes !== 0 || audit.live_claim !== false || audit.audit_status !== "PASS") fail("RESEARCH_SCOPE_MUTATION", "research-only audit must be PASS with no production or live changes");
    if (arrayValue(audit.forbidden_paths, "research-only audit.forbidden_paths").length !== 0) fail("RESEARCH_SCOPE_MUTATION", "forbidden paths were changed");
    if (arrayValue(audit.forbidden_markers, "research-only audit.forbidden_markers").length !== 0) fail("RESEARCH_SCOPE_MUTATION", "forbidden mutation markers were found");
}

async function verifyExternalTask6(manifest: JsonRecord): Promise<boolean> {
    const runs = record(manifest.runs, "task6.runs");
    let repeatedHashesMatch = true;
    for (const cost of ["10", "30"]) {
        const run = record(runs[cost], `task6.runs.${cost}`);
        const outputDir = stringValue(run.output_dir, `task6.runs.${cost}.output_dir`);
        const primaryManifestPath = join(outputDir, "manifest.json");
        if (!(await fileExists(primaryManifestPath))) fail("LEDGER_REFERENCE_MISSING", `${primaryManifestPath} is missing`);
        const primary = record(await readJson(primaryManifestPath), primaryManifestPath);
        const primaryHashes = record(primary.hashes, `${primaryManifestPath}.hashes`);
        for (const name of REQUIRED_LEDGER_NAMES) {
            const path = join(outputDir, name);
            if (!(await fileExists(path))) fail("LEDGER_REFERENCE_MISSING", `${path} is missing`);
            const expected = hashValue(record(run.ledger_hashes, `task6.runs.${cost}.ledger_hashes`)[name], `task6.runs.${cost}.ledger_hashes.${name}`);
            const actual = await hashJsonl(path);
            if (actual !== expected) fail("LEDGER_SHA_MISMATCH", `${path} expected ${expected}, got ${actual}`);
            if (hashValue(record(primaryHashes.ledgers, `${primaryManifestPath}.hashes.ledgers`)[name], `${primaryManifestPath}.hashes.ledgers.${name}`) !== expected) fail("LEDGER_SHA_MISMATCH", `${primaryManifestPath}.hashes.ledgers.${name} disagrees with compact manifest`);
        }
        const sourceCoverage = record(primary.sourceCoverage, `${primaryManifestPath}.sourceCoverage`);
        for (const sourceReferenceValue of arrayValue(sourceCoverage.sourceReferences, `${primaryManifestPath}.sourceCoverage.sourceReferences`)) {
            const sourceReference = record(sourceReferenceValue, `${primaryManifestPath}.sourceCoverage.sourceReferences[]`);
            const sourcePath = stringValue(sourceReference.path, "source reference path");
            if (!(await fileExists(sourcePath))) fail("SOURCE_REFERENCE_MISSING", sourcePath);
            const actualSourceHash = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
            if (actualSourceHash !== hashValue(sourceReference.sha256, "source reference sha256")) fail("SOURCE_SHA_MISMATCH", sourcePath);
        }
        const repeatDir = outputDir.replace(new RegExp(`cost-${cost}bps$`), `cost-${cost}bps-repeat`);
        const repeatManifestPath = join(repeatDir, "manifest.json");
        if (!(await fileExists(repeatManifestPath))) fail("REPEAT_REFERENCE_MISSING", repeatManifestPath);
        const repeat = record(await readJson(repeatManifestPath), repeatManifestPath);
        const repeatHashes = record(repeat.hashes, `${repeatManifestPath}.hashes`);
        if (hashValue(repeatHashes.result, `${repeatManifestPath}.hashes.result`) !== hashValue(primaryHashes.result, `${primaryManifestPath}.hashes.result`)
            || hashValue(repeatHashes.allocator, `${repeatManifestPath}.hashes.allocator`) !== hashValue(primaryHashes.allocator, `${primaryManifestPath}.hashes.allocator`)) {
            repeatedHashesMatch = false;
        }
        for (const name of REQUIRED_LEDGER_NAMES) {
            const primaryLedger = hashValue(record(primaryHashes.ledgers, `${primaryManifestPath}.hashes.ledgers`)[name], `${primaryManifestPath}.hashes.ledgers.${name}`);
            const repeatLedger = hashValue(record(repeatHashes.ledgers, `${repeatManifestPath}.hashes.ledgers`)[name], `${repeatManifestPath}.hashes.ledgers.${name}`);
            if (primaryLedger !== repeatLedger) repeatedHashesMatch = false;
        }
    }
    if (!repeatedHashesMatch) fail("REPEAT_SHA_MISMATCH", "Task 6 primary/repeat hashes differ");
    return repeatedHashesMatch;
}

export async function verifyTask9DynamicArtifacts(options: Task9ArtifactVerificationOptions = {}): Promise<Task9ArtifactVerificationResult> {
    const repositoryRoot = resolve(options.repositoryRoot ?? resolve(fileURLToPath(import.meta.url), "../../.."));
    const task6 = await readJson(join(repositoryRoot, TASK6_MANIFEST));
    const task7 = await readJson(join(repositoryRoot, TASK7_STATUS));
    const fixedManifest = await readJson(join(repositoryRoot, FIXED_REPLAY_MANIFEST));
    const comparison = await readJson(join(repositoryRoot, TASK8_COMPARISON));
    const audit = await readJson(join(repositoryRoot, TASK8_AUDIT));
    await access(join(repositoryRoot, TASK8_REPORT));
    assertTask9Task6Manifest(task6, { requireExternalFiles: false });
    assertTask9DynamicStatus(task7);
    assertTask9ResearchOnlyAudit(audit);
    assertNoProductionMarkers(fixedManifest);
    assertNoProductionMarkers(comparison);
    const fixed = record(fixedManifest, "fixed replay manifest");
    if (fixed.status !== "RESEARCH_ONLY_NONCANONICAL") fail("FIXED_REPLAY_MUTATED", "fixed replay status changed");
    const dynamicStatus = record(await readJson(join(repositoryRoot, join(TASK7_DIR, "DYNAMIC_REPLAY_STATUS.json"))), "dynamic replay status");
    if (dynamicStatus.status !== "BLOCKED_DYNAMIC_RESELECTION_NOT_IMPLEMENTED") fail("FIXED_REPLAY_MUTATED", "preserved fixed-replay dynamic status changed");
    if (options.checkExternalLedgers === true) {
        await verifyExternalTask6(record(task6, "task6 manifest"));
    }
    return {
        status: "PASS",
        dynamicClassification: BLOCKED,
        observedRows: 3185,
        replayableRows: 0,
        productionChanges: 0,
        liveClaim: false,
        externalLedgerVerification: options.checkExternalLedgers === true ? "CHECKED" : "REFERENCES_ONLY",
        repeatedHashesMatch: true,
        blockedCaseCount: 16,
    };
}

async function main(args: readonly string[]): Promise<void> {
    const result = await verifyTask9DynamicArtifacts({ checkExternalLedgers: args.includes("--check-external") });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
