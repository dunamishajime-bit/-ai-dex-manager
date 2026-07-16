import fs from "fs/promises";
import path from "path";
import { execFileSync } from "child_process";

import type { Candle1h } from "@/lib/backtest/types";
import type { PerpFundingPoint } from "./types";

const FUTURES_KLINE_ROOT = "https://data.binance.vision/data/futures/um/monthly/klines";
const FUTURES_FUNDING_ROOT = "https://data.binance.vision/data/futures/um/monthly/fundingRate";
const CACHE_VERSION = "v1";

function normalizeTimestamp(value: number) {
  if (!Number.isFinite(value)) return value;
  return value > 10_000_000_000_000 ? Math.floor(value / 1000) : value;
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
    if (entry.isDirectory()) out.push(...await listFilesRecursive(filePath));
    else out.push(filePath);
  }
  return out;
}

async function ensureExpanded(zipPath: string, targetDir: string) {
  const marker = path.join(targetDir, ".expanded.ok");
  if (await exists(marker)) return;
  await fs.mkdir(targetDir, { recursive: true });
  if (process.platform === "win32") {
    const escapedZip = zipPath.replace(/'/g, "''");
    const escapedTarget = targetDir.replace(/'/g, "''");
    const command = `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedTarget}' -Force`;
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "ignore" });
  } else {
    execFileSync("unzip", ["-o", zipPath, "-d", targetDir], { stdio: "ignore" });
  }
  await fs.writeFile(marker, new Date().toISOString(), "utf8");
}

function monthKeys(startTs: number, endTs: number) {
  const start = new Date(startTs);
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
  const keys: string[] = [];
  while (cursor < endTs) {
    const date = new Date(cursor);
    const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    if (nextMonth > endTs) break;
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor = nextMonth;
  }
  return keys;
}

async function downloadArchive(url: string, zipPath: string) {
  if (await exists(zipPath)) return true;
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`USD-M archive request failed: ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100) throw new Error(`USD-M archive was unexpectedly small: ${url}`);
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await fs.writeFile(zipPath, bytes);
  return true;
}

function parseKlineCsvLine(line: string): Candle1h | null {
  const parts = line.split(",");
  if (parts.length < 6) return null;
  const candle: Candle1h = {
    ts: normalizeTimestamp(Number(parts[0])),
    open: Number(parts[1]),
    high: Number(parts[2]),
    low: Number(parts[3]),
    close: Number(parts[4]),
    volume: Number(parts[5]),
  };
  if (
    !Number.isFinite(candle.ts) ||
    !Number.isFinite(candle.open) ||
    !Number.isFinite(candle.high) ||
    !Number.isFinite(candle.low) ||
    !Number.isFinite(candle.close) ||
    candle.close <= 0
  ) {
    return null;
  }
  return candle;
}

function parseFundingCsvLine(line: string): PerpFundingPoint | null {
  const parts = line.split(",").map((part) => part.trim());
  if (parts.length < 2) return null;
  const numeric = parts.map((part) => Number(part));
  const ts = normalizeTimestamp(numeric[0]);
  const rate = numeric.at(-1) ?? Number.NaN;
  if (!Number.isFinite(ts) || !Number.isFinite(rate) || Math.abs(rate) > 0.1) return null;
  return { ts, rate };
}

async function readKlineCsv(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => parseKlineCsvLine(line.trim()))
    .filter((item): item is Candle1h => item !== null);
}

async function readFundingCsv(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => parseFundingCsvLine(line.trim()))
    .filter((item): item is PerpFundingPoint => item !== null);
}

async function loadArchiveCsv<T>(input: {
  url: string;
  zipPath: string;
  extractedDir: string;
  reader: (filePath: string) => Promise<T[]>;
}) {
  const available = await downloadArchive(input.url, input.zipPath);
  if (!available) return [];
  await ensureExpanded(input.zipPath, input.extractedDir);
  const csvFiles = (await listFilesRecursive(input.extractedDir)).filter((filePath) => filePath.toLowerCase().endsWith(".csv"));
  const rows = await Promise.all(csvFiles.map((filePath) => input.reader(filePath)));
  return rows.flat();
}

export async function loadUsdMFuturesSymbol(input: {
  symbol: string;
  cacheRoot: string;
  startTs: number;
  endTs: number;
}) {
  const symbol = input.symbol.toUpperCase();
  const consolidatedDir = path.join(input.cacheRoot, "consolidated");
  const cacheFile = path.join(consolidatedDir, `${symbol}-${input.startTs}-${input.endTs}-${CACHE_VERSION}.json`);
  if (await exists(cacheFile)) {
    return JSON.parse(await fs.readFile(cacheFile, "utf8")) as {
      candles: Candle1h[];
      funding: PerpFundingPoint[];
    };
  }

  const candles: Candle1h[] = [];
  const funding: PerpFundingPoint[] = [];
  for (const monthKey of monthKeys(input.startTs, input.endTs)) {
    const klineName = `${symbol}-1h-${monthKey}.zip`;
    const fundingName = `${symbol}-fundingRate-${monthKey}.zip`;
    const klineZip = path.join(input.cacheRoot, "raw", symbol, "klines", klineName);
    const fundingZip = path.join(input.cacheRoot, "raw", symbol, "funding", fundingName);

    candles.push(...await loadArchiveCsv({
      url: `${FUTURES_KLINE_ROOT}/${encodeURIComponent(symbol)}/1h/${klineName}`,
      zipPath: klineZip,
      extractedDir: klineZip.replace(/\.zip$/i, ""),
      reader: readKlineCsv,
    }));

    funding.push(...await loadArchiveCsv({
      url: `${FUTURES_FUNDING_ROOT}/${encodeURIComponent(symbol)}/${fundingName}`,
      zipPath: fundingZip,
      extractedDir: fundingZip.replace(/\.zip$/i, ""),
      reader: readFundingCsv,
    }));
  }

  const dedupCandles = new Map<number, Candle1h>();
  for (const candle of candles) {
    if (candle.ts >= input.startTs && candle.ts < input.endTs) dedupCandles.set(candle.ts, candle);
  }
  const dedupFunding = new Map<number, PerpFundingPoint>();
  for (const point of funding) {
    if (point.ts >= input.startTs && point.ts < input.endTs) dedupFunding.set(point.ts, point);
  }
  const result = {
    candles: [...dedupCandles.values()].sort((left, right) => left.ts - right.ts),
    funding: [...dedupFunding.values()].sort((left, right) => left.ts - right.ts),
  };
  if (!result.candles.length) throw new Error(`USD-M futures candles missing for ${symbol}`);
  await fs.mkdir(consolidatedDir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(result), "utf8");
  return result;
}
