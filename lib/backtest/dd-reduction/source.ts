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
    ExecutionExit,
    ExecutionFill,
    ExpectedSourceManifest,
    FundingRecord,
    JsonObject,
    JsonValue,
    ProductionSource,
    Reservation,
    SourceFileKind,
    SourceFileSnapshot,
    SourceHash,
    SourceManifest,
    SourceSeriesManifest,
    StrategyConfigSource,
    StrategyId,
} from "./types";

const ALLOWED_EXTENSIONS = new Set([".json", ".jsonl", ".ndjson", ".csv"]);
const SECRET_LOOKING_FILE = /(^|[\\/])(?:\.env(?:\..*)?|.*(?:secret|private|token|credential|wallet|mnemonic|keystore).*)$|\.(?:pem|key|p12|pfx)$/i;
const STRATEGIES = new Set<StrategyId>(["V12_V4", "PENGU", "Q102", "FET", "HYPE", "IDLE", "V52"]);
const DIRECTIONS = new Set<Direction>(["LONG", "SHORT"]);

export class SourceContractError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(`${code}: ${message}`);
        this.name = "SourceContractError";
        this.code = code;
    }
}

interface CollectedFile extends SourceFileSnapshot {
    label: "source" | "data";
    relativePath: string;
}

type StableValue = string | number | boolean | null | undefined | object | readonly StableValue[];

