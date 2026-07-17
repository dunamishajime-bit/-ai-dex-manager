import fs from "fs/promises";
import path from "path";

type UpdownRow = {
  ts: number;
  iso: string;
  coin: string;
  slug: string;
  elapsedSec: number;
  moveBps: number;
  horizonSec: number;
  up?: { bestAsk?: number; askDepthUsd?: number; bidDepthUsd?: number; spreadBps?: number };
  down?: { bestAsk?: number; askDepthUsd?: number; bidDepthUsd?: number; spreadBps?: number };
};

type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Candle15m = Candle & {
  ema20: number;
  ema48: number;
  moveBps: number;
  accelBps: number;
  high3: number;
  low3: number;
};

type Variant = {
  key: string;
  family: "standalone" | "goldcat_filter";
  sideMode: "long_only" | "short_only" | "both";
  holdMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  minMoveBps: number;
  minAccelBps: number;
  minBidSupportRatio?: number;
  maxEntrySpreadBps?: number;
  minElapsedSec?: number;
  maxElapsedSec?: number;
  maxEntryPrice?: number;
  filterBreakoutBps?: number;
  filterConfirmMinutes?: number;
  entryPct: number;
};

type Trade = {
  side: "long" | "short";
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  pnlPct: number;
  reason: string;
};

