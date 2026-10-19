import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const execFile = promisify(execFileCallback);

export const LEGACY_CLASSIFICATION = "LEGACY_NON_CANONICAL_RECONSTRUCTION" as const;
export const LEGACY_PROTECTION_STATUS = "PROTECTION_FIELDS_UNRESOLVED" as const;

export type LegacyStrategyMappingStatus =
    | "MAPPED_NON_CANONICAL"
    | "UNREPRESENTED_CURRENT_STRATEGY"
    | "UNKNOWN_LEGACY_STRATEGY";

const CURRENT_STRATEGY_MAP: Readonly<Record<string, string>> = {
    V12: "V12_V4",
    PENGU: "PENGU",
    Q102: "Q102",
    FET: "FET",
    HYPE_LONG: "HYPE",
    IDLE: "IDLE",
    V52: "V52",
};

const CURRENT_STRATEGIES = new Set(Object.values(CURRENT_STRATEGY_MAP));
const LEGACY_PERIOD_START = 1_754_784_000_000;
const LEGACY_PERIOD_END = 1_786_320_000_000;
const HOUR_MS = 3_600_000;
const COMPLETE_CRYPTO_SYMBOLS = [
    "AAVEUSDT", "ADAUSDT", "APTUSDT", "ARBUSDT", "ATOMUSDT", "AVAXUSDT", "BNBUSDT", "BTCUSDT", "DOGEUSDT", "DOTUSDT",
    "ENAUSDT", "ETHUSDT", "FETUSDT", "HYPEUSDT", "INJUSDT", "JUPUSDT", "LINKUSDT", "LTCUSDT", "NEARUSDT", "ONDOUSDT",
    "OPUSDT", "PENGUUSDT", "RENDERUSDT", "SEIUSDT", "SOLUSDT", "SUIUSDT", "TAOUSDT", "TIAUSDT", "UNIUSDT", "XRPUSDT",
] as const;

type JsonRecord = Record<string, unknown>;

