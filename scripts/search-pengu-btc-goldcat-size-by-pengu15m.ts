import fs from "fs/promises";
import path from "path";

type UpdownRow = {
  ts: number;
  coin: string;
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
  weakAlignedSize: number;
  strongAlignedSize: number;
  unalignedSize: number;
  strongMoveBps: number;
  strongAccelBps: number;
};

type Summary = {
  key: string;
  trades: number;
  wins: number;
  winRatePct: number;
  pnlUsd: number;
  totalReturnPct: number;
  avgTradePct: number;
  maxDrawdownPct: number;
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const CACHE_DIR = path.join(process.cwd(), ".cache", "pengu-family-compare");
const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-btc-goldcat-size-by-pengu15m");
const EXECUTION_SYMBOL = "PENGUUSDT";
const STARTING_CASH_USD = 100;
const ASTER_TAKER_FEE_PER_SIDE = 0.0004;

const ENTRY = {
  minMoveBps: 5,
  minBidSupportRatio: 0.8,
  maxEntrySpreadBps: 180,
  minElapsedSec: 90,
  maxElapsedSec: 240,
  maxEntryPrice: 0.6,
  filterBreakoutBps: 8,
  filterConfirmMinutes: 4,
};

const EXIT = {
  holdMinutes: 20,
  stopLossPct: 0.004,
  takeProfitPct: 0.015,
  trailActivationPct: 0.008,
  trailRetracePct: 0.004,
};

function minuteFloor(ts: number) {
  return Math.floor(ts / 60_000) * 60_000;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
    if (!response.ok) throw new Error(`Binance ${symbol} ${interval} request failed: ${response.status}`);
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

function runTrade(candles1m: Candle[], side: "long" | "short", signalTs: number) {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
  const stop = side === "long" ? entry.price * (1 - EXIT.stopLossPct) : entry.price * (1 + EXIT.stopLossPct);
  const take = side === "long" ? entry.price * (1 + EXIT.takeProfitPct) : entry.price * (1 - EXIT.takeProfitPct);
  let peak = entry.price;
  let trough = entry.price;
  let exitPrice = entry.price;
  let exitTs = entry.ts;
  const holdUntil = entry.ts + (EXIT.holdMinutes * 60_000);

  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    trough = Math.min(trough, candle.low);
    const trail = side === "long"
      ? (peak >= entry.price * (1 + EXIT.trailActivationPct) ? peak * (1 - EXIT.trailRetracePct) : null)
      : (trough <= entry.price * (1 - EXIT.trailActivationPct) ? trough * (1 + EXIT.trailRetracePct) : null);
    if (side === "long" && candle.low <= stop) { exitPrice = stop; exitTs = candle.ts; break; }
    if (side === "short" && candle.high >= stop) { exitPrice = stop; exitTs = candle.ts; break; }
    if (side === "long" && candle.high >= take) { exitPrice = take; exitTs = candle.ts; break; }
    if (side === "short" && candle.low <= take) { exitPrice = take; exitTs = candle.ts; break; }
    if (trail != null && ((side === "long" && candle.low <= trail) || (side === "short" && candle.high >= trail))) {
      exitPrice = trail; exitTs = candle.ts; break;
    }
    exitPrice = candle.close;
    exitTs = candle.ts;
  }

  const gross = side === "long" ? ((exitPrice / entry.price) - 1) : ((entry.price / exitPrice) - 1);
  const net = gross - (ASTER_TAKER_FEE_PER_SIDE * 2);
  return { net, exitTs };
}

function latestPengu15m(pengu15m: Candle15m[], targetTs: number) {
  let latest: Candle15m | null = null;
  for (const candle of pengu15m) {
    if (candle.ts > targetTs) break;
    latest = candle;
  }
  return latest;
}

function sizeMultiplier(side: "long" | "short", candle: Candle15m | null, variant: Variant) {
  if (!candle) return 1;
  const bullish = candle.close > candle.ema20 && candle.ema20 > candle.ema48 && candle.close >= candle.high3;
  const bearish = candle.close < candle.ema20 && candle.ema20 < candle.ema48 && candle.close <= candle.low3;
  const aligned = (side === "long" && bullish) || (side === "short" && bearish);
  if (!aligned) return variant.unalignedSize;

  const strongLong = bullish && candle.moveBps >= variant.strongMoveBps && candle.accelBps >= variant.strongAccelBps;
  const strongShort = bearish && -candle.moveBps >= variant.strongMoveBps && -candle.accelBps >= variant.strongAccelBps;
  return (strongLong || strongShort) ? variant.strongAlignedSize : variant.weakAlignedSize;
}

function simulate(variant: Variant, rows: UpdownRow[], candles1m: Candle[], pengu15m: Candle15m[]) {
  const trades: Array<{ pnlUsd: number; pnlPct: number }> = [];
  let lastExitTs = -Infinity;
  for (const row of rows) {
    if (row.ts < lastExitTs) continue;
    if (row.elapsedSec < ENTRY.minElapsedSec || row.elapsedSec > ENTRY.maxElapsedSec) continue;
    if (Math.abs(row.moveBps) < ENTRY.minMoveBps) continue;
    const side = row.moveBps >= 0 ? "long" : "short";
    const book = side === "long" ? row.up : row.down;
    if (!book || !Number.isFinite(book.bestAsk) || Number(book.bestAsk) > ENTRY.maxEntryPrice) continue;
    if (Number(book.spreadBps || 9999) > ENTRY.maxEntrySpreadBps) continue;
    const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
    if (bidSupportRatio < ENTRY.minBidSupportRatio) continue;

    const signalPrice = executionPrice(candles1m, row.ts)?.price;
    if (!signalPrice) continue;
    const confirmUntil = row.ts + (ENTRY.filterConfirmMinutes * 60_000);
    const breakoutPct = ENTRY.filterBreakoutBps / 10_000;
    let confirmedTs: number | null = null;
    for (const candle of candles1m) {
      if (candle.ts < row.ts) continue;
      if (candle.ts > confirmUntil) break;
      if (side === "long" && candle.high >= signalPrice * (1 + breakoutPct)) { confirmedTs = candle.ts; break; }
      if (side === "short" && candle.low <= signalPrice * (1 - breakoutPct)) { confirmedTs = candle.ts; break; }
    }
    if (!confirmedTs) continue;

    const trade = runTrade(candles1m, side, confirmedTs);
    if (!trade) continue;
    const penguState = latestPengu15m(pengu15m, row.ts);
    const size = sizeMultiplier(side, penguState, variant);
    trades.push({ pnlUsd: STARTING_CASH_USD * trade.net * size, pnlPct: trade.net * 100 * size });
    lastExitTs = trade.exitTs;
  }

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
  const winRatePct = trades.length ? (wins / trades.length) * 100 : 0;
  const avgTradePct = trades.length ? trades.reduce((sum, trade) => sum + trade.pnlPct, 0) / trades.length : 0;

  return {
    key: variant.key,
    trades: trades.length,
    wins,
    winRatePct: round(winRatePct, 2),
    pnlUsd: round(pnlUsd, 4),
    totalReturnPct: round((equity / STARTING_CASH_USD - 1) * 100, 4),
    avgTradePct: round(avgTradePct, 4),
    maxDrawdownPct: round(maxDd * 100, 4),
  } satisfies Summary;
}

function buildVariants() {
  const variants: Variant[] = [];
  const weakAlignedSize = [1.0, 1.1, 1.25];
  const strongAlignedSize = [1.25, 1.5, 1.75, 2.0];
  const unalignedSize = [0.4, 0.5, 0.6, 0.75, 1.0];
  const strongMoveBps = [8, 12, 16];
  const strongAccelBps = [2, 4, 6];

  for (const weak of weakAlignedSize) {
    for (const strong of strongAlignedSize) {
      if (strong < weak) continue;
      for (const unaligned of unalignedSize) {
        for (const move of strongMoveBps) {
          for (const accel of strongAccelBps) {
            variants.push({
              key: `weak${weak}_strong${strong}_unaligned${unaligned}_m${move}_a${accel}`,
              weakAlignedSize: weak,
              strongAlignedSize: strong,
              unalignedSize: unaligned,
              strongMoveBps: move,
              strongAccelBps: accel,
            });
          }
        }
      }
    }
  }
  return variants;
}

async function main() {
  const rows = await loadGoldcatRows();
  const startMs = rows[0].ts;
  const endMs = rows.at(-1)!.ts + (60 * 60_000);
  const [candles1m, pengu15mRaw] = await Promise.all([
    loadCachedBinance(EXECUTION_SYMBOL, "1m", startMs, endMs),
    loadCachedBinance(EXECUTION_SYMBOL, "15m", startMs, endMs),
  ]);
  const pengu15m = build15mFeatures(pengu15mRaw);

  const results = buildVariants().map((variant) => simulate(variant, rows, candles1m, pengu15m)).sort((a, b) => b.pnlUsd - a.pnlUsd);

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    entry: ENTRY,
    exit: EXIT,
    top20: results.slice(0, 20),
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), [
    "# PENGU BTC GoldCat Size by PENGU 15m",
    "",
    "| variant | return % | pnl usd | max DD % | trades | win rate % | avg trade % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.slice(0, 20).map((row) => `| ${row.key} | ${row.totalReturnPct} | ${row.pnlUsd} | ${row.maxDrawdownPct} | ${row.trades} | ${row.winRatePct} | ${row.avgTradePct} |`),
    "",
  ].join("\n"), "utf8");
  console.log(JSON.stringify(results.slice(0, 10), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
