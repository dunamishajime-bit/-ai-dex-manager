import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import type {
    BaselineLedgerEntry,
    CandidateDecision,
    CanonicalSource,
    CanonicalSourceInput,
    CandleSeries,
    Direction,
    ExecutionBar,
    ExpectedSourceManifest,
    FundingRecord,
    JsonObject,
    JsonValue,
    ProductionSource,
    SourceHash,
    SourceManifest,
    SourceSeriesManifest,
    StrategyConfigSource,
    StrategyId,
} from "./types";

const ALLOWED_EXTENSIONS = new Set([".json", ".jsonl", ".ndjson", ".csv"]);
const SECRET_LOOKING_FILE = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|private|token|credential|wallet|mnemonic|keystore).*)$|\.(?:pem|key|p12|pfx)$/i;
const STRATEGIES = new Set<StrategyId>(["V12_V4", "PENGU", "Q102", "FET", "HYPE", "IDLE", "V52"]);

export class SourceContractError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(`${code}: ${message}`);
        this.name = "SourceContractError";
        this.code = code;
    }
}

interface CollectedFile {
    relativePath: string;
    absolutePath: string;
    content: string;
    hash: SourceHash;
}

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

type StableValue = string | number | boolean | null | undefined | object | readonly StableValue[];

function stableJson(value: StableValue): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJson(item)).join(",")}]`;
    }
    if (typeof value === "object" && value !== null) {
        const record = value as Record<string, StableValue>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}

function directoryHash(files: readonly CollectedFile[]): string {
    return sha256(files.map((file) => `${file.relativePath}\n${file.content}`).join("\n"));
}

function normalizeRelativePath(path: string): string {
    return path.replaceAll("\\", "/");
}

async function collectFiles(root: string, label: string): Promise<CollectedFile[]> {
    const absoluteRoot = resolve(root);
    let rootStats;
    try {
        rootStats = await stat(absoluteRoot);
    } catch {
        throw new SourceContractError("SOURCE_ROOT_MISSING", `${label} root does not exist: ${absoluteRoot}`);
    }
    if (!rootStats.isDirectory()) {
        throw new SourceContractError("SOURCE_ROOT_NOT_DIRECTORY", `${label} root is not a directory: ${absoluteRoot}`);
    }

    const result: CollectedFile[] = [];
    async function visit(directory: string): Promise<void> {
        const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const absolutePath = join(directory, entry.name);
            const relativePath = normalizeRelativePath(relative(absoluteRoot, absolutePath));
            if (entry.isSymbolicLink()) {
                throw new SourceContractError("SYMLINK_NOT_ALLOWED", `${label}/${relativePath} is not an explicit regular source file`);
            }
            if (entry.isDirectory()) {
                await visit(absolutePath);
                continue;
            }
            if (!entry.isFile()) {
                throw new SourceContractError("SOURCE_FILE_NOT_REGULAR", `${label}/${relativePath} is not a regular file`);
            }
            if (SECRET_LOOKING_FILE.test(relativePath)) {
                throw new SourceContractError("SECRET_LOOKING_FILE", `${label}/${relativePath} is not an allowed research source`);
            }
            const extension = extname(entry.name).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(extension)) {
                throw new SourceContractError("SOURCE_FILE_NOT_ALLOWLISTED", `${label}/${relativePath} has unsupported extension ${extension || "<none>"}`);
            }
            const content = await readFile(absolutePath, "utf8");
            result.push({
                relativePath,
                absolutePath,
                content,
                hash: { path: `${label}/${relativePath}`, sha256: sha256(content), bytes: Buffer.byteLength(content, "utf8") },
            });
        }
    }
    await visit(absoluteRoot);
    return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function parseJson(content: string, path: string): JsonValue {
    try {
        return JSON.parse(content) as JsonValue;
    } catch (error) {
        throw new SourceContractError("INVALID_JSON", `cannot parse ${path}: ${error instanceof Error ? error.message : "invalid JSON"}`);
    }
}

function asObject(value: JsonValue): JsonObject | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function asArray(value: JsonValue | undefined): readonly JsonValue[] {
    return Array.isArray(value) ? value : [];
}

function stringField(object: JsonObject, key: string): string | null {
    return typeof object[key] === "string" ? object[key] as string : null;
}

function numberField(object: JsonObject, key: string): number | null {
    return typeof object[key] === "number" && Number.isFinite(object[key] as number) ? object[key] as number : null;
}

function strategyField(object: JsonObject): StrategyId {
    const value = stringField(object, "strategy");
    if (value !== null && STRATEGIES.has(value as StrategyId)) {
        return value as StrategyId;
    }
    return "V12_V4";
}

function directionField(object: JsonObject): Direction {
    return stringField(object, "direction") === "SHORT" ? "SHORT" : "LONG";
}

function parseCsv(content: string): readonly JsonObject[] {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return [];
    const headers = lines[0].split(",").map((header) => header.trim());
    return lines.slice(1).map((line) => {
        const cells = line.split(",");
        const object: Record<string, JsonValue> = {};
        headers.forEach((header, index) => {
            const cell = (cells[index] ?? "").trim();
            const numeric = Number(cell);
            object[header] = cell !== "" && Number.isFinite(numeric) ? numeric : cell;
        });
        return object;
    });
}

function rowsFromFile(file: CollectedFile): readonly JsonObject[] {
    const extension = extname(file.relativePath).toLowerCase();
    if (extension === ".csv") return parseCsv(file.content);
    if (extension === ".jsonl" || extension === ".ndjson") {
        return file.content.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
            const parsed = asObject(parseJson(line, file.relativePath));
            if (parsed === null) throw new SourceContractError("INVALID_RECORD", `${file.relativePath} contains a non-object record`);
            return parsed;
        });
    }
    const parsed = parseJson(file.content, file.relativePath);
    const object = asObject(parsed);
    if (Array.isArray(parsed)) return parsed.map((item) => {
        const row = asObject(item);
        if (row === null) throw new SourceContractError("INVALID_RECORD", `${file.relativePath} contains a non-object record`);
        return row;
    });
    if (object === null) throw new SourceContractError("INVALID_RECORD", `${file.relativePath} must contain an object or array`);
    const rows = object.bars ?? object.rows ?? object.events ?? object.records;
    if (Array.isArray(rows)) {
        return rows.map((item) => {
            const row = asObject(item);
            if (row === null) throw new SourceContractError("INVALID_RECORD", `${file.relativePath} contains a non-object record`);
            return { ...object, ...row };
        });
    }
    return [object];
}

function inferredSeriesMetadata(file: CollectedFile): { symbol: string; timeframe: string } {
    const name = basename(file.relativePath, extname(file.relativePath));
    const match = /^(?<symbol>[A-Za-z0-9:.]+)[_-](?<timeframe>\d+[mhd])$/i.exec(name);
    if (match?.groups?.symbol && match.groups.timeframe) {
        return { symbol: match.groups.symbol, timeframe: match.groups.timeframe };
    }
    return { symbol: "UNKNOWN", timeframe: "1h" };
}

function parseCandleSeries(file: CollectedFile): CandleSeries | null {
    const rows = rowsFromFile(file);
    const first = rows[0];
    if (first === undefined) return null;
    const metadata = inferredSeriesMetadata(file);
    const symbol = stringField(first, "symbol") ?? metadata.symbol;
    const timeframe = stringField(first, "timeframe") ?? metadata.timeframe;
    const bars: ExecutionBar[] = [];
    for (const row of rows) {
        const ts = numberField(row, "ts") ?? numberField(row, "timestamp");
        const open = numberField(row, "open");
        const high = numberField(row, "high");
        const low = numberField(row, "low");
        const close = numberField(row, "close");
        const volume = numberField(row, "volume");
        if (ts === null || open === null || high === null || low === null || close === null || volume === null) return null;
        bars.push({ sourceHash: file.hash.sha256, ts, symbol, timeframe, open, high, low, close, volume });
    }
    return { sourceHash: file.hash.sha256, symbol, timeframe, bars };
}

function parseFunding(file: CollectedFile): FundingRecord[] {
    return rowsFromFile(file).flatMap((row) => {
        const ts = numberField(row, "ts") ?? numberField(row, "timestamp");
        const rate = numberField(row, "rate") ?? numberField(row, "fundingRate");
        const symbol = stringField(row, "symbol");
        if (ts === null || rate === null || symbol === null) return [];
        return [{ sourceHash: file.hash.sha256, ts, symbol, rate, source: stringField(row, "source") ?? "sanitized-funding" }];
    });
}

function lifecycleDefaults(file: CollectedFile, row: JsonObject, index: number): {
    sourceHash: string;
    ts: number;
    strategy: StrategyId;
    direction: Direction;
    symbol: string;
    requestedGross: number;
    acceptedGross: number;
    reservation: null;
    fill: null;
    exit: null;
    reason: string;
    fee: number;
    funding: number;
    slippage: number;
    policyHash: string;
    configHash: string;
    resultHash: string;
} {
    return {
        sourceHash: file.hash.sha256,
        ts: numberField(row, "ts") ?? numberField(row, "timestamp") ?? index,
        strategy: strategyField(row),
        direction: directionField(row),
        symbol: stringField(row, "symbol") ?? "UNKNOWN",
        requestedGross: numberField(row, "requestedGross") ?? 0,
        acceptedGross: numberField(row, "acceptedGross") ?? 0,
        reservation: null,
        fill: null,
        exit: null,
        reason: stringField(row, "reason") ?? "imported-canonical-event",
        fee: numberField(row, "fee") ?? 0,
        funding: numberField(row, "funding") ?? 0,
        slippage: numberField(row, "slippage") ?? 0,
        policyHash: stringField(row, "policyHash") ?? "source-policy",
        configHash: stringField(row, "configHash") ?? "source-config",
        resultHash: stringField(row, "resultHash") ?? file.hash.sha256,
    };
}

function parseBaseline(file: CollectedFile): BaselineLedgerEntry[] {
    return rowsFromFile(file).map((row, index) => ({
        ...lifecycleDefaults(file, row, index),
        tradeId: stringField(row, "tradeId") ?? `${file.hash.sha256}:${index}`,
        entry: null,
        finalExit: null,
    }));
}

function parseCandidates(file: CollectedFile): CandidateDecision[] {
    return rowsFromFile(file).map((row, index) => ({
        ...lifecycleDefaults(file, row, index),
        candidateId: stringField(row, "candidateId") ?? `${file.hash.sha256}:${index}`,
        accepted: row.accepted === true,
        rejectionReason: stringField(row, "rejectionReason"),
    }));
}

function timeframeMs(timeframe: string): number {
    const match = /^(\d+)(m|h|d)$/i.exec(timeframe);
    if (!match) throw new SourceContractError("TIMEFRAME_NOT_SUPPORTED", `unsupported timeframe: ${timeframe}`);
    const multiplier = Number(match[1]);
    const unit = match[2].toLowerCase();
    return multiplier * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
}

function validateInput(input: CanonicalSourceInput): void {
    if (!Number.isFinite(input.startTs) || !Number.isFinite(input.endTs) || input.startTs >= input.endTs) {
        throw new SourceContractError("INVALID_TIME_RANGE", "startTs must be before endTs");
    }
    if (!Number.isFinite(input.initialEquity) || input.initialEquity <= 0) {
        throw new SourceContractError("INVALID_INITIAL_EQUITY", "initialEquity must be positive");
    }
    if (!Number.isFinite(input.feeBps) || input.feeBps < 0 || !Number.isFinite(input.slippageBps) || input.slippageBps < 0) {
        throw new SourceContractError("INVALID_COSTS", "feeBps and slippageBps must be non-negative");
    }
}

function seriesManifest(series: CandleSeries, input: CanonicalSourceInput): SourceSeriesManifest {
    const bars = [...series.bars].sort((left, right) => left.ts - right.ts);
    const duplicates = [...new Set(bars.filter((bar, index) => index > 0 && bar.ts === bars[index - 1]?.ts).map((bar) => bar.ts))];
    if (duplicates.length > 0) {
        throw new SourceContractError("DUPLICATE_BAR", `${series.symbol}/${series.timeframe} has duplicate timestamp(s): ${duplicates.join(",")}`);
    }
    const missing: number[] = [];
    const interval = timeframeMs(series.timeframe);
    for (let index = 1; index < bars.length; index += 1) {
        const previous = bars[index - 1]?.ts;
        const current = bars[index]?.ts;
        if (previous === undefined || current === undefined) continue;
        for (let timestamp = previous + interval; timestamp < current; timestamp += interval) missing.push(timestamp);
    }
    if (missing.length > 0) {
        throw new SourceContractError("GAP_DETECTED", `${series.symbol}/${series.timeframe} has missing timestamp(s): ${missing.join(",")}`);
    }
    for (const bar of bars) {
        if (bar.ts < input.startTs || bar.ts > input.endTs) {
            throw new SourceContractError("RANGE_VIOLATION", `${series.symbol}/${series.timeframe} bar ${bar.ts} is outside the requested range`);
        }
    }
    return {
        symbol: series.symbol,
        timeframe: series.timeframe,
        firstTs: bars[0]?.ts ?? input.startTs,
        lastTs: bars[bars.length - 1]?.ts ?? input.endTs,
        rowCount: bars.length,
        missing,
        duplicates,
        sha256: sha256(stableJson(bars)),
    };
}

export function canonicalDirectorySha(files: readonly { path: string; content: string }[]): string {
    return sha256([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.path}\n${file.content}`).join("\n"));
}