function sha256(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
    if (typeof value === "object" && value !== null) {
        const record = value as JsonRecord;
        return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function hashJson(value: unknown): string {
    return sha256(stableJson(value));
}

function finiteNumber(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonEmptyString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

export function mapLegacyStrategy(strategy: string): { readonly current: string | null; readonly status: LegacyStrategyMappingStatus } {
    const current = CURRENT_STRATEGY_MAP[strategy];
    if (current !== undefined && CURRENT_STRATEGIES.has(current)) return { current, status: "MAPPED_NON_CANONICAL" };
    if (strategy === "RESIDUAL") return { current: null, status: "UNREPRESENTED_CURRENT_STRATEGY" };
    return { current: null, status: "UNKNOWN_LEGACY_STRATEGY" };
}

export interface LegacyProtectionEvidence {
    readonly status: typeof LEGACY_PROTECTION_STATUS;
    readonly unresolvedFields: readonly string[];
    readonly knownLegacyFields: Readonly<Record<string, number>>;
    readonly mappingNotes: readonly string[];
}

export function normalizeLegacyProtectionEvidence(input: {
    readonly oldV12Hybrid: Readonly<Record<string, number>>;
    readonly currentFields: Readonly<Record<string, unknown>>;
}): LegacyProtectionEvidence {
    const unresolvedFields = ["initialStopBps", "profitFloorBps", "trailingGivebackBps", "timeStopBars"]
        .filter((field) => typeof input.currentFields[field] !== "number" && input.currentFields[field] !== null);
    return {
        status: LEGACY_PROTECTION_STATUS,
        unresolvedFields,
        knownLegacyFields: { ...input.oldV12Hybrid },
        mappingNotes: [
            "The legacy V12 hybrid exit used an H1 reversal/BTC filter in addition to the arm/giveback values.",
            "The legacy arm threshold is not the current fixed profit-floor field, so it is not substituted.",
            "The legacy run did not persist a complete current-engine initial-stop/floor/trail/time-stop tuple.",
        ],
    };
}

export interface LegacyMappingReport {
    readonly classification: typeof LEGACY_CLASSIFICATION;
    readonly sourceRuntimeSha: string;
    readonly scenarioId: string;
    readonly modelStatus: string;
    readonly strategyMappings: Readonly<Record<string, { readonly current: string | null; readonly status: LegacyStrategyMappingStatus }>>;
    readonly protection: LegacyProtectionEvidence;
}

export function buildLegacyMappingReport(input: {
    readonly strategyIds: readonly string[];
    readonly sourceRuntimeSha: string;
    readonly scenarioId: string;
    readonly modelStatus: string;
}): LegacyMappingReport {
    const strategyMappings: Record<string, { current: string | null; status: LegacyStrategyMappingStatus }> = {};
    for (const strategy of [...new Set(input.strategyIds)].sort()) strategyMappings[strategy] = mapLegacyStrategy(strategy);
    return {
        classification: LEGACY_CLASSIFICATION,
        sourceRuntimeSha: input.sourceRuntimeSha,
        scenarioId: input.scenarioId,
        modelStatus: input.modelStatus,
        strategyMappings,
        protection: normalizeLegacyProtectionEvidence({
            oldV12Hybrid: { profitArmBps: 250, givebackBps: 150, reversalThresholdBps: 200, btcOppositeThresholdBps: 100 },
            currentFields: {},
        }),
    };
}

interface FileSnapshot {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
}

async function snapshot(path: string): Promise<FileSnapshot> {
    const content = await readFile(path);
    return { path: resolve(path), bytes: content.byteLength, sha256: sha256(content) };
}

async function readJson(path: string): Promise<JsonRecord> {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`expected JSON object: ${path}`);
    return parsed as JsonRecord;
}

async function readJsonl(path: string): Promise<JsonRecord[]> {
    const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line, index) => {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`expected object at ${path}:${index + 1}`);
        return parsed as JsonRecord;
    });
}

function strategyId(row: JsonRecord): string {
    return nonEmptyString(row.strategy_id ?? row.strategyId, "UNKNOWN");
}

function side(row: JsonRecord): "LONG" | "SHORT" {
    return row.side === "SHORT" ? "SHORT" : "LONG";
}

function oldTs(row: JsonRecord, key: string, fallback: string): number {
    return finiteNumber(row[key], finiteNumber(row[fallback], 0));
}

function lifecycleFields(row: JsonRecord, sourceHash: string, configHash: string, resultHash: string, accepted: boolean): JsonRecord {
    const strategy = mapLegacyStrategy(strategyId(row)).current;
    if (strategy === null) throw new Error(`unsupported legacy strategy cannot be normalized: ${strategyId(row)}`);
    const requestedGross = finiteNumber(row.candidate_requested_gross, finiteNumber(row.requested_gross, finiteNumber(row.accepted_gross)));
    const acceptedGross = accepted ? finiteNumber(row.accepted_gross, requestedGross) : 0;
    const entryTs = oldTs(row, "entry_ts_ms", "signal_ts_ms");
    const exitTs = oldTs(row, "exit_ts_ms", "candidate_exit_ts_ms");
    const entryPrice = finiteNumber(row.entry_price, finiteNumber(row.modeled_entry_price_usd));
    const exitPrice = finiteNumber(row.exit_price, finiteNumber(row.candidate_exit_price_usd, entryPrice));
    const quantity = finiteNumber(row.quantity, finiteNumber(row.original_quantity, finiteNumber(row.modeled_entry_quantity)));
    const entryFee = finiteNumber(row.entry_fee, finiteNumber(row.modeled_entry_fee_settlement));
    const exitFee = finiteNumber(row.exit_fee);
    const funding = 0;
    const fill = accepted ? {
        sourceHash, ts: entryTs, price: entryPrice, quantity, gross: acceptedGross, fee: entryFee, funding, slippage: 0,
        reason: "LEGACY_MODELED_ENTRY",
    } : null;
    const exit = accepted && exitTs > 0 ? {
        sourceHash, ts: exitTs, price: exitPrice, quantity, gross: acceptedGross, fee: exitFee, funding, slippage: 0,
        realizedPnl: finiteNumber(row.total_pnl_jpy), reason: nonEmptyString(row.exit_reason_actual ?? row.candidate_exit_reason, "LEGACY_MODELED_EXIT"),
    } : null;
    return {
        sourceHash, ts: entryTs, strategy, direction: side(row), symbol: nonEmptyString(row.symbol, "UNKNOWN"), requestedGross, acceptedGross,
        reservation: accepted ? { sourceHash, ts: entryTs, requestedGross, acceptedGross, reservedGross: acceptedGross, reason: "LEGACY_MODELED_RESERVATION" } : null,
        fill, exit, reason: accepted ? "LEGACY_MODELED_ENTRY" : nonEmptyString(row.reason, "LEGACY_REJECTED"), fee: entryFee + exitFee, funding,
        slippage: 0, policyHash: hashJson({ legacy: true, policy: "UNRESOLVED", strategy }), configHash, resultHash,
    };
}

