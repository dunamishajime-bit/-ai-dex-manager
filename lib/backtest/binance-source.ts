import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

import type { Candle1h } from "./types";

const REMOTE_START_2022 = Date.UTC(2022, 0, 1, 0, 0, 0);
const REMOTE_CACHE_VERSION = "v1";
const BINANCE_RETRY_DELAYS_MS = [1500, 4000, 8000];
const INTERVAL_MS: Record<string, number> = {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function psQuote(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

function asUrl(symbol: string, startMs: number, endMs: number, interval: string) {
    return `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${startMs}&endTime=${endMs}&limit=1000`;
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

export async function fetchBinanceKlines(symbol: string, startMs: number, endMs: number, interval = "1h"): Promise<Candle1h[]> {
    const all: Candle1h[] = [];
    let cursor = startMs;

    while (cursor < endMs) {
        const url = asUrl(symbol, cursor, endMs, interval);
        let response: Response | null = null;
        let lastStatus = 0;
        for (let attempt = 0; attempt <= BINANCE_RETRY_DELAYS_MS.length; attempt += 1) {
            response = await fetch(url, { cache: "no-store" });
            lastStatus = response.status;
            if (response.ok) break;
            if (response.status !== 429 || attempt === BINANCE_RETRY_DELAYS_MS.length) break;
            await sleep(BINANCE_RETRY_DELAYS_MS[attempt]);
        }
        if (!response?.ok) {
            throw new Error(`Binance klines request failed for ${symbol}: ${lastStatus}`);
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

function normalizeRemoteEndMs(endMs: number, interval: string) {
    const intervalMs = INTERVAL_MS[interval] || 60 * 60 * 1000;
    const now = Date.now();
    const isLiveLikeEnd = Math.abs(now - endMs) <= intervalMs * 2;
    if (!isLiveLikeEnd) return endMs;
    return Math.floor(endMs / intervalMs) * intervalMs;
}

function normalizeRemoteStartMs(startMs: number, endMs: number, interval: string) {
    const intervalMs = INTERVAL_MS[interval] || 60 * 60 * 1000;
    const now = Date.now();
    const isLiveLikeEnd = Math.abs(now - endMs) <= intervalMs * 2;
    if (!isLiveLikeEnd) return startMs;
    return Math.floor(startMs / intervalMs) * intervalMs;
}

function remoteCacheFile(cacheRoot: string, symbol: string, startMs: number, endMs: number, interval: string) {
    const normalizedStartMs = normalizeRemoteStartMs(startMs, endMs, interval);
    const normalizedEndMs = normalizeRemoteEndMs(endMs, interval);
    const fileName = `${symbol}-${interval}-${normalizedStartMs}-${normalizedEndMs}-${REMOTE_CACHE_VERSION}.json`;
    return path.join(cacheRoot, "remote", fileName);
}

export async function loadHistoricalCandles(input: {
    symbol: string;
    localZipPath?: string;
    cacheRoot: string;
    startMs: number;
    endMs: number;
    interval?: "1h" | "15m";
}) {
    const { symbol, localZipPath, cacheRoot, startMs, endMs, interval = "1h" } = input;
    const out: Candle1h[] = [];

    if (interval === "1h" && localZipPath && startMs < REMOTE_START_2022) {
        const localCandles = await loadLocalBinanceCandles(localZipPath, cacheRoot);
        for (const candle of localCandles) {
            if (candle.ts >= startMs && candle.ts < Math.min(endMs, REMOTE_START_2022)) {
                out.push(candle);
            }
        }
    }

    if (endMs > REMOTE_START_2022) {
        const remoteStart = Math.max(startMs, REMOTE_START_2022);
        const cacheFile = remoteCacheFile(cacheRoot, symbol, remoteStart, endMs, interval);
        let remoteCandles: Candle1h[] = [];
        if (await exists(cacheFile)) {
            remoteCandles = JSON.parse(await fs.readFile(cacheFile, "utf8")) as Candle1h[];
        } else {
            remoteCandles = await fetchBinanceKlines(symbol, remoteStart, endMs, interval);
            await fs.mkdir(path.dirname(cacheFile), { recursive: true });
            await fs.writeFile(cacheFile, JSON.stringify(remoteCandles), "utf8");
        }
        for (const candle of remoteCandles) {
            out.push(candle);
        }
    }

    const dedup = new Map<number, Candle1h>();
    for (const candle of out) {
        dedup.set(candle.ts, candle);
    }
    return [...dedup.values()].sort((left, right) => left.ts - right.ts);
}
