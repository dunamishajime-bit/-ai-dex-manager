import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

import type { Candle1h } from "./types";

const REMOTE_START_2023 = Date.UTC(2023, 0, 1, 0, 0, 0);
const REMOTE_CACHE_VERSION = "v4";
const PUBLIC_ARCHIVE_ROOT = "https://data.binance.vision/data/spot/monthly/klines";
const BINANCE_SPOT_API_BASES = [
    "https://api.binance.com",
    "https://api-gcp.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://api4.binance.com",
] as const;

function psQuote(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

function asUrl(baseUrl: string, symbol: string, startMs: number, endMs: number) {
    return `${baseUrl}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&startTime=${startMs}&endTime=${endMs}&limit=1000`;
}

async function exists(filePath: string) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
    const out: string[] = [];
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const filePath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            out.push(...await listFilesRecursive(filePath));
        } else {
            out.push(filePath);
        }
    }
    return out;
}

async function ensureExpanded(zipPath: string, targetDir: string) {
    await fs.mkdir(targetDir, { recursive: true });
    const marker = path.join(targetDir, ".expanded.ok");
    if (await exists(marker)) return;

    if (process.platform === "win32") {
        const command = `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(targetDir)} -Force`;
        execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "ignore" });
    } else {
        execFileSync("unzip", ["-o", zipPath, "-d", targetDir], { stdio: "ignore" });
    }
    await fs.writeFile(marker, new Date().toISOString(), "utf8");
}

function normalizeTimestamp(value: number) {
    if (!Number.isFinite(value)) return value;
    return value > 10_000_000_000_000 ? Math.floor(value / 1000) : value;
}

function parseCsvLine(line: string): Candle1h | null {
    const parts = line.split(",");
    if (parts.length < 6) return null;
    const candle = {
        ts: normalizeTimestamp(Number(parts[0])),
        open: Number(parts[1]),
        high: Number(parts[2]),
        low: Number(parts[3]),
        close: Number(parts[4]),
        volume: Number(parts[5]),
    } satisfies Candle1h;
    if (!Number.isFinite(candle.ts) || !Number.isFinite(candle.close) || candle.close <= 0) {
        return null;
    }
    return candle;
}

async function readCsv(filePath: string): Promise<Candle1h[]> {
    const raw = await fs.readFile(filePath, "utf8");
    const rows = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const candles: Candle1h[] = [];
    const startIndex = rows[0]?.toLowerCase().includes("open") ? 1 : 0;
    for (const row of rows.slice(startIndex)) {
        const candle = parseCsvLine(row);
        if (candle) candles.push(candle);
    }
    return candles;
}

export async function loadLocalBinanceCandles(zipPath: string, cacheRoot: string): Promise<Candle1h[]> {
    if (!(await exists(zipPath))) return [];

    const targetDir = path.join(cacheRoot, path.basename(zipPath).replace(/\.zip$/i, ""));
    await ensureExpanded(zipPath, targetDir);

    const innerZips = (await listFilesRecursive(targetDir)).filter((filePath) => filePath.toLowerCase().endsWith(".zip"));
    for (const innerZip of innerZips) {
        const innerDir = innerZip.replace(/\.zip$/i, "");
        await ensureExpanded(innerZip, innerDir);
    }

    const csvFiles = (await listFilesRecursive(targetDir)).filter((filePath) => filePath.toLowerCase().endsWith(".csv"));
    const candles = await Promise.all(csvFiles.map((filePath) => readCsv(filePath)));
    return candles.flat().sort((left, right) => left.ts - right.ts);
}

