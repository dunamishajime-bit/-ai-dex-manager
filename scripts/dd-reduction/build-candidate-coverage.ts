import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    buildCandidateSourceManifest,
    normalizeDynamicCandidates,
} from "../../lib/backtest/dd-reduction/dynamic-source";
import type {
    CandidateSourceKind,
    CandidateSourceRecord,
    EvidenceLevel,
} from "../../lib/backtest/dd-reduction/dynamic-types";

function requiredFlag(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (value === undefined || value.startsWith("--")) throw new Error(`missing required flag ${name}`);
    return value;
}

function repeatedFlag(args: readonly string[], name: string): readonly string[] {
    const values: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] !== name) continue;
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a file path`);
        values.push(value);
        index += 1;
    }
    return values;
}

function numberListFlag(args: readonly string[], name: string, fallback: readonly number[]): readonly number[] {
    const values = repeatedFlag(args, name);
    if (values.length === 0) return fallback;
    const parsed = values.flatMap((value) => value.split(",").map(Number));
    if (parsed.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`${name} must contain non-negative finite numbers`);
    return parsed;
}

function csvLine(line: string): string[] {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
            if (quoted && line[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else quoted = !quoted;
        } else if (character === "," && !quoted) {
            cells.push(cell);
            cell = "";
        } else cell += character;
    }
    if (quoted) throw new Error("CSV contains an unterminated quoted field");
    cells.push(cell);
    return cells;
}

function csvValue(value: string): unknown {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null") return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
    return trimmed;
}

function rowsFromContent(content: string, path: string): readonly Readonly<Record<string, unknown>>[] {
    const extension = extname(path).toLowerCase();
    if (extension === ".jsonl" || extension === ".ndjson") {
        return content.split(/\r?\n/).map((line, index) => {
            if (line.trim() === "") return null;
            const value = JSON.parse(line) as unknown;
            if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path}:${index + 1} must be a JSON object`);
            return value as Readonly<Record<string, unknown>>;
        }).filter((row): row is Readonly<Record<string, unknown>> => row !== null);
    }
    if (extension === ".csv") {
        const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
        const header = lines[0] === undefined ? [] : csvLine(lines[0]);
        return lines.slice(1).map((line) => Object.fromEntries(csvLine(line).map((value, index) => [header[index] ?? `column-${index + 1}`, csvValue(value)])));
    }
    const value = JSON.parse(content) as unknown;
    if (Array.isArray(value)) return value as readonly Readonly<Record<string, unknown>>[];
    if (typeof value !== "object" || value === null) throw new Error(`${path} must contain an object or array`);
    const object = value as Record<string, unknown>;
    for (const key of ["rows", "candidates", "candidateDecisions", "events"]) {
        if (Array.isArray(object[key])) return object[key] as readonly Readonly<Record<string, unknown>>[];
    }
    return [object];
}

async function hashFile(path: string): Promise<string> {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function record(path: string, kind: CandidateSourceKind, evidence: EvidenceLevel): Promise<CandidateSourceRecord> {
    const absolutePath = resolve(path);
    const content = await readFile(absolutePath, "utf8");
    return { kind, path: absolutePath, sourceSha256: await hashFile(absolutePath), evidence, rows: rowsFromContent(content, absolutePath) };
}

export async function buildCandidateCoverage(args: readonly string[] = process.argv.slice(2)): Promise<void> {
    const outputDir = resolve(requiredFlag(args, "--output-dir"));
    const records: CandidateSourceRecord[] = [];
    for (const path of repeatedFlag(args, "--raw-ledger")) records.push(await record(path, "RAW_CANDIDATE_DECISIONS", "ORIGINAL_EVIDENCE"));
    for (const path of repeatedFlag(args, "--market-data")) records.push(await record(path, "SAVED_MARKET_DATA", "CAUSALLY_REGENERATED"));
    for (const path of repeatedFlag(args, "--strategy-adapter")) records.push(await record(path, "STRATEGY_ADAPTER", "CAUSALLY_REGENERATED"));
    if (records.length === 0) throw new Error("at least one of --raw-ledger, --market-data, or --strategy-adapter is required");
    const result = normalizeDynamicCandidates({
        records,
        feeBps: numberListFlag(args, "--fee-bps", [10, 30]),
        slippageBps: numberListFlag(args, "--slippage-bps", [10, 30]),
    });
    const manifest = buildCandidateSourceManifest(result);
    await mkdir(outputDir, { recursive: true });
    await writeFile(resolve(outputDir, "candidate-source-coverage-matrix.json"), `${JSON.stringify(manifest.coverageMatrix, null, 2)}\n`, "utf8");
    await writeFile(resolve(outputDir, "candidate-source-sha256-index.json"), `${JSON.stringify(manifest.sha256Index, null, 2)}\n`, "utf8");
    await writeFile(resolve(outputDir, "candidate-source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ outputDir, observedRowCount: manifest.observedRowCount, failClosedRowCount: manifest.failClosedRowCount, strategyCounts: manifest.strategyCounts, sourceCount: manifest.sourceHashes.length }, null, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    buildCandidateCoverage().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
