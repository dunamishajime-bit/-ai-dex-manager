import fs from "fs/promises";
import path from "path";

type UpdownRow = {
  ts: number;
  iso: string;
  coin: string;
  slug: string;
  startSec: number;
  endSec: number;
  elapsedSec: number;
  moveBps: number;
  horizonSec: number;
  up?: { bestAsk?: number; askDepthUsd?: number; bidDepthUsd?: number; spreadBps?: number };
  down?: { bestAsk?: number; askDepthUsd?: number; bidDepthUsd?: number; spreadBps?: number };
};

type Candle1m = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Strategy = {
  key: string;
  sideMode: "long_only" | "short_only" | "both";
  moveThresholdBps: number;
  minEntryElapsedSec: number;
  maxEntryElapsedSec: number;
  minAccelerationBps: number;
  accelerationLookbackSec: number;
  maxEntryPrice: number;
  maxEntrySpreadBps: number;
  minBidSupportRatio: number;
  entryPct: number;
};

type Result = {
  strategy: Strategy;
  trades: number;
  wins: number;
  winRatePct: number;
  pnlUsd: number;
  totalReturnPct: number;
  avgTradePct: number;
  maxDrawdownPct: number;
  score: number;
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const CACHE_DIR = path.join(process.cwd(), ".cache", "btc15m-aster-fee");
const REPORT_DIR = path.join(process.cwd(), "reports", "btc15m-aster-search");
const STARTING_CASH_USD = 100;
const ENTRY_PCT = 0.05;
const FEE_PER_SIDE = 0.0004;

function minuteFloor(ts: number) {
  return Math.floor(ts / 60_000) * 60_000;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function listInputFiles() {
  const names = await fs.readdir(DATA_DIR);
  return names.filter((name) => /^updown_lag_.*\.ndjson$/.test(name)).sort().map((name) => path.join(DATA_DIR, name));
}

async function loadRows() {
  const files = await listInputFiles();
  const rows: UpdownRow[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as UpdownRow;
      if (row.coin !== "BTC") continue;
      if (Number(row.horizonSec) !== 900) continue;
      if (!Number.isFinite(row.ts) || !Number.isFinite(row.moveBps)) continue;
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.ts - b.ts);
}

function groupByMarket(rows: UpdownRow[]) {
  const grouped = new Map<string, UpdownRow[]>();
  for (const row of rows) {
    const key = `${row.coin}:${row.horizonSec}:${row.startSec}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  for (const group of grouped.values()) group.sort((a, b) => a.ts - b.ts);
  return grouped;
}

function priorRow(rows: UpdownRow[], row: UpdownRow, lookbackSec: number) {
  const targetTs = row.ts - lookbackSec * 1000;
  let prior: UpdownRow | null = null;
  for (const item of rows) {
    if (item.ts >= row.ts) break;
    if (item.ts <= targetTs) prior = item;
  }
  return prior;
}

function signalForRow(rows: UpdownRow[], row: UpdownRow, strategy: Strategy) {
  if (row.elapsedSec < strategy.minEntryElapsedSec || row.elapsedSec > strategy.maxEntryElapsedSec) return null;
  if (Math.abs(row.moveBps) < strategy.moveThresholdBps) return null;
  const side = row.moveBps >= 0 ? "long" : "short";
  if (strategy.sideMode === "long_only" && side !== "long") return null;
  if (strategy.sideMode === "short_only" && side !== "short") return null;
  const prior = priorRow(rows, row, strategy.accelerationLookbackSec);
  if (!prior || !Number.isFinite(prior.moveBps)) return null;
  if (Math.sign(prior.moveBps) !== Math.sign(row.moveBps)) return null;
  if (Math.abs(row.moveBps) < Math.abs(prior.moveBps)) return null;
  const accelerationBps = Math.abs(row.moveBps) - Math.abs(prior.moveBps);
  if (accelerationBps < strategy.minAccelerationBps) return null;
  const book = side === "long" ? row.up : row.down;
  if (!book || !Number.isFinite(book.bestAsk) || book.bestAsk <= 0) return null;
  if (book.bestAsk > strategy.maxEntryPrice) return null;
  if (Number(book.spreadBps || 9999) > strategy.maxEntrySpreadBps) return null;
  const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
  if (bidSupportRatio < strategy.minBidSupportRatio) return null;
  return { row, side, accelerationBps };
}

async function loadCached1m(startMs: number, endMs: number) {
  const filePath = path.join(CACHE_DIR, `BTCUSDT-${minuteFloor(startMs)}-${minuteFloor(endMs)}-1m.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Candle1m[];
  } catch {
    const out: Candle1m[] = [];
    let cursor = minuteFloor(startMs);
    while (cursor < endMs) {
      const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${cursor}&endTime=${endMs}&limit=1000`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Binance 1m request failed: ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) break;
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) continue;
        out.push({
          ts: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        });
      }
      const last = rows.at(-1);
      const next = Number(Array.isArray(last) ? last[6] : 0) + 1;
      if (!Number.isFinite(next) || next <= cursor) break;
      cursor = next;
    }
    const dedup = new Map<number, Candle1m>();
    out.forEach((candle) => dedup.set(candle.ts, candle));
    const candles = [...dedup.values()].sort((a, b) => a.ts - b.ts);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(candles), "utf8");
    return candles;
  }
}

function executionPrice(candles: Candle1m[], targetTs: number) {
  const execTs = Math.ceil(targetTs / 60_000) * 60_000;
  const candle = candles.find((row) => row.ts >= execTs);
  return candle ? candle.open : null;
}

function simulate(strategy: Strategy, rowsByMarket: Map<string, UpdownRow[]>, candles: Candle1m[]): Result {
  const stakeUsd = STARTING_CASH_USD * strategy.entryPct;
  const trades: number[] = [];
  let equity = STARTING_CASH_USD;
  let peak = STARTING_CASH_USD;
  let maxDd = 0;
  let wins = 0;

  for (const rows of rowsByMarket.values()) {
    let signal: ReturnType<typeof signalForRow> = null;
    for (const row of rows) {
      signal = signalForRow(rows, row, strategy);
      if (signal) break;
    }
    if (!signal) continue;
    const entry = executionPrice(candles, signal.row.ts);
    const exit = executionPrice(candles, signal.row.ts + signal.row.horizonSec * 1000);
    if (!Number.isFinite(entry) || !Number.isFinite(exit)) continue;
    const gross = signal.side === "long" ? ((exit! / entry!) - 1) : ((entry! / exit!) - 1);
    const net = gross - (FEE_PER_SIDE * 2);
    const pnlUsd = stakeUsd * net;
    trades.push(pnlUsd);
    if (pnlUsd > 0) wins += 1;
    equity += pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity / peak) - 1);
  }

  const pnlUsd = trades.reduce((a, b) => a + b, 0);
  const avgTradePct = trades.length ? (pnlUsd / (stakeUsd * trades.length)) * 100 : 0;
  const winRatePct = trades.length ? (wins / trades.length) * 100 : 0;
  const totalReturnPct = ((equity / STARTING_CASH_USD) - 1) * 100;
  const score = pnlUsd * 100 + (avgTradePct * 10) + Math.min(trades.length, 40) + (winRatePct * 0.1) - Math.max(0, 12 - trades.length) * 8;

  return {
    strategy,
    trades: trades.length,
    wins,
    winRatePct,
    pnlUsd,
    totalReturnPct,
    avgTradePct,
    maxDrawdownPct: maxDd * 100,
    score,
  };
}

function* generateStrategies() {
  const sideModes: Strategy["sideMode"][] = ["long_only", "short_only", "both"];
  const moveThresholds = [4, 5, 6];
  const minElapseds = [90, 120, 150];
  const maxElapseds = [180, 210, 240, 270];
  const accelThresholds = [1.2, 1.5, 2.0, 2.5, 3.0];
  const maxPrices = [0.58, 0.6, 0.62, 0.65];
  const maxSpreads = [140, 160, 180];
  const minBidSupports = [0.8, 1.0, 1.2, 1.5];

  for (const sideMode of sideModes) {
    for (const moveThresholdBps of moveThresholds) {
      for (const minEntryElapsedSec of minElapseds) {
        for (const maxEntryElapsedSec of maxElapseds) {
          if (maxEntryElapsedSec <= minEntryElapsedSec) continue;
          for (const minAccelerationBps of accelThresholds) {
            for (const maxEntryPrice of maxPrices) {
              for (const maxEntrySpreadBps of maxSpreads) {
                for (const minBidSupportRatio of minBidSupports) {
                  yield {
                    key: `${sideMode}_m${moveThresholdBps}_e${minEntryElapsedSec}-${maxEntryElapsedSec}_a${minAccelerationBps}_p${maxEntryPrice}_s${maxEntrySpreadBps}_b${minBidSupportRatio}`,
                    sideMode,
                    moveThresholdBps,
                    minEntryElapsedSec,
                    maxEntryElapsedSec,
                    minAccelerationBps,
                    accelerationLookbackSec: 15,
                    maxEntryPrice,
                    maxEntrySpreadBps,
                    minBidSupportRatio,
                    entryPct: ENTRY_PCT,
                  } satisfies Strategy;
                }
              }
            }
          }
        }
      }
    }
  }
}

async function main() {
  const rows = await loadRows();
  const rowsByMarket = groupByMarket(rows);
  const startMs = Math.min(...rows.map((row) => row.ts)) - 60 * 60 * 1000;
  const endMs = Math.max(...rows.map((row) => row.ts + row.horizonSec * 1000)) + 60 * 60 * 1000;
  const candles = await loadCached1m(startMs, endMs);

  const results: Result[] = [];
  for (const strategy of generateStrategies()) {
    const result = simulate(strategy, rowsByMarket, candles);
    if (result.trades === 0) continue;
    results.push(result);
  }
  const byScore = [...results].sort((a, b) => b.score - a.score || b.pnlUsd - a.pnlUsd || b.avgTradePct - a.avgTradePct);
  const byPnl = [...results].sort((a, b) => b.pnlUsd - a.pnlUsd || b.avgTradePct - a.avgTradePct || b.score - a.score);

  const bestByMode = Object.fromEntries(
    ["long_only", "short_only", "both"].map((mode) => {
      const best = byPnl.find((result) => result.strategy.sideMode === mode) || null;
      return [mode, best ? {
        ...best,
        pnlUsd: round(best.pnlUsd, 4),
        totalReturnPct: round(best.totalReturnPct, 4),
        avgTradePct: round(best.avgTradePct, 4),
        maxDrawdownPct: round(best.maxDrawdownPct, 4),
        score: round(best.score, 2),
        winRatePct: round(best.winRatePct, 2),
      } : null];
    })
  );

  const report = {
    generatedAt: new Date().toISOString(),
    feePerSidePct: FEE_PER_SIDE,
    sourceRows: rows.length,
    sourceMarkets: rowsByMarket.size,
    bestByMode,
    top20ByPnl: byPnl.slice(0, 20).map((result) => ({
      ...result,
      strategy: result.strategy,
      pnlUsd: round(result.pnlUsd, 4),
      totalReturnPct: round(result.totalReturnPct, 4),
      avgTradePct: round(result.avgTradePct, 4),
      maxDrawdownPct: round(result.maxDrawdownPct, 4),
      score: round(result.score, 2),
      winRatePct: round(result.winRatePct, 2),
    })),
    top20ByScore: byScore.slice(0, 20).map((result) => ({
      ...result,
      strategy: result.strategy,
      pnlUsd: round(result.pnlUsd, 4),
      totalReturnPct: round(result.totalReturnPct, 4),
      avgTradePct: round(result.avgTradePct, 4),
      maxDrawdownPct: round(result.maxDrawdownPct, 4),
      score: round(result.score, 2),
      winRatePct: round(result.winRatePct, 2),
    })),
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  const outFile = path.join(REPORT_DIR, "result.json");
  await fs.writeFile(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ bestByMode: report.bestByMode, top20ByPnl: report.top20ByPnl.slice(0, 10) }, null, 2));
}

main().catch((error) => {
  console.error("[search-btc15m-aster-profit] failed:", error);
  process.exitCode = 1;
});
