import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

type Row = Record<string, unknown>;

const HOUR_MS = 3_600_000;
const STRATEGY_MS = 2 * HOUR_MS;
const ATR_LOOKBACK = 31;

function requiredString(args: readonly string[], flag: string): string {
    const index = args.indexOf(flag);
    const value = index >= 0 ? args[index + 1] : undefined;
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return resolve(value);
}

function sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalDirectorySha(files: readonly { path: string; content: string }[]): string {
    return sha256([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.path}\n${file.content}`).join("\n"));
}

function trueRange(row: Row, previousClose: number | undefined): number {
    const high = Number(row.high);
    const low = Number(row.low);
    if (!Number.isFinite(high) || !Number.isFinite(low)) throw new Error("diagnostic candle has invalid high/low");
    if (previousClose === undefined) return high - low;
    return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
}

function enrich(symbol: string, input: readonly Row[]): Row[] {
    const rows = [...input].sort((left, right) => Number(left.ts) - Number(right.ts));
    const trs: number[] = [];
    let previousClose: number | undefined;
    return rows.map((row, index) => {
        const ts = Number(row.ts);
        const close = Number(row.close);
        if (!Number.isFinite(ts) || !Number.isFinite(close)) throw new Error(`${symbol} has invalid ts/close`);
        const tr = trueRange(row, previousClose);
        trs.push(tr);
        previousClose = close;
        const complete = index >= ATR_LOOKBACK;
        const atr = complete
            ? trs.slice(index - ATR_LOOKBACK, index).reduce((sum, value) => sum + value, 0) / ATR_LOOKBACK
            : 0;
        const strategyBarIndex = Math.floor((ts - Number(rows[0]?.ts ?? ts)) / STRATEGY_MS);
        const strategyBarStart = Number(rows[0]?.ts ?? ts) + strategyBarIndex * STRATEGY_MS;
        return {
            ...row,
            symbol,
            timeframe: "1h",
            inputTimeframe: "1h",
            strategyTimeframe: "2h",
            strategyBarKey: `${symbol}:${strategyBarStart}`,
            strategyBarIndex,
            inputBarIndex: index,
            atr,
            atrLookbackBars: ATR_LOOKBACK,
            atrSourceTimeframe: "1h",
            atrComputedThroughTs: ts - HOUR_MS,
            atrHistoryComplete: complete,
            // Public H1 OHLC does not establish the order of stop/take-profit touches.
            sameBarOrderKnown: false,
        };
    });
}

async function readRows(path: string): Promise<Row[]> {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`expected array: ${path}`);
    return parsed.filter((row): row is Row => typeof row === "object" && row !== null && !Array.isArray(row));
}

async function copyJsonFiles(inputRoot: string, outputRoot: string, sourceFiles: { path: string; content: string }[]): Promise<void> {
    const entries = await readdir(inputRoot, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const source = join(inputRoot, entry.name);
        const target = join(outputRoot, entry.name);
        if (entry.isDirectory()) {
            await mkdir(target, { recursive: true });
            await copyJsonFiles(source, target, sourceFiles);
            continue;
        }
        if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".json") continue;
        const content = await readFile(source, "utf8");
        sourceFiles.push({ path: entry.name, content });
        await writeFile(target, content, "utf8");
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const inputDataRoot = requiredString(args, "--input-data-root");
    const outputRoot = requiredString(args, "--output-root");
    const sourceRoot = join(outputRoot, "input", "source");
    const dataRoot = join(outputRoot, "input", "data");
    const fundingRoot = join(outputRoot, "input", "funding");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(dataRoot, { recursive: true });
    await mkdir(fundingRoot, { recursive: true });

    const sourceFiles: { path: string; content: string }[] = [];
    const dataEntries = (await readdir(inputDataRoot)).filter((entry) => entry.endsWith("-1h.json")).sort();
    const dataRows: { symbol: string; rowCount: number; firstTs: number; lastTs: number; sha256: string; source: string }[] = [];
    for (const entry of dataEntries) {
        const symbol = basename(entry, "-1h.json");
        const rows = await readRows(join(inputDataRoot, entry));
        const enriched = enrich(symbol, rows);
        const content = `${JSON.stringify(enriched)}\n`;
        await writeFile(join(dataRoot, entry), content, "utf8");
        dataRows.push({ symbol, rowCount: enriched.length, firstTs: Number(enriched[0]?.ts), lastTs: Number(enriched.at(-1)?.ts), sha256: sha256(content), source: "Aster public H1 OHLC" });
    }
    const fundingEntries = (await readdir(inputDataRoot)).filter((entry) => entry.toLowerCase().includes("funding") && entry.endsWith(".json")).sort();
    for (const entry of fundingEntries) {
        const content = await readFile(join(inputDataRoot, entry), "utf8");
        await writeFile(join(dataRoot, entry), content, "utf8");
        await writeFile(join(fundingRoot, entry), content, "utf8");
    }

    const production = {
        strategy: "V12_V4",
        classification: "RECONSTRUCTED_NON_CANONICAL",
        config: {
            direction: "LONG",
            supportedDirections: ["LONG", "SHORT"],
            protectionMode: "NATIVE_ATR",
            atrLookbackBars: ATR_LOOKBACK,
            atrSourceTimeframe: "1h",
            inputTimeframe: "1h",
            strategyTimeframe: "2h",
            stopAtr: 2.477,
            takeProfitAtr: 3.1995,
            trailingAtr: 0.2,
            maxHoldBars: 23,
            holdClock: "STRATEGY_BARS",
            sameBarPolicy: "STOP_FIRST_FAIL_CLOSED",
            grossCap: 1,
            sharedRiskCap: 1,
            totalGrossCap: 1,
            cryptoGrossCap: 1,
            strategyGrossCap: 1,
            entryPolicy: "NON_CANONICAL_PUBLIC_DATA_DIAGNOSTIC",
            sizingPolicy: "NON_CANONICAL_PUBLIC_DATA_DIAGNOSTIC",
            marginGuard: "VPS_SOURCE_AMBIGUOUS_FAIL_CLOSED",
            leverage: 1,
        },
        provenance: {
            productionReleaseMarker: "dd87161165330310df39dd644aa35cd8a6eca6a4",
            researchEngineCommit: "be478ffe591a20dbb284fcf13b89a6063b161efa",
            sourceKind: "ASTER_PUBLIC_H1_OHLC_RECONSTRUCTION",
            sameBarOrderEvidence: "UNAVAILABLE_FROM_H1_OHLC",
            canonicalBaselineLedger: false,
            canonicalProductionEvents: false,
        },
    };
    const productionContent = `${JSON.stringify(production, null, 2)}\n`;
    sourceFiles.push({ path: "v12-v4-production-native-atr.json", content: productionContent });
    await writeFile(join(sourceRoot, "v12-v4-production-native-atr.json"), productionContent, "utf8");
    const productionSha = canonicalDirectorySha(sourceFiles);
    const manifest = {
        classification: "RECONSTRUCTED_NON_CANONICAL",
        productionSha,
        sourceKind: "ASTER_PUBLIC_H1_OHLC_RECONSTRUCTION",
        dataRows,
        sameBarOrderKnown: false,
        baselineLedger: "MISSING",
        candidateEvents: "MISSING",
        protectionReadback: "MISSING",
        note: "ATR metadata is causal where the prior 31 H1 TRs exist; H1 OHLC cannot prove intrabar STOP/TP ordering, so sameBarOrderKnown=false is preserved and replay must fail closed.",
    };
    await writeFile(join(outputRoot, "native-atr-diagnostic-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(join(outputRoot, "STATUS.md"), [
        "# Native ATR diagnostic reconstruction",
        "",
        "Classification: RECONSTRUCTED_NON_CANONICAL",
        "",
        "This input is derived from public Aster H1 OHLC/funding only. It is not a Production event/fill/protection ledger.",
        "The first 31 bars per symbol have incomplete ATR history. Intrabar STOP/TP order is not observable from H1 OHLC and is explicitly marked unknown; no replay may treat it as known.",
        "No baseline ledger or candidate event stream is included, so a successful baseline or candidate search is not possible.",
        "",
    ].join("\n"), "utf8");
    process.stdout.write(`${JSON.stringify({ outputRoot, sourceRoot, dataRoot, productionSha, symbols: dataRows.length }, null, 2)}\n`);
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