export async function buildSourceManifest(source: CanonicalSource): Promise<SourceManifest> {
    validateInput(source.input);
    const series = [...source.candleSeries]
        .sort((left, right) => `${left.symbol}/${left.timeframe}`.localeCompare(`${right.symbol}/${right.timeframe}`))
        .map((item) => seriesManifest(item, source.input));
    const sourceHashes = [...source.sourceHashes].sort((left, right) => left.path.localeCompare(right.path));
    const productionHashes = sourceHashes.filter((item) => item.path.startsWith("source/"));
    const dataHashes = sourceHashes.filter((item) => item.path.startsWith("data/"));
    const sourceSha = sha256(sourceHashes.map((item) => `${item.path}\n${item.sha256}\n${item.bytes}`).join("\n"));
    const dataSha = sha256(dataHashes.map((item) => `${item.path}\n${item.sha256}\n${item.bytes}`).join("\n"));
    if (productionHashes.length === 0) throw new SourceContractError("PRODUCTION_SOURCE_MISSING", "no allowlisted production source was found");
    return {
        manifestVersion: 1,
        sourceSha,
        productionSha: source.input.productionSha,
        dataSha,
        sourceHashes,
        series,
        startTs: source.input.startTs,
        endTs: source.input.endTs,
        initialEquity: source.input.initialEquity,
        deposits: [...source.input.deposits].sort((left, right) => left.ts - right.ts),
        feeBps: source.input.feeBps,
        slippageBps: source.input.slippageBps,
        fundingSource: source.input.fundingSource,
    };
}