function legacyBaselineRow(row: JsonRecord, sourceHash: string, configHash: string): JsonRecord {
    const resultHash = hashJson(row);
    return {
        ...lifecycleFields(row, sourceHash, configHash, resultHash, true),
        tradeId: nonEmptyString(row.position_id ?? row.candidate_id, resultHash),
        entry: lifecycleFields(row, sourceHash, configHash, resultHash, true).fill,
        finalExit: lifecycleFields(row, sourceHash, configHash, resultHash, true).exit,
    };
}

function legacyCandidateRow(row: JsonRecord, sourceHash: string, configHash: string): JsonRecord {
    const accepted = row.decision === "ACCEPTED_MODELED_ENTRY" || row.upstream_status === "MODELED_CLOSED_TRADE";
    const resultHash = hashJson(row);
    return {
        ...lifecycleFields(row, sourceHash, configHash, resultHash, accepted),
        candidateId: nonEmptyString(row.candidate_id, resultHash),
        accepted,
        rejectionReason: accepted ? null : nonEmptyString(row.reason, "LEGACY_REJECTED"),
    };
}

function canonicalDirectorySha(files: readonly { path: string; content: string }[]): string {
    return sha256([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.path}\n${file.content}`).join("\n"));
}

function parseFiveMinuteCsv(content: string, startTs: number, endTs: number): Map<number, { open: number; high: number; low: number; close: number; volume: number }> {
    const bars = new Map<number, { open: number; high: number; low: number; close: number; volume: number }>();
    for (const line of content.split(/\r?\n/)) {
        if (line.trim().length === 0) continue;
        const cells = line.split(",");
        const ts = Number(cells[0]);
        if (!Number.isFinite(ts) || ts < startTs || ts >= endTs) continue;
        const open = Number(cells[1]);
        const high = Number(cells[2]);
        const low = Number(cells[3]);
        const close = Number(cells[4]);
        const volume = Number(cells[5]);
        if (![open, high, low, close, volume].every(Number.isFinite)) throw new Error(`invalid Binance Vision 5m row at ${ts}`);
        const hour = Math.floor(ts / HOUR_MS) * HOUR_MS;
        const current = bars.get(hour);
        if (current === undefined) bars.set(hour, { open, high, low, close, volume });
        else {
            current.high = Math.max(current.high, high);
            current.low = Math.min(current.low, low);
            current.close = close;
            current.volume += volume;
        }
    }
    return bars;
}

async function aggregateSymbol(symbol: string, cacheRoot: string, startTs: number, endTs: number): Promise<{ rows: JsonRecord[]; files: FileSnapshot[] }> {
    const directory = join(cacheRoot, symbol);
    const entries = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith(".zip")).sort();
    if (entries.length !== 13) throw new Error(`legacy Binance cache is incomplete for ${symbol}: ${entries.length} monthly files`);
    const aggregate = new Map<number, { open: number; high: number; low: number; close: number; volume: number }>();
    const files: FileSnapshot[] = [];
    for (const entry of entries) {
        const zipPath = join(directory, entry);
        files.push(await snapshot(zipPath));
        const extracted = await execFile("tar.exe", ["-xOf", zipPath], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
        for (const [ts, bar] of parseFiveMinuteCsv(extracted.stdout, startTs, endTs)) {
            const current = aggregate.get(ts);
            if (current === undefined) aggregate.set(ts, bar);
            else throw new Error(`duplicate legacy hourly bar for ${symbol} at ${ts}`);
        }
    }
    const rows: JsonRecord[] = [...aggregate.entries()].sort(([left], [right]) => left - right).map(([ts, bar]) => ({ ts, symbol, timeframe: "1h", ...bar }));
    const expectedCount = (endTs - startTs) / HOUR_MS;
    if (rows.length !== expectedCount || rows[0]?.ts !== startTs || rows.at(-1)?.ts !== endTs - HOUR_MS) {
        throw new Error(`legacy hourly coverage is incomplete for ${symbol}: rows=${rows.length}, expected=${expectedCount}`);
    }
    return { rows, files };
}

export interface LegacyAdapterArgs {
    readonly legacyRunRoot: string;
    readonly legacyThirtyBpsRunRoot?: string;
    readonly bt120RunRoot?: string;
    readonly bt120ThirtyBpsRunRoot?: string;
    readonly btCacheRoot: string;
    readonly outputRoot: string;
    readonly startTs?: number;
    readonly endTs?: number;
}

export async function reconstructLegacy(args: LegacyAdapterArgs): Promise<JsonRecord> {
    const legacyRunRoot = resolve(args.legacyRunRoot);
    const outputRoot = resolve(args.outputRoot);
    const startTs = args.startTs ?? LEGACY_PERIOD_START;
    const endTs = args.endTs ?? LEGACY_PERIOD_END;
    const sourceRoot = join(outputRoot, "input", "source");
    const dataRoot = join(outputRoot, "input", "data");
    const reportRoot = join(outputRoot, "reports");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    await mkdir(reportRoot, { recursive: true });

    const tradesPath = join(legacyRunRoot, "portfolio-trades.jsonl");
    const decisionsPath = join(legacyRunRoot, "candidate-decisions.jsonl");
    const metricsPath = join(legacyRunRoot, "metrics.json");
    const trades = await readJsonl(tradesPath);
    const decisions = await readJsonl(decisionsPath);
    const metrics = await readJson(metricsPath);
    const tradeSnapshot = await snapshot(tradesPath);
    const decisionSnapshot = await snapshot(decisionsPath);
    const metricsSnapshot = await snapshot(metricsPath);
    const runtimeSha = nonEmptyString(metrics.runtime_sha, "legacy-runtime-sha-unrecorded");
    const scenarioId = nonEmptyString(metrics.scenario_id, "PRICE_MODEL_10BPS");
    const modelStatus = nonEmptyString(metrics.status, "LEGACY_STATUS_UNRECORDED");
    const strategyIds = [...new Set([...trades, ...decisions].map(strategyId))].sort();
    const mapping = buildLegacyMappingReport({ strategyIds, sourceRuntimeSha: runtimeSha, scenarioId, modelStatus });
    const configHash = hashJson({ classification: LEGACY_CLASSIFICATION, sourceRuntimeSha: runtimeSha, scenarioId });

    const production = {
        strategy: "V12_V4",
        classification: LEGACY_CLASSIFICATION,
        config: {
            direction: "LONG",
            supportedDirections: ["LONG", "SHORT"],
            grossCap: 1,
            sharedRiskCap: 1,
            totalGrossCap: 1,
            cryptoGrossCap: 1,
            strategyGrossCap: 1,
            perStrategyGrossCaps: { V12_V4: 1 },
            entryPolicy: "LEGACY_MODELED_CANDIDATE_ENTRY",
            sizingPolicy: "CANDIDATE_RUNTIME_RISK_SIZE",
            marginGuard: "LEGACY_NON_CANONICAL_M150_D05_CORE_NATIVE",
            leverage: 5,
            legacyPolicy: "all_hybrid",
            legacyCostBps: finiteNumber(metrics.round_trip_cost_bps, 10),
            legacyProtectionFields: mapping.protection.knownLegacyFields,
        },
    } satisfies JsonRecord;
    const productionContent = `${JSON.stringify(production, null, 2)}\n`;
    await writeFile(join(sourceRoot, "legacy-production.json"), productionContent, "utf8");
    const baselineRows = trades.filter((row) => strategyId(row) === "V12").map((row) => legacyBaselineRow(row, tradeSnapshot.sha256, configHash));
    const candidateRows = decisions.filter((row) => mapLegacyStrategy(strategyId(row)).current !== null).map((row) => legacyCandidateRow(row, decisionSnapshot.sha256, configHash));
    await writeFile(join(sourceRoot, "legacy-baseline-ledger.jsonl"), `${baselineRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    await writeFile(join(sourceRoot, "legacy-candidate-events.jsonl"), `${candidateRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

    const dataFiles: FileSnapshot[] = [];
    const series: JsonRecord[] = [];
    for (const symbol of COMPLETE_CRYPTO_SYMBOLS) {
        const aggregated = await aggregateSymbol(symbol, resolve(args.btCacheRoot), startTs, endTs);
        const target = join(dataRoot, `${symbol}_1h.json`);
        const content = `${JSON.stringify(aggregated.rows)}\n`;
        await writeFile(target, content, "utf8");
        const targetSnapshot = await snapshot(target);
        dataFiles.push(...aggregated.files);
        series.push({ symbol, timeframe: "1h", firstTs: startTs, lastTs: endTs - HOUR_MS, rowCount: aggregated.rows.length, sha256: hashJson(aggregated.rows), materialSha256: targetSnapshot.sha256, materialBytes: targetSnapshot.bytes });
    }

    const sourceFiles = [
        { path: "legacy-baseline-ledger.jsonl", content: `${baselineRows.map((row) => JSON.stringify(row)).join("\n")}\n` },
        { path: "legacy-candidate-events.jsonl", content: `${candidateRows.map((row) => JSON.stringify(row)).join("\n")}\n` },
        { path: "legacy-production.json", content: productionContent },
    ];
    const productionSha = canonicalDirectorySha(sourceFiles);
    const sourceManifest = {
        classification: LEGACY_CLASSIFICATION,
        sourceRoot,
        dataRoot,
        productionSha,
        startTs,
        endTs,
        initialEquity: finiteNumber(metrics.initial_jpy, 10_000),
        deposits: [{ ts: startTs, amount: finiteNumber(metrics.contributed_jpy, 10_000) }],
        feeBps: finiteNumber(metrics.round_trip_cost_bps, 10),
        slippageBps: 0,
        fundingSource: "LEGACY_PUBLIC_BINANCE_VISION_PRICE_ONLY_NO_FUNDING_REPLAY",
        legacyArtifacts: [tradeSnapshot, decisionSnapshot, metricsSnapshot],
        legacyRuntimeSha: runtimeSha,
        series,
        cacheFiles: dataFiles,
        generatedAt: new Date().toISOString(),
    };
    await writeFile(join(reportRoot, "legacy-source-manifest.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`, "utf8");
    await writeFile(join(reportRoot, "legacy-mapping-report.json"), `${JSON.stringify({ ...mapping, oldRunRoot: legacyRunRoot, oldStrategyIds: strategyIds, sourceArtifactCounts: { trades: trades.length, candidateDecisions: decisions.length, v12BaselineRows: baselineRows.length, supportedCandidateRows: candidateRows.length } }, null, 2)}\n`, "utf8");

    const comparison: JsonRecord = { classification: LEGACY_CLASSIFICATION, source: { scenarioId, costBps: metrics.round_trip_cost_bps, finalEquityJpy: metrics.final_equity_jpy, maxMtmDrawdown: metrics.maximum_mtm_drawdown, closedTrades: metrics.closed_trades, profitFactor: metrics.profit_factor, winRate: metrics.win_rate } };
    if (args.legacyThirtyBpsRunRoot !== undefined) {
        const m30 = await readJson(join(resolve(args.legacyThirtyBpsRunRoot), "metrics.json"));
        comparison.thirtyBps = { scenarioId: m30.scenario_id, costBps: m30.round_trip_cost_bps, finalEquityJpy: m30.final_equity_jpy, maxMtmDrawdown: m30.maximum_mtm_drawdown, closedTrades: m30.closed_trades, profitFactor: m30.profit_factor, winRate: m30.win_rate };
    }
    await writeFile(join(reportRoot, "legacy-cost-comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
    if (args.bt120RunRoot !== undefined) {
        const bt120MetricsPath = join(resolve(args.bt120RunRoot), "metrics.json");
        const bt120Metrics = await readJson(bt120MetricsPath);
        const bt120Comparison: JsonRecord = {
            classification: LEGACY_CLASSIFICATION,
            comparisonType: "LEGACY_INTEGRATED_H1_VS_SAVED_BT120_5M_REPLAY_ARTIFACT",
            legacy: { runRoot: legacyRunRoot, scenarioId, costBps: metrics.round_trip_cost_bps, finalEquityJpy: metrics.final_equity_jpy, maxMtmDrawdown: metrics.maximum_mtm_drawdown, closedTrades: metrics.closed_trades, profitFactor: metrics.profit_factor, winRate: metrics.win_rate },
            bt120: { runRoot: resolve(args.bt120RunRoot), scenarioId: bt120Metrics.scenario_id, costBps: bt120Metrics.round_trip_cost_bps, finalEquityJpy: bt120Metrics.final_equity_jpy, maxMtmDrawdown: bt120Metrics.maximum_mtm_drawdown, closedTrades: bt120Metrics.closed_trades, profitFactor: bt120Metrics.profit_factor, winRate: bt120Metrics.win_rate, metricsSnapshot: await snapshot(bt120MetricsPath) },
            caveats: [
                "Both records are saved research artifacts, not current-equivalent or LIVE evidence.",
                "The legacy integrated artifact is the all_hybrid H1 price model; the BT120 artifact is a separate saved 5-minute full-eight replay lineage.",
                "Differences must not be interpreted as a strategy-performance attribution or canonical parity result.",
            ],
        };
        if (args.bt120ThirtyBpsRunRoot !== undefined) {
            const bt120ThirtyBpsMetricsPath = join(resolve(args.bt120ThirtyBpsRunRoot), "metrics.json");
            const bt120ThirtyBpsMetrics = await readJson(bt120ThirtyBpsMetricsPath);
            bt120Comparison.bt120ThirtyBps = { runRoot: resolve(args.bt120ThirtyBpsRunRoot), scenarioId: bt120ThirtyBpsMetrics.scenario_id, costBps: bt120ThirtyBpsMetrics.round_trip_cost_bps, finalEquityJpy: bt120ThirtyBpsMetrics.final_equity_jpy, maxMtmDrawdown: bt120ThirtyBpsMetrics.maximum_mtm_drawdown, closedTrades: bt120ThirtyBpsMetrics.closed_trades, profitFactor: bt120ThirtyBpsMetrics.profit_factor, winRate: bt120ThirtyBpsMetrics.win_rate, metricsSnapshot: await snapshot(bt120ThirtyBpsMetricsPath) };
        }
        await writeFile(join(reportRoot, "bt120-correspondence.json"), `${JSON.stringify(bt120Comparison, null, 2)}\n`, "utf8");
    }
    await writeFile(join(outputRoot, "README.md"), [
        "# Legacy reconstruction input",
        "",
        `Classification: **${LEGACY_CLASSIFICATION}**`,
        "",
        "This directory is an isolated reconstruction from saved research artifacts. It is not canonical production source, not a current-equivalent replay, and not LIVE evidence.",
        "",
        "Market data is the saved public Binance Vision USD-M 5-minute cache, aggregated to 1-hour bars without mixing in the later Aster public reconstruction. The adapter preserves the old integrated portfolio and candidate evidence only where the current schema can represent it.",
        "",
        "The current protection contract is intentionally unresolved. The legacy V12 hybrid values are recorded in `reports/legacy-mapping-report.json`; no values are substituted into the current runner.",
        "",
        "Run `dd:reduction:source` against `reports/legacy-source-manifest.json` and run the baseline only as a fail-closed diagnostic. A protection-field error is expected and must not be treated as a successful replay.",
        "",
    ].join("\n"), "utf8");
    await writeFile(join(outputRoot, "STATUS.md"), [
        "# Status",
        "",
        "`LEGACY_NON_CANONICAL_RECONSTRUCTION`",
        "",
        "Expected current-engine outcome: `SOURCE_ERROR` / `PROTECTION_FIELDS_UNRESOLVED` before replay, because the saved legacy run does not provide the exact current initial-stop, profit-floor, trailing-giveback, and time-stop tuple.",
        "",
        "No candidate search, canonical parity claim, LIVE/VPS read, or production change is authorized by this artifact.",
        "",
    ].join("\n"), "utf8");

    return { classification: LEGACY_CLASSIFICATION, outputRoot, sourceRoot, dataRoot, productionSha, baselineRows: baselineRows.length, candidateRows: candidateRows.length, series: series.length, protectionStatus: LEGACY_PROTECTION_STATUS };
}

function requiredFlag(args: readonly string[], name: string): string {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (value === undefined || value.startsWith("--")) throw new Error(`missing required flag ${name}`);
    return value;
}

function optionalFlag(args: readonly string[], name: string): string | undefined {
    const index = args.indexOf(name);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (index >= 0 && (value === undefined || value.startsWith("--"))) throw new Error(`${name} requires a value`);
    return value;
}

export function parseLegacyAdapterArgs(args: readonly string[] = process.argv.slice(2)): LegacyAdapterArgs {
    const numberValue = (name: string, fallback: number): number => {
        const value = optionalFlag(args, name);
        if (value === undefined) return fallback;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new Error(`${name} must be finite`);
        return parsed;
    };
    return {
        legacyRunRoot: requiredFlag(args, "--legacy-run-root"),
        legacyThirtyBpsRunRoot: optionalFlag(args, "--legacy-30bps-run-root"),
        bt120RunRoot: optionalFlag(args, "--bt120-run-root"),
        bt120ThirtyBpsRunRoot: optionalFlag(args, "--bt120-30bps-run-root"),
        btCacheRoot: requiredFlag(args, "--bt-cache-root"),
        outputRoot: requiredFlag(args, "--output-root"),
        startTs: numberValue("--start-ts", LEGACY_PERIOD_START),
        endTs: numberValue("--end-ts", LEGACY_PERIOD_END),
    };
}

if (process.argv[1]?.endsWith("legacy-adapter.ts") === true) {
    reconstructLegacy(parseLegacyAdapterArgs()).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : "legacy reconstruction failed"}\n`);
        process.exitCode = 1;
    });
}
