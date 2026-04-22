import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

import type { Candle1h } from "./types";

const REMOTE_START_2023 = Date.UTC(2023, 0, 1, 0, 0, 0);
const REMOTE_CACHE_VERSION = "v1";

function psQuote(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

function asUrl(symbol: string, startMs: number, endMs: number) {
    return `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&startTime=${startMs}&endTime=${endMs}&limit=1000`;
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

    const command = `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(targetDir)} -Force`;
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "ignore" });
    await fs.writeFile(marker, new Date().toISOString(), "utf8");
}

function parseCsvLine(line: string): Candle1h | null {
    const parts = line.split(",");
    if (parts.length < 6) return null;
    const candle = {
        ts: Number(parts[0]),
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
    for (const row of rows.slice(1)) {
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
        if (!(await exists(innerDir))) {
            const command = `Expand-Archive -LiteralPath ${psQuote(innerZip)} -DestinationPath ${psQuote(innerDir)} -Force`;
            execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "ignore" });
        }
    }

    const csvFiles = (await listFilesRecursive(targetDir)).filter((filePath) => filePath.toLowerCase().endsWith(".csv"));
    const candles = await Promise.all(csvFiles.map((filePath) => readCsv(filePath)));
    return candles.flat().sort((left, right) => left.ts - right.ts);
}

export async function fetchBinanceKlines(symbol: string, startMs: number, endMs: number): Promise<Candle1h[]> {
    const all: Candle1h[] = [];
    let cursor = startMs;

    while (cursor < endMs) {
        const url = asUrl(symbol, cursor, endMs);
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Binance klines request failed for ${symbol}: ${response.status}`);
        }

        const json = await response.json();
        const rows = Array.isArray(json) ? json : [];
        if (!rows.length) break;

        for (const row of rows) {
            if (!Array.isArray(row) || row.length < 6) continue;
            const candle = {
                ts: Number(row[0]),
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
        const nextTs = Number(Array.isArray(last) ? last[6] : 0) + 1;
        if (!Number.isFinite(nextTs) || nextTs <= cursor) break;
        cursor = nextTs;
    }

    return all.sort((left, right) => left.ts - right.ts);
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
            remoteCandles = await fetchBinanceKlines(symbol, remoteStart, endMs);
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