const MAX_MISSING_BARS = 1_000_000;

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: StableValue): string {
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
    if (typeof value === "object" && value !== null) {
        const record = value as Record<string, StableValue>;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}

function normalizeRelativePath(path: string): string {
    return path.replaceAll("\\", "/");
}

function sourceKind(label: "source" | "data", path: string): SourceFileKind {
    if (label === "data") return path.toLowerCase().includes("funding") ? "funding" : "candle";
    const lower = path.toLowerCase();
    if (/baseline.*ledger|ledger.*baseline/.test(lower)) return "baseline";
    if (/candidate.*event|event.*candidate/.test(lower)) return "candidate";
    if (lower.includes("funding")) return "funding";
    return "production";
}

export function canonicalDirectorySha(files: readonly { path: string; content: string }[]): string {
    return sha256([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.path}\n${file.content}`).join("\n"));
}

async function collectFiles(root: string, label: "source" | "data"): Promise<CollectedFile[]> {
    const absoluteRoot = resolve(root);
    let rootStats;
    try {
        rootStats = await stat(absoluteRoot);
    } catch {
        throw new SourceContractError("SOURCE_ROOT_MISSING", `${label} root does not exist: ${absoluteRoot}`);
    }
    if (!rootStats.isDirectory()) throw new SourceContractError("SOURCE_ROOT_NOT_DIRECTORY", `${label} root is not a directory: ${absoluteRoot}`);

    const result: CollectedFile[] = [];
    async function visit(directory: string): Promise<void> {
        const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const absolutePath = join(directory, entry.name);
            const relativePath = normalizeRelativePath(relative(absoluteRoot, absolutePath));
            if (entry.isSymbolicLink()) throw new SourceContractError("SYMLINK_NOT_ALLOWED", `${label}/${relativePath} is not an explicit regular source file`);
            if (entry.isDirectory()) {
                await visit(absolutePath);
                continue;
            }
            if (!entry.isFile()) throw new SourceContractError("SOURCE_FILE_NOT_REGULAR", `${label}/${relativePath} is not a regular file`);
            if (SECRET_LOOKING_FILE.test(relativePath)) throw new SourceContractError("SECRET_LOOKING_FILE", `${label}/${relativePath} is not an allowed research source`);
            const extension = extname(entry.name).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(extension)) throw new SourceContractError("SOURCE_FILE_NOT_ALLOWLISTED", `${label}/${relativePath} has unsupported extension ${extension || "<none>"}`);
            const content = await readFile(absolutePath, "utf8");
            result.push({
                path: `${label}/${relativePath}`,
                relativePath,
                label,
                kind: sourceKind(label, relativePath),
                content,
                sha256: sha256(content),
                bytes: Buffer.byteLength(content, "utf8"),
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

function requiredString(row: JsonObject, key: string, context: string): string {
    const value = row[key];
    if (typeof value !== "string" || value.trim().length === 0) throw new SourceContractError(`INVALID_${context}`, `${key} must be a non-empty string`);
    return value;
}

function requiredNumber(row: JsonObject, key: string, context: string): number {
    const value = row[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new SourceContractError(`INVALID_${context}`, `${key} must be a finite number`);
    return value;
}

function requiredHash(row: JsonObject, key: string, context: string): string {
    const value = requiredString(row, key, context);
    if (!/^[a-f0-9]{64}$/i.test(value)) throw new SourceContractError(`INVALID_${context}`, `${key} must be a SHA256 hex string`);
    return value;
}

function requiredStrategy(row: JsonObject, key: string, context: string): StrategyId {
    const value = requiredString(row, key, context);
    if (!STRATEGIES.has(value as StrategyId)) throw new SourceContractError(`INVALID_${context}`, `${key} has unknown strategy ${value}`);
    return value as StrategyId;
}

function requiredDirection(row: JsonObject, key: string, context: string): Direction {
    const value = requiredString(row, key, context);
    if (!DIRECTIONS.has(value as Direction)) throw new SourceContractError(`INVALID_${context}`, `${key} has unknown direction ${value}`);
    return value as Direction;
}

function parseCsvLine(line: string, path: string, lineNumber: number): string[] {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
            if (quoted && line[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (character === "," && !quoted) {
            cells.push(cell);
            cell = "";
        } else {
            cell += character;
        }
    }
    if (quoted) throw new SourceContractError("INVALID_CSV", `${path}:${lineNumber} has an unterminated quoted field`);
    cells.push(cell);
    return cells;
}

function parseCsvValue(value: string): JsonValue {
    const trimmed = value.trim();
    if (trimmed === "null") return null;
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    const numeric = Number(trimmed);
    if (trimmed.length > 0 && Number.isFinite(numeric)) return numeric;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(trimmed) as JsonValue;
    return trimmed;
}

function parseCsv(content: string, path: string): readonly JsonObject[] {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) throw new SourceContractError("INVALID_CSV", `${path} has no header`);
    const headers = parseCsvLine(lines[0] ?? "", path, 1).map((header) => header.trim());
    if (headers.some((header) => header.length === 0) || new Set(headers).size !== headers.length) throw new SourceContractError("INVALID_CSV", `${path} has invalid or duplicate headers`);
    return lines.slice(1).map((line, offset) => {
        const cells = parseCsvLine(line, path, offset + 2);
        if (cells.length !== headers.length) throw new SourceContractError("INVALID_CSV", `${path}:${offset + 2} has the wrong field count`);
        const row: Record<string, JsonValue> = {};
        headers.forEach((header, index) => { row[header] = parseCsvValue(cells[index] ?? ""); });
        return row;
    });
}

function rowsFromFile(file: CollectedFile): readonly JsonObject[] {
    const extension = extname(file.relativePath).toLowerCase();
    if (extension === ".csv") return parseCsv(file.content, file.path);
    if (extension === ".jsonl" || extension === ".ndjson") {
        return file.content.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line, index) => {
            const row = asObject(parseJson(line, `${file.path}:${index + 1}`));
            if (row === null) throw new SourceContractError(`INVALID_${file.kind.toUpperCase()}_ROW`, `${file.path}:${index + 1} must be an object`);
            return row;
        });
    }
    const parsed = parseJson(file.content, file.path);
    if (Array.isArray(parsed)) return parsed.map((item, index) => {
        const row = asObject(item);
        if (row === null) throw new SourceContractError(`INVALID_${file.kind.toUpperCase()}_ROW`, `${file.path}:${index + 1} must be an object`);
        return row;
    });
    const object = asObject(parsed);
    if (object === null) throw new SourceContractError(`INVALID_${file.kind.toUpperCase()}_ROW`, `${file.path} must contain an object or array`);
    const collectionKey = ["bars", "rows", "events", "records"].find((key) => Object.prototype.hasOwnProperty.call(object, key));
    if (collectionKey === undefined) return [object];
    const collection = object[collectionKey];
    if (!Array.isArray(collection)) throw new SourceContractError(`INVALID_${file.kind.toUpperCase()}_ROW`, `${file.path}.${collectionKey} must be an array`);
    const metadata: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(object)) if (key !== collectionKey) metadata[key] = value;
    return collection.map((item, index) => {
        const row = asObject(item);
        if (row === null) throw new SourceContractError(`INVALID_${file.kind.toUpperCase()}_ROW`, `${file.path}:${index + 1} must be an object`);
        return { ...metadata, ...row };
    });
}

function productionValue(file: CollectedFile): JsonValue {
    const extension = extname(file.relativePath).toLowerCase();
    if (extension === ".json") return parseJson(file.content, file.path);
    return rowsFromFile(file);
}

function validateProductionValue(value: JsonValue, path: string): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) => validateProductionValue(item, `${path}:${index + 1}`));
        return;
    }
    const object = asObject(value);
    if (object === null) return;
    if (Object.prototype.hasOwnProperty.call(object, "strategy")) requiredStrategy(object, "strategy", "PRODUCTION_SOURCE");
    if (Object.prototype.hasOwnProperty.call(object, "direction")) requiredDirection(object, "direction", "PRODUCTION_SOURCE");
}

function parseProductionSource(file: CollectedFile): ProductionSource {
    const value = productionValue(file);
    const object = asObject(value);
    if (object === null || Object.keys(object).length === 0) {
        throw new SourceContractError("INVALID_PRODUCTION_SOURCE", `${file.path} must contain a non-empty production object`);
    }
    const strategy = requiredStrategy(object, "strategy", "PRODUCTION_SOURCE");
    const config = asObject(object.config);
    if (config === null || Object.keys(config).length === 0) {
        throw new SourceContractError("INVALID_PRODUCTION_SOURCE", `${file.path}.config must be a non-empty object`);
    }
    validateProductionValue(value, file.path);
    return { path: file.relativePath, sha256: file.sha256, content: value };
}

function inferredSeriesMetadata(file: CollectedFile): { symbol: string; timeframe: string } | null {
    const name = basename(file.relativePath, extname(file.relativePath));
    const match = /^(?<symbol>[A-Za-z0-9:.]+)[_-](?<timeframe>\d+[mhd])$/i.exec(name);
    if (match?.groups?.symbol && match.groups.timeframe) return { symbol: match.groups.symbol, timeframe: match.groups.timeframe };
    return null;
}

function parseCandleRows(file: CollectedFile): ExecutionBar[] {
    const rows = rowsFromFile(file);
    if (rows.length === 0) throw new SourceContractError("INVALID_CANDLE_ROW", `${file.path} has no candle rows`);
    const inferred = inferredSeriesMetadata(file);
    return rows.map((row, index) => {
        const ts = Object.prototype.hasOwnProperty.call(row, "ts") ? requiredNumber(row, "ts", "CANDLE_ROW") : requiredNumber(row, "timestamp", "CANDLE_ROW");
        const symbol = Object.prototype.hasOwnProperty.call(row, "symbol") ? requiredString(row, "symbol", "CANDLE_ROW") : inferred?.symbol;
        const timeframe = Object.prototype.hasOwnProperty.call(row, "timeframe") ? requiredString(row, "timeframe", "CANDLE_ROW") : inferred?.timeframe;
        if (symbol === undefined || timeframe === undefined) throw new SourceContractError("INVALID_CANDLE_ROW", `${file.path}:${index + 1} must explicitly provide symbol/timeframe or use a recognized filename`);
        timeframeMs(timeframe);
        return {
            sourceHash: file.sha256,
            ts,
            symbol,
            timeframe,
            open: requiredNumber(row, "open", "CANDLE_ROW"),
            high: requiredNumber(row, "high", "CANDLE_ROW"),
            low: requiredNumber(row, "low", "CANDLE_ROW"),
            close: requiredNumber(row, "close", "CANDLE_ROW"),
            volume: requiredNumber(row, "volume", "CANDLE_ROW"),
        };
    });
}

function parseFundingRows(file: CollectedFile): FundingRecord[] {
    const rows = rowsFromFile(file);
    if (rows.length === 0) throw new SourceContractError("INVALID_FUNDING_ROW", `${file.path} has no funding rows`);
    return rows.map((row) => ({
        sourceHash: file.sha256,
        ts: Object.prototype.hasOwnProperty.call(row, "ts") ? requiredNumber(row, "ts", "FUNDING_ROW") : requiredNumber(row, "timestamp", "FUNDING_ROW"),
        symbol: requiredString(row, "symbol", "FUNDING_ROW"),
        rate: Object.prototype.hasOwnProperty.call(row, "rate") ? requiredNumber(row, "rate", "FUNDING_ROW") : requiredNumber(row, "fundingRate", "FUNDING_ROW"),
        source: requiredString(row, "source", "FUNDING_ROW"),
    }));
}

function nullableObject(row: JsonObject, key: string, context: string): JsonObject | null {
    if (!Object.prototype.hasOwnProperty.call(row, key)) throw new SourceContractError(`INVALID_${context}`, `${key} is required and must be an object or null`);
    const value = row[key];
    if (value === null) return null;
    const object = asObject(value);
    if (object === null) throw new SourceContractError(`INVALID_${context}`, `${key} must be an object or null`);
    return object;
}

function parseReservation(value: JsonObject | null, context: string): Reservation | null {
    if (value === null) return null;
    return {
        sourceHash: requiredHash(value, "sourceHash", context),
        ts: requiredNumber(value, "ts", context),
        requestedGross: requiredNumber(value, "requestedGross", context),
        acceptedGross: requiredNumber(value, "acceptedGross", context),
        reservedGross: requiredNumber(value, "reservedGross", context),
        reason: requiredString(value, "reason", context),
    };
}

function parseFill(value: JsonObject | null, context: string): ExecutionFill | null {
    if (value === null) return null;
    return {
        sourceHash: requiredHash(value, "sourceHash", context),
        ts: requiredNumber(value, "ts", context),
        price: requiredNumber(value, "price", context),
        quantity: requiredNumber(value, "quantity", context),
        gross: requiredNumber(value, "gross", context),
        fee: requiredNumber(value, "fee", context),
        funding: requiredNumber(value, "funding", context),
        slippage: requiredNumber(value, "slippage", context),
        reason: requiredString(value, "reason", context),
    };
}

function parseExit(value: JsonObject | null, context: string): ExecutionExit | null {
    if (value === null) return null;
    return {
        sourceHash: requiredHash(value, "sourceHash", context),
        ts: requiredNumber(value, "ts", context),
        price: requiredNumber(value, "price", context),
        quantity: requiredNumber(value, "quantity", context),
        gross: requiredNumber(value, "gross", context),
        fee: requiredNumber(value, "fee", context),
        funding: requiredNumber(value, "funding", context),
        slippage: requiredNumber(value, "slippage", context),
        realizedPnl: requiredNumber(value, "realizedPnl", context),
        reason: requiredString(value, "reason", context),
    };
}

function lifecycleEvidence(row: JsonObject, context: string) {
    return {
        sourceHash: requiredHash(row, "sourceHash", context),
        ts: requiredNumber(row, "ts", context),
        strategy: requiredStrategy(row, "strategy", context),
        direction: requiredDirection(row, "direction", context),
        symbol: requiredString(row, "symbol", context),
        requestedGross: requiredNumber(row, "requestedGross", context),
        acceptedGross: requiredNumber(row, "acceptedGross", context),
        reservation: parseReservation(nullableObject(row, "reservation", context), context),
        fill: parseFill(nullableObject(row, "fill", context), context),
        exit: parseExit(nullableObject(row, "exit", context), context),
        reason: requiredString(row, "reason", context),
        fee: requiredNumber(row, "fee", context),
        funding: requiredNumber(row, "funding", context),
        slippage: requiredNumber(row, "slippage", context),
        policyHash: requiredHash(row, "policyHash", context),
        configHash: requiredHash(row, "configHash", context),
        resultHash: requiredHash(row, "resultHash", context),
    };
}

function parseBaselineRows(file: CollectedFile): BaselineLedgerEntry[] {
    const rows = rowsFromFile(file);
    if (rows.length === 0) throw new SourceContractError("INVALID_BASELINE_ROW", `${file.path} has no baseline rows`);
    return rows.map((row) => ({
        ...lifecycleEvidence(row, "BASELINE_ROW"),
        tradeId: requiredString(row, "tradeId", "BASELINE_ROW"),
        entry: parseFill(nullableObject(row, "entry", "BASELINE_ROW"), "BASELINE_ROW"),
        finalExit: parseExit(nullableObject(row, "finalExit", "BASELINE_ROW"), "BASELINE_ROW"),
    }));
}

function parseCandidateRows(file: CollectedFile): CandidateDecision[] {
    const rows = rowsFromFile(file);
    if (rows.length === 0) throw new SourceContractError("INVALID_CANDIDATE_ROW", `${file.path} has no candidate rows`);
    return rows.map((row) => {
        const accepted = row.accepted;
        if (typeof accepted !== "boolean") throw new SourceContractError("INVALID_CANDIDATE_ROW", "accepted must be boolean");
        const rejectionReason = row.rejectionReason;
        if (!(typeof rejectionReason === "string" || rejectionReason === null)) throw new SourceContractError("INVALID_CANDIDATE_ROW", "rejectionReason must be string or null");
        return {
            ...lifecycleEvidence(row, "CANDIDATE_ROW"),
            candidateId: requiredString(row, "candidateId", "CANDIDATE_ROW"),
            accepted,
            rejectionReason,
        };
    });
}

function timeframeMs(timeframe: string): number {
    const match = /^(\d+)(m|h|d)$/i.exec(timeframe);
    if (!match) throw new SourceContractError("TIMEFRAME_NOT_SUPPORTED", `unsupported timeframe: ${timeframe}`);
    const multiplier = Number(match[1]);
    const unit = match[2].toLowerCase();
    const unitMs = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    const interval = multiplier * unitMs;
    if (!(multiplier > 0) || !Number.isFinite(multiplier) || !(interval > 0) || !Number.isFinite(interval)) {
        throw new SourceContractError("TIMEFRAME_NOT_SUPPORTED", `timeframe must have a positive finite interval: ${timeframe}`);
    }
    return interval;
}

function validateInput(input: CanonicalSourceInput): void {
    if (!Number.isFinite(input.startTs) || !Number.isFinite(input.endTs) || input.startTs >= input.endTs) throw new SourceContractError("INVALID_TIME_RANGE", "startTs must be before endTs");
    if (!Number.isFinite(input.initialEquity) || input.initialEquity <= 0) throw new SourceContractError("INVALID_INITIAL_EQUITY", "initialEquity must be positive");
    if (!Number.isFinite(input.feeBps) || input.feeBps < 0 || !Number.isFinite(input.slippageBps) || input.slippageBps < 0) throw new SourceContractError("INVALID_COSTS", "feeBps and slippageBps must be non-negative");
    for (const deposit of input.deposits) {
        if (!Number.isFinite(deposit.ts) || !Number.isFinite(deposit.amount) || deposit.amount <= 0) throw new SourceContractError("INVALID_DEPOSIT", "deposits must contain positive finite timestamps and amounts");
    }
}

function sourceSeriesKey(symbol: string, timeframe: string): string {
    return `${symbol}\u0000${timeframe}`;
}

function seriesManifest(series: CandleSeries, input: CanonicalSourceInput): SourceSeriesManifest {
    const bars = [...series.bars].sort((left, right) => left.ts - right.ts);
    const duplicates = [...new Set(bars.filter((bar, index) => index > 0 && bar.ts === bars[index - 1]?.ts).map((bar) => bar.ts))];
    if (duplicates.length > 0) throw new SourceContractError("DUPLICATE_BAR", `${series.symbol}/${series.timeframe} has duplicate timestamp(s): ${duplicates.join(",")}`);
    for (const bar of bars) if (bar.ts < input.startTs || bar.ts > input.endTs) throw new SourceContractError("RANGE_VIOLATION", `${series.symbol}/${series.timeframe} bar ${bar.ts} is outside the requested range`);
    const missing: number[] = [];
    const interval = timeframeMs(series.timeframe);
    for (let index = 1; index < bars.length; index += 1) {
        const previous = bars[index - 1]?.ts;
        const current = bars[index]?.ts;
        if (previous === undefined || current === undefined) continue;
        let timestamp = previous + interval;
        if (timestamp <= previous || !Number.isFinite(timestamp)) throw new SourceContractError("TIMEFRAME_NOT_SUPPORTED", `${series.symbol}/${series.timeframe} interval cannot advance timestamps safely`);
        while (timestamp < current) {
            if (missing.length >= MAX_MISSING_BARS) throw new SourceContractError("GAP_TOO_LARGE", `${series.symbol}/${series.timeframe} gap exceeds the validation limit`);
            missing.push(timestamp);
            const next = timestamp + interval;
            if (next <= timestamp || !Number.isFinite(next)) throw new SourceContractError("TIMEFRAME_NOT_SUPPORTED", `${series.symbol}/${series.timeframe} interval cannot advance timestamps safely`);
            timestamp = next;
        }
    }
    if (missing.length > 0) throw new SourceContractError("GAP_DETECTED", `${series.symbol}/${series.timeframe} has missing timestamp(s): ${missing.join(",")}`);
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

function snapshotIdentity(file: SourceFileSnapshot): SourceHash {
    return { path: file.path, sha256: file.sha256, bytes: file.bytes };
}

function sourceRelativePath(file: SourceFileSnapshot): string {
    return file.path.replace(/^source\//, "");
}

function collectedSnapshot(file: SourceFileSnapshot): CollectedFile {
    const label = file.path.startsWith("source/") ? "source" : file.path.startsWith("data/") ? "data" : null;
    if (label === null) throw new SourceContractError("SOURCE_MATERIAL_MISMATCH", `${file.path} is not rooted under source/ or data/`);
    return { ...file, label, relativePath: file.path.slice(`${label}/`.length) };
}

function canonicalCandleSeries(series: readonly CandleSeries[]): readonly CandleSeries[] {
    return [...series]
        .sort((left, right) => sourceSeriesKey(left.symbol, left.timeframe).localeCompare(sourceSeriesKey(right.symbol, right.timeframe)))
        .map((item) => ({ ...item, bars: [...item.bars].sort((left, right) => left.ts - right.ts) }));
}

function dataCandleSeries(files: readonly SourceFileSnapshot[]): readonly CandleSeries[] {
    const seriesMap = new Map<string, ExecutionBar[]>();
    for (const snapshot of files) {
        const file = collectedSnapshot(snapshot);
        if (file.kind === "funding") continue;
        for (const bar of parseCandleRows(file)) {
            const key = sourceSeriesKey(bar.symbol, bar.timeframe);
            const existing = seriesMap.get(key) ?? [];
            existing.push(bar);
            seriesMap.set(key, existing);
        }
    }
    return [...seriesMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, bars]) => {
        const [symbol, timeframe] = key.split("\u0000");
        return { sourceHash: sha256([...new Set(bars.map((bar) => bar.sourceHash))].sort().join("\n")), symbol: symbol ?? "", timeframe: timeframe ?? "", bars };
    });
}

function deepFreeze<T>(value: T): T {
    if (value === null || (typeof value !== "object" && typeof value !== "function") || Object.isFrozen(value)) return value;
    for (const key of Reflect.ownKeys(value as object)) {
        const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
        if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value);
    }
    return Object.freeze(value);
}

function immutableInput(input: CanonicalSourceInput): CanonicalSourceInput {
    return deepFreeze({
        ...input,
        deposits: input.deposits.map((deposit) => ({ ...deposit })),
    });
}

function validateProductionMaterial(source: CanonicalSource): readonly SourceFileSnapshot[] {
    const allFiles = [...source.sourceFiles].sort((left, right) => left.path.localeCompare(right.path));
    const sourceFiles = allFiles.filter((file) => file.path.startsWith("source/"));
    if (sourceFiles.length === 0 || source.productionFiles.length !== sourceFiles.length) throw new SourceContractError("SOURCE_MATERIAL_MISMATCH", "canonical production file set is incomplete");
    for (const file of allFiles) {
        if (sha256(file.content) !== file.sha256 || Buffer.byteLength(file.content, "utf8") !== file.bytes) throw new SourceContractError("SOURCE_MATERIAL_MISMATCH", `${file.path} content/hash/size changed`);
    }
    if (stableJson(sourceFiles.map(snapshotIdentity)) !== stableJson([...source.productionFiles].sort((left, right) => left.path.localeCompare(right.path)).map(snapshotIdentity))) throw new SourceContractError("SOURCE_MATERIAL_MISMATCH", "production file set changed");
    const productionSha = canonicalDirectorySha(sourceFiles.map((file) => ({ path: sourceRelativePath(file), content: file.content })));
    if (productionSha !== source.productionSha || productionSha !== source.input.productionSha) throw new SourceContractError("PRODUCTION_SHA_MISMATCH", `expected ${source.input.productionSha}, received ${productionSha}`);
    const productionSources = sourceFiles.filter((file) => file.kind === "production");
    if (source.productionSources.length !== productionSources.length) throw new SourceContractError("SOURCE_MATERIAL_MISMATCH", "production source material changed");
    for (const production of source.productionSources) {
        const file = productionSources.find((candidate) => candidate.path === `source/${production.path}`);
        if (file === undefined || file.sha256 !== production.sha256) throw new SourceContractError("SOURCE_MATERIAL_MISMATCH", `production source ${production.path} changed`);
    }
    return sourceFiles;
}

function validateDataMaterial(source: CanonicalSource): void {
    const dataFiles = source.sourceFiles.filter((file) => file.path.startsWith("data/"));
    const expectedSeries = dataCandleSeries(dataFiles);
    if (expectedSeries.length === 0) throw new SourceContractError("CANDLE_SOURCE_MISSING", "no candle series was found under dataRoot");
    if (stableJson(canonicalCandleSeries(source.candleSeries)) !== stableJson(canonicalCandleSeries(expectedSeries))) {
        throw new SourceContractError("SOURCE_MATERIAL_MISMATCH", "canonical candle series does not match immutable data snapshots");
    }
}

export async function buildSourceManifest(source: CanonicalSource): Promise<SourceManifest> {
    validateInput(source.input);
    validateProductionMaterial(source);
    validateDataMaterial(source);
    const allFiles = [...source.sourceFiles].sort((left, right) => left.path.localeCompare(right.path));
    const sourceHashes = allFiles.map(snapshotIdentity);
    const dataHashes = sourceHashes.filter((item) => item.path.startsWith("data/"));
    const series = [...source.candleSeries]
        .sort((left, right) => sourceSeriesKey(left.symbol, left.timeframe).localeCompare(sourceSeriesKey(right.symbol, right.timeframe)))
        .map((item) => seriesManifest(item, source.input));
    if (new Set(series.map((item) => sourceSeriesKey(item.symbol, item.timeframe))).size !== series.length) throw new SourceContractError("DUPLICATE_SERIES", "manifest contains more than one symbol/timeframe series");
    return deepFreeze({
        manifestVersion: 1,
        sourceSha: sha256(sourceHashes.map((item) => `${item.path}\n${item.sha256}\n${item.bytes}`).join("\n")),
        productionSha: source.input.productionSha,
        dataSha: sha256(dataHashes.map((item) => `${item.path}\n${item.sha256}\n${item.bytes}`).join("\n")),
        sourceHashes,
        series,
        startTs: source.input.startTs,
        endTs: source.input.endTs,
        initialEquity: source.input.initialEquity,
        deposits: [...source.input.deposits].sort((left, right) => left.ts - right.ts),
        feeBps: source.input.feeBps,
        slippageBps: source.input.slippageBps,
        fundingSource: source.input.fundingSource,
    });
}

export function assertSourceManifest(manifest: SourceManifest, expected: ExpectedSourceManifest): void {
    const fields: readonly (keyof ExpectedSourceManifest)[] = ["manifestVersion", "sourceSha", "productionSha", "dataSha", "startTs", "endTs", "initialEquity", "deposits", "feeBps", "slippageBps", "fundingSource"];
    for (const field of fields) {
        const expectedValue = expected[field];
        if (expectedValue !== undefined && stableJson(manifest[field] as StableValue) !== stableJson(expectedValue as StableValue)) throw new SourceContractError("MANIFEST_MISMATCH", `${String(field)} does not match expected manifest`);
    }
    if (expected.sourceHashes !== undefined && stableJson(manifest.sourceHashes) !== stableJson(expected.sourceHashes)) throw new SourceContractError("MANIFEST_MISMATCH", "sourceHashes do not match expected manifest");
    if (expected.series !== undefined) {
        if (manifest.series.length !== expected.series.length) throw new SourceContractError("MANIFEST_MISMATCH", "series count does not match expected manifest");
        for (const [index, expectedSeries] of expected.series.entries()) {
            const actual = manifest.series.find((item) => (expectedSeries.symbol === undefined || item.symbol === expectedSeries.symbol) && (expectedSeries.timeframe === undefined || item.timeframe === expectedSeries.timeframe)) ?? manifest.series[index];
            if (actual === undefined) throw new SourceContractError("MANIFEST_MISMATCH", "expected series is missing");
            for (const field of ["symbol", "timeframe", "firstTs", "lastTs", "rowCount", "missing", "duplicates", "sha256"] as const) {
                const expectedValue = expectedSeries[field];
                if (expectedValue !== undefined && stableJson(actual[field] as StableValue) !== stableJson(expectedValue as StableValue)) throw new SourceContractError("MANIFEST_MISMATCH", `series ${actual.symbol}/${actual.timeframe} ${field} does not match`);
            }
        }
    }
}

export async function loadCanonicalSource(input: CanonicalSourceInput): Promise<CanonicalSource> {
    validateInput(input);
    const inputSnapshot = immutableInput(input);
    const collectedSourceFiles = await collectFiles(input.sourceRoot, "source");
    const collectedDataFiles = await collectFiles(input.dataRoot, "data");
    const productionSha = canonicalDirectorySha(collectedSourceFiles.map((file) => ({ path: file.relativePath, content: file.content })));
    if (productionSha !== input.productionSha) throw new SourceContractError("PRODUCTION_SHA_MISMATCH", `expected ${input.productionSha}, received ${productionSha}`);

    const productionFiles = collectedSourceFiles.filter((file) => file.kind === "production");
    if (productionFiles.length === 0) throw new SourceContractError("PRODUCTION_SOURCE_MISSING", "no production strategy/config source was found under sourceRoot");
    const productionSources: ProductionSource[] = productionFiles.map(parseProductionSource);
    const strategyConfigs: StrategyConfigSource[] = productionSources.flatMap((source) => {
        const object = asObject(source.content);
        if (object === null) throw new SourceContractError("INVALID_PRODUCTION_SOURCE", `${source.path} must contain a production object`);
        const config = asObject(object.config);
        if (config === null || Object.keys(config).length === 0) throw new SourceContractError("INVALID_PRODUCTION_SOURCE", `${source.path}.config must be a non-empty object`);
        return [{ sourceHash: source.sha256, strategy: requiredStrategy(object, "strategy", "PRODUCTION_SOURCE"), configHash: sha256(stableJson(config)), config }];
    });
    if (strategyConfigs.length !== productionSources.length || strategyConfigs.length === 0) throw new SourceContractError("PRODUCTION_SOURCE_MISSING", "expected a non-empty strategy/config source set");

    const seriesMap = new Map<string, ExecutionBar[]>();
    const funding: FundingRecord[] = collectedSourceFiles.filter((file) => file.kind === "funding").flatMap(parseFundingRows);
    for (const file of collectedDataFiles) {
        if (file.kind === "funding") {
            funding.push(...parseFundingRows(file));
            continue;
        }
        for (const bar of parseCandleRows(file)) {
            const key = sourceSeriesKey(bar.symbol, bar.timeframe);
            const existing = seriesMap.get(key) ?? [];
            existing.push(bar);
            seriesMap.set(key, existing);
        }
    }
    const candleSeries: CandleSeries[] = [...seriesMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, bars]) => {
        const [symbol, timeframe] = key.split("\u0000");
        return { sourceHash: sha256([...new Set(bars.map((bar) => bar.sourceHash))].sort().join("\n")), symbol: symbol ?? "", timeframe: timeframe ?? "", bars };
    });
    if (candleSeries.length === 0) throw new SourceContractError("CANDLE_SOURCE_MISSING", "no candle series was found under dataRoot");

    const baselineLedger = collectedSourceFiles.filter((file) => file.kind === "baseline").flatMap(parseBaselineRows);
    const candidateEvents = collectedSourceFiles.filter((file) => file.kind === "candidate").flatMap(parseCandidateRows);
    const sourceFiles = Object.freeze(collectedSourceFiles.map((file) => Object.freeze({ ...file })));
    const dataFiles = collectedDataFiles.map((file) => Object.freeze({ ...file }));
    const allFiles = Object.freeze([...sourceFiles, ...dataFiles]);
    const sourceHashes = Object.freeze(allFiles.map(snapshotIdentity).sort((left, right) => left.path.localeCompare(right.path)));
    const source: CanonicalSource = {
        input: inputSnapshot,
        productionSha,
        productionFiles: sourceFiles,
        sourceFiles: allFiles,
        productionSources,
        strategyConfigs,
        candleSeries,
        funding,
        baselineLedger,
        candidateEvents,
        sourceHashes,
    };
    const manifest = await buildSourceManifest(source);
    return deepFreeze({ ...source, manifest });
}