export function assertSourceManifest(manifest: SourceManifest, expected: ExpectedSourceManifest): void {
    const fields: readonly (keyof ExpectedSourceManifest)[] = [
        "manifestVersion", "sourceSha", "productionSha", "dataSha", "startTs", "endTs",
        "initialEquity", "deposits", "feeBps", "slippageBps", "fundingSource",
    ];
    for (const field of fields) {
        const expectedValue = expected[field];
        if (expectedValue !== undefined && stableJson(manifest[field] as JsonValue) !== stableJson(expectedValue as JsonValue)) {
            throw new SourceContractError("MANIFEST_MISMATCH", `${String(field)} does not match expected manifest`);
        }
    }
    if (expected.sourceHashes !== undefined && stableJson(manifest.sourceHashes) !== stableJson(expected.sourceHashes)) {
        throw new SourceContractError("MANIFEST_MISMATCH", "sourceHashes do not match expected manifest");
    }
    if (expected.series !== undefined) {
        if (manifest.series.length !== expected.series.length) {
            throw new SourceContractError("MANIFEST_MISMATCH", "series count does not match expected manifest");
        }
        for (const expectedSeries of expected.series) {
            const actual = manifest.series.find((item) => item.symbol === expectedSeries.symbol && item.timeframe === expectedSeries.timeframe);
            if (actual === undefined) throw new SourceContractError("MANIFEST_MISMATCH", "expected series is missing");
            for (const field of ["firstTs", "lastTs", "rowCount", "missing", "duplicates", "sha256"] as const) {
                const expectedValue = expectedSeries[field];
                if (expectedValue !== undefined && stableJson(actual[field] as JsonValue) !== stableJson(expectedValue as JsonValue)) {
                    throw new SourceContractError("MANIFEST_MISMATCH", `series ${actual.symbol}/${actual.timeframe} ${field} does not match`);
                }
            }
        }
    }
}