type Summary = {
  key: string;
  family: string;
  trades: number;
  wins: number;
  winRatePct: number;
  pnlUsd: number;
  totalReturnPct: number;
  avgTradePct: number;
  maxDrawdownPct: number;
  tradesDetail: Trade[];
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const CACHE_DIR = path.join(process.cwd(), ".cache", "btc15m-rebuild");
const REPORT_DIR = path.join(process.cwd(), "reports", "btc15m-rebuild-vs-filter");
const STARTING_CASH_USD = 100;
const ASTER_TAKER_FEE_PER_SIDE = 0.0004;

const VARIANTS: Variant[] = [
  {
    key: "standalone_trend_long",
    family: "standalone",
    sideMode: "long_only",
    holdMinutes: 30,
    stopLossPct: 0.0035,
    takeProfitPct: 0.010,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0025,
    minMoveBps: 18,
    minAccelBps: 6,
    entryPct: 1,
  },
  {
    key: "standalone_breakout_long",
    family: "standalone",
    sideMode: "long_only",
    holdMinutes: 45,
    stopLossPct: 0.004,
    takeProfitPct: 0.014,
    trailActivationPct: 0.006,
    trailRetracePct: 0.0025,
    minMoveBps: 24,
    minAccelBps: 8,
    entryPct: 1,
  },
  {
    key: "standalone_trend_both",
    family: "standalone",
    sideMode: "both",
    holdMinutes: 30,
    stopLossPct: 0.0035,
    takeProfitPct: 0.010,
    trailActivationPct: 0.005,
    trailRetracePct: 0.0025,
    minMoveBps: 20,
    minAccelBps: 7,
    entryPct: 1,
  },
  {
    key: "goldcat_filter_long_confirm3",
    family: "goldcat_filter",
    sideMode: "long_only",
    holdMinutes: 20,
    stopLossPct: 0.003,
    takeProfitPct: 0.009,
    trailActivationPct: 0.0045,
    trailRetracePct: 0.002,
    minMoveBps: 6,
    minAccelBps: 2,
    minBidSupportRatio: 0.8,
    maxEntrySpreadBps: 180,
    minElapsedSec: 120,
    maxElapsedSec: 240,
    maxEntryPrice: 0.65,
    filterBreakoutBps: 4,
    filterConfirmMinutes: 3,
    entryPct: 1,
  },
  {
    key: "goldcat_filter_long_confirm6",
    family: "goldcat_filter",
    sideMode: "long_only",
    holdMinutes: 30,
    stopLossPct: 0.003,
    takeProfitPct: 0.011,
    trailActivationPct: 0.005,
    trailRetracePct: 0.002,
    minMoveBps: 6,
    minAccelBps: 2,
    minBidSupportRatio: 0.8,
    maxEntrySpreadBps: 180,
    minElapsedSec: 120,
    maxElapsedSec: 270,
    maxEntryPrice: 0.65,
    filterBreakoutBps: 4,
    filterConfirmMinutes: 6,
    entryPct: 1,
  },
  {
    key: "goldcat_filter_both_confirm3",
    family: "goldcat_filter",
    sideMode: "both",
    holdMinutes: 20,
    stopLossPct: 0.003,
    takeProfitPct: 0.009,
    trailActivationPct: 0.0045,
    trailRetracePct: 0.002,
    minMoveBps: 6,
    minAccelBps: 2,
    minBidSupportRatio: 0.8,
    maxEntrySpreadBps: 180,
    minElapsedSec: 120,
    maxElapsedSec: 240,
    maxEntryPrice: 0.65,
    filterBreakoutBps: 5,
    filterConfirmMinutes: 3,
    entryPct: 1,
  },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function minuteFloor(ts: number) {
  return Math.floor(ts / 60_000) * 60_000;
}

async function listInputFiles() {
  const names = await fs.readdir(DATA_DIR);
  return names.filter((name) => /^updown_lag_.*\.ndjson$/.test(name)).sort().map((name) => path.join(DATA_DIR, name));
}

async function loadGoldcatRows() {
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

async function fetchBinance(symbol: string, interval: "1m" | "15m", startMs: number, endMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = minuteFloor(startMs);
  while (cursor < endMs) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endMs}&limit=1000`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Binance ${interval} request failed: ${response.status}`);
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
  const dedup = new Map<number, Candle>();
  out.forEach((candle) => dedup.set(candle.ts, candle));
  return [...dedup.values()].sort((a, b) => a.ts - b.ts);
}

async function loadCachedBinance(symbol: string, interval: "1m" | "15m", startMs: number, endMs: number) {
  const filePath = path.join(CACHE_DIR, `${symbol}-${interval}-${minuteFloor(startMs)}-${minuteFloor(endMs)}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Candle[];
  } catch {
    const candles = await fetchBinance(symbol, interval, startMs, endMs);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(candles), "utf8");
    return candles;
  }
}

function ema(prev: number | null, value: number, period: number) {
  const alpha = 2 / (period + 1);
  return prev == null ? value : (value * alpha) + (prev * (1 - alpha));
}

function build15mFeatures(candles: Candle[]): Candle15m[] {
  const out: Candle15m[] = [];
  let ema20: number | null = null;
  let ema48: number | null = null;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    ema20 = ema(ema20, candle.close, 20);
    ema48 = ema(ema48, candle.close, 48);
    const prev = index >= 1 ? candles[index - 1] : null;
    const moveBps = prev ? ((candle.close / prev.close) - 1) * 10_000 : 0;
    const prevMove = index >= 2 ? ((candles[index - 1].close / candles[index - 2].close) - 1) * 10_000 : 0;
    const accelBps = moveBps - prevMove;
    const high3 = candles.slice(Math.max(0, index - 3), index).reduce((max, row) => Math.max(max, row.high), -Infinity);
    const low3 = candles.slice(Math.max(0, index - 3), index).reduce((min, row) => Math.min(min, row.low), Infinity);
    out.push({
      ...candle,
      ema20: ema20 ?? candle.close,
      ema48: ema48 ?? candle.close,
      moveBps,
      accelBps,
      high3: Number.isFinite(high3) ? high3 : candle.high,
      low3: Number.isFinite(low3) ? low3 : candle.low,
    });
  }
  return out;
}

function executionPrice(candles: Candle[], targetTs: number) {
  const execTs = Math.ceil(targetTs / 60_000) * 60_000;
  const candle = candles.find((row) => row.ts >= execTs);
  return candle ? { ts: candle.ts, price: candle.open } : null;
}

function runTrade(
  candles1m: Candle[],
  side: "long" | "short",
  signalTs: number,
  variant: Variant,
): Trade | null {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
  const holdMs = variant.holdMinutes * 60_000;
  const stop = side === "long"
    ? entry.price * (1 - variant.stopLossPct)
    : entry.price * (1 + variant.stopLossPct);
  const take = side === "long"
    ? entry.price * (1 + variant.takeProfitPct)
    : entry.price * (1 - variant.takeProfitPct);
  let peak = entry.price;
  let trough = entry.price;
  let exitPrice = entry.price;
  let exitTs = entry.ts;
  let reason = "time-stop";

  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > entry.ts + holdMs) break;
    peak = Math.max(peak, candle.high);
    trough = Math.min(trough, candle.low);
    const trail = side === "long"
      ? (peak >= entry.price * (1 + variant.trailActivationPct) ? peak * (1 - variant.trailRetracePct) : null)
      : (trough <= entry.price * (1 - variant.trailActivationPct) ? trough * (1 + variant.trailRetracePct) : null);
    if (side === "long" && candle.low <= stop) {
      exitPrice = stop;
      exitTs = candle.ts;
      reason = "stop";
      break;
    }
    if (side === "short" && candle.high >= stop) {
      exitPrice = stop;
      exitTs = candle.ts;
      reason = "stop";
      break;
    }
    if (side === "long" && candle.high >= take) {
      exitPrice = take;
      exitTs = candle.ts;
      reason = "take";
      break;
    }
    if (side === "short" && candle.low <= take) {
      exitPrice = take;
      exitTs = candle.ts;
      reason = "take";
      break;
    }
    if (trail != null && ((side === "long" && candle.low <= trail) || (side === "short" && candle.high >= trail))) {
      exitPrice = trail;
      exitTs = candle.ts;
      reason = "trail";
      break;
    }
    exitPrice = candle.close;
    exitTs = candle.ts;
  }

  const gross = side === "long" ? ((exitPrice / entry.price) - 1) : ((entry.price / exitPrice) - 1);
  const net = gross - (ASTER_TAKER_FEE_PER_SIDE * 2);
  const pnlUsd = STARTING_CASH_USD * variant.entryPct * net;
  return {
    side,
    entryTs: entry.ts,
    exitTs,
    entryPrice: entry.price,
    exitPrice,
    pnlUsd,
    pnlPct: net * 100,
    reason,
  };
}

function simulateStandalone(variant: Variant, candles15m: Candle15m[], candles1m: Candle[]) {
  const trades: Trade[] = [];
  for (const candle of candles15m.slice(50)) {
    const bullish = candle.close > candle.ema20 && candle.ema20 > candle.ema48;
    const bearish = candle.close < candle.ema20 && candle.ema20 < candle.ema48;
    if ((variant.sideMode === "long_only" || variant.sideMode === "both") &&
        bullish &&
        candle.moveBps >= variant.minMoveBps &&
        candle.accelBps >= variant.minAccelBps &&
        candle.close >= candle.high3) {
      const trade = runTrade(candles1m, "long", candle.ts + (15 * 60_000), variant);
      if (trade) trades.push(trade);
      continue;
    }
    if ((variant.sideMode === "short_only" || variant.sideMode === "both") &&
        bearish &&
        -candle.moveBps >= variant.minMoveBps &&
        -candle.accelBps >= variant.minAccelBps &&
        candle.close <= candle.low3) {
      const trade = runTrade(candles1m, "short", candle.ts + (15 * 60_000), variant);
      if (trade) trades.push(trade);
    }
  }
  return summarize(variant, trades);
}

function simulateGoldcatFilter(variant: Variant, rows: UpdownRow[], candles1m: Candle[]) {
  const trades: Trade[] = [];
  for (const row of rows) {
    if (row.elapsedSec < (variant.minElapsedSec || 0) || row.elapsedSec > (variant.maxElapsedSec || Number.MAX_SAFE_INTEGER)) continue;
    if (Math.abs(row.moveBps) < variant.minMoveBps) continue;
    const side = row.moveBps >= 0 ? "long" : "short";
    if (variant.sideMode === "long_only" && side !== "long") continue;
    if (variant.sideMode === "short_only" && side !== "short") continue;
    const book = side === "long" ? row.up : row.down;
    if (!book || !Number.isFinite(book.bestAsk) || book.bestAsk > (variant.maxEntryPrice || Infinity)) continue;
    if (Number(book.spreadBps || 9999) > (variant.maxEntrySpreadBps || 9999)) continue;
    const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
    if (bidSupportRatio < (variant.minBidSupportRatio || 0)) continue;

    const signalPrice = executionPrice(candles1m, row.ts)?.price;
    if (!signalPrice) continue;
    const confirmUntil = row.ts + ((variant.filterConfirmMinutes || 0) * 60_000);
    let confirmedTs: number | null = null;
    for (const candle of candles1m) {
      if (candle.ts < row.ts) continue;
      if (candle.ts > confirmUntil) break;
      const breakoutPct = (variant.filterBreakoutBps || 0) / 10_000;
      if (side === "long" && candle.high >= signalPrice * (1 + breakoutPct)) {
        confirmedTs = candle.ts;
        break;
      }
      if (side === "short" && candle.low <= signalPrice * (1 - breakoutPct)) {
        confirmedTs = candle.ts;
        break;
      }
    }
    if (!confirmedTs) continue;
    const trade = runTrade(candles1m, side, confirmedTs, variant);
    if (trade) trades.push(trade);
  }
  return summarize(variant, trades);
}

function summarize(variant: Variant, trades: Trade[]): Summary {
  let equity = STARTING_CASH_USD;
  let peak = STARTING_CASH_USD;
  let maxDd = 0;
  for (const trade of trades) {
    equity += trade.pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity / peak) - 1);
  }
  const pnlUsd = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  return {
    key: variant.key,
    family: variant.family,
    trades: trades.length,
    wins,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    pnlUsd,
    totalReturnPct: (pnlUsd / STARTING_CASH_USD) * 100,
    avgTradePct: trades.length ? trades.reduce((sum, trade) => sum + trade.pnlPct, 0) / trades.length : 0,
    maxDrawdownPct: maxDd * 100,
    tradesDetail: trades,
  };
}

async function writeReport(input: { start: string; end: string; summaries: Summary[] }) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, "result.json");
  const mdPath = path.join(REPORT_DIR, "result.md");
  const md = [
    "# BTC 15m Rebuild vs Filter",
    "",
    `- source window: ${input.start} to ${input.end}`,
    `- fee model: Aster taker 0.04% per side`,
    "",
    "| variant | family | return % | pnl usd | max DD % | trades | win rate % | avg trade % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...input.summaries.map((row) =>
      `| ${row.key} | ${row.family} | ${round(row.totalReturnPct, 4)} | ${round(row.pnlUsd, 4)} | ${round(row.maxDrawdownPct, 4)} | ${row.trades} | ${round(row.winRatePct, 2)} | ${round(row.avgTradePct, 4)} |`
    ),
  ].join("\n");
  await fs.writeFile(jsonPath, JSON.stringify(input, null, 2), "utf8");
  await fs.writeFile(mdPath, md, "utf8");
}

async function main() {
  const goldcatRows = await loadGoldcatRows();
  const startMs = Math.min(...goldcatRows.map((row) => row.ts)) - 60 * 60 * 1000;
  const endMs = Math.max(...goldcatRows.map((row) => row.ts + (row.horizonSec * 1000))) + 60 * 60 * 1000;
  const [candles1m, candles15mBase] = await Promise.all([
    loadCachedBinance("BTCUSDT", "1m", startMs, endMs),
    loadCachedBinance("BTCUSDT", "15m", startMs - (15 * 60_000 * 80), endMs),
  ]);
  const candles15m = build15mFeatures(candles15mBase);

  const summaries = VARIANTS.map((variant) =>
    variant.family === "standalone"
      ? simulateStandalone(variant, candles15m, candles1m)
      : simulateGoldcatFilter(variant, goldcatRows, candles1m)
  ).sort((a, b) => b.pnlUsd - a.pnlUsd);

  await writeReport({
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    summaries: summaries.map((summary) => ({ ...summary, tradesDetail: summary.tradesDetail.slice(0, 25) })),
  });

  console.log(JSON.stringify(summaries.map((summary) => ({
    key: summary.key,
    family: summary.family,
    trades: summary.trades,
    winRatePct: round(summary.winRatePct, 2),
    pnlUsd: round(summary.pnlUsd, 4),
    totalReturnPct: round(summary.totalReturnPct, 4),
    maxDrawdownPct: round(summary.maxDrawdownPct, 4),
    avgTradePct: round(summary.avgTradePct, 4),
  })), null, 2));
}

main().catch((error) => {
  console.error("[backtest-btc15m-rebuild-vs-filter] failed:", error);
  process.exitCode = 1;
});