async function fetchKlineRows(symbol: string, startMs: number, endMs: number) {
    const failures: string[] = [];
    for (const baseUrl of BINANCE_SPOT_API_BASES) {
        const url = asUrl(baseUrl, symbol, startMs, endMs);
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
                failures.push(`${new URL(baseUrl).hostname}:${response.status}`);
                continue;
            }
            const json = await response.json();
            if (!Array.isArray(json)) {
                failures.push(`${new URL(baseUrl).hostname}:invalid-json`);
                continue;
            }
            return json;
        } catch (error) {
            failures.push(`${new URL(baseUrl).hostname}:${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(`Binance klines request failed for ${symbol}: ${failures.join(", ")}`);
}

export async function fetchBinanceKlines(symbol: string, startMs: number, endMs: number): Promise<Candle1h[]> {
    const all: Candle1h[] = [];
    let cursor = startMs;

    while (cursor < endMs) {
        const rows = await fetchKlineRows(symbol, cursor, endMs);
        if (!rows.length) break;

        for (const row of rows) {
            if (!Array.isArray(row) || row.length < 6) continue;
            const candle = {
                ts: normalizeTimestamp(Number(row[0])),
                open: Number(row[1]),
                high: Number(row[2]),
                low: Number(row[3]),
                close: Number(row[4]),
                volume: Number(row[5]),
            } satisfies Candle1h;
            if (Number.isFinite(candle.ts) && candle.close > 0) {
                all.push(candle);
            }
        }

        const last = rows.at(-1);
        const closeTime = normalizeTimestamp(Number(Array.isArray(last) ? last[6] : 0));
        const nextTs = closeTime + 1;
        if (!Number.isFinite(nextTs) || nextTs <= cursor) break;
        cursor = nextTs;
    }

    return all.sort((left, right) => left.ts - right.ts);
}

function monthKeys(startMs: number, endMs: number) {
    const start = new Date(startMs);
    let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    const keys: string[] = [];
    while (cursor < endMs) {
        const date = new Date(cursor);
        const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
        if (nextMonth > endMs) break;
        keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
        cursor = nextMonth;
    }
    return keys;
}

async function downloadPublicArchive(url: string, zipPath: string) {
    if (await exists(zipPath)) return true;
    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Binance public archive request failed: ${response.status} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100) throw new Error(`Binance public archive was unexpectedly small: ${url}`);
    await fs.mkdir(path.dirname(zipPath), { recursive: true });
    await fs.writeFile(zipPath, bytes);
    return true;
}

async function loadPublicArchiveCandles(input: {
    symbol: string;
    cacheRoot: string;
    startMs: number;
    endMs: number;
}) {
    const { symbol, cacheRoot, startMs, endMs } = input;
    const monthlyRoot = path.join(cacheRoot, "public-data", symbol, "1h");
    const all: Candle1h[] = [];

    for (const monthKey of monthKeys(startMs, endMs)) {
        const archiveName = `${symbol}-1h-${monthKey}.zip`;
        const zipPath = path.join(monthlyRoot, archiveName);
        const extractedDir = path.join(monthlyRoot, archiveName.replace(/\.zip$/i, ""));
        const url = `${PUBLIC_ARCHIVE_ROOT}/${encodeURIComponent(symbol)}/1h/${archiveName}`;
        const available = await downloadPublicArchive(url, zipPath);
        if (!available) continue;
        await ensureExpanded(zipPath, extractedDir);
        const csvFiles = (await listFilesRecursive(extractedDir)).filter((filePath) => filePath.toLowerCase().endsWith(".csv"));
        for (const csvFile of csvFiles) {
            all.push(...await readCsv(csvFile));
        }
    }

    return all
        .filter((candle) => candle.ts >= startMs && candle.ts < endMs)
        .sort((left, right) => left.ts - right.ts);
}

function remoteCacheFile(cacheRoot: string, symbol: string, startMs: number, endMs: number) {
    const fileName = `${symbol}-${startMs}-${endMs}-${REMOTE_CACHE_VERSION}.json`;
    return path.join(cacheRoot, "remote", fileName);
}

export async function loadHistoricalCandles(input: {
    symbol: string;
    localZipPath?: string;
    cacheRoot: string;
    startMs: number;
    endMs: number;
}) {
    const { symbol, localZipPath, cacheRoot, startMs, endMs } = input;
    const out: Candle1h[] = [];

    if (localZipPath && startMs < REMOTE_START_2023) {
        const localCandles = await loadLocalBinanceCandles(localZipPath, cacheRoot);
        out.push(...localCandles.filter((candle) => candle.ts >= startMs && candle.ts < Math.min(endMs, REMOTE_START_2023)));
    }

    if (endMs > REMOTE_START_2023) {
        const remoteStart = Math.max(startMs, REMOTE_START_2023);
        const cacheFile = remoteCacheFile(cacheRoot, symbol, remoteStart, endMs);
        let remoteCandles: Candle1h[] = [];
        if (await exists(cacheFile)) {
            remoteCandles = JSON.parse(await fs.readFile(cacheFile, "utf8")) as Candle1h[];
        } else {
            const archiveOnly = process.env.BINANCE_PUBLIC_ARCHIVE_ONLY === "true";
            let apiError: unknown = null;
            if (!archiveOnly) {
                try {
                    remoteCandles = await fetchBinanceKlines(symbol, remoteStart, endMs);
                } catch (error) {
                    apiError = error;
                }
            }
            if (!remoteCandles.length) {
                remoteCandles = await loadPublicArchiveCandles({
                    symbol,
                    cacheRoot,
                    startMs: remoteStart,
                    endMs,
                });
            }
            if (!remoteCandles.length) {
                const message = archiveOnly
                    ? "Binance public archive returned no candles"
                    : apiError instanceof Error
                        ? apiError.message
                        : String(apiError ?? "no API data");
                throw new Error(`${message}; no historical candles for ${symbol}`);
            }
            await fs.mkdir(path.dirname(cacheFile), { recursive: true });
            await fs.writeFile(cacheFile, JSON.stringify(remoteCandles), "utf8");
        }
        out.push(...remoteCandles);
    }

    const dedup = new Map<number, Candle1h>();
    for (const candle of out) {
        dedup.set(candle.ts, candle);
    }
    return [...dedup.values()].sort((left, right) => left.ts - right.ts);
}