export async function loadCanonicalSource(input: CanonicalSourceInput): Promise<CanonicalSource> {
    validateInput(input);
    const sourceFiles = await collectFiles(input.sourceRoot, "source");
    const dataFiles = await collectFiles(input.dataRoot, "data");
    const productionSha = directoryHash(sourceFiles);
    if (productionSha !== input.productionSha) {
        throw new SourceContractError("PRODUCTION_SHA_MISMATCH", `expected ${input.productionSha}, received ${productionSha}`);
    }

    const productionSources: ProductionSource[] = sourceFiles.map((file) => ({
        path: file.relativePath,
        sha256: file.hash.sha256,
        content: parseJson(file.content, file.relativePath),
    }));
    const strategyConfigs: StrategyConfigSource[] = productionSources.flatMap((source) => {
        const object = asObject(source.content);
        const config = object === null ? null : asObject(object.config);
        const strategyValue = object === null ? null : stringField(object, "strategy");
        if (config === null || strategyValue === null || !STRATEGIES.has(strategyValue as StrategyId)) return [];
        return [{ sourceHash: source.sha256, strategy: strategyValue as StrategyId, configHash: sha256(stableJson(config)), config }];
    });
    const candleSeries = dataFiles.flatMap((file) => {
        if (file.relativePath.toLowerCase().includes("funding")) return [];
        const series = parseCandleSeries(file);
        return series === null ? [] : [series];
    });
    if (candleSeries.length === 0) throw new SourceContractError("CANDLE_SOURCE_MISSING", "no candle series was found under dataRoot");
    const funding = [...sourceFiles, ...dataFiles]
        .filter((file) => file.relativePath.toLowerCase().includes("funding"))
        .flatMap(parseFunding);
    const baselineLedger = sourceFiles.filter((file) => /baseline.*ledger|ledger.*baseline/i.test(file.relativePath)).flatMap(parseBaseline);
    const candidateEvents = sourceFiles.filter((file) => /candidate.*event|event.*candidate/i.test(file.relativePath)).flatMap(parseCandidates);
    const sourceHashes = [...sourceFiles, ...dataFiles].map((file) => file.hash).sort((left, right) => left.path.localeCompare(right.path));
    const source: CanonicalSource = {
        input,
        productionSources,
        strategyConfigs,
        candleSeries,
        funding,
        baselineLedger,
        candidateEvents,
        sourceHashes,
    };
    const manifest = await buildSourceManifest(source);
    return { ...source, manifest };
}
