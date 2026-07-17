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
  penguMoveBps: number;
  penguAccelBps: number;
  confirmBps: number;
  confirmMinutes: number;
  holdMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  maxPenguSignalAgeMinutes: number;
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const CACHE_DIR = path.join(process.cwd(), ".cache", "pengu-family-compare");
const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-btc-goldcat-plus-pengu15m");
const STARTING_CASH_USD = 100;
const ASTER_TAKER_FEE_PER_SIDE = 0.0004;
const EXECUTION_SYMBOL = "PENGUUSDT";

const BTC_FILTER_BEST = {
  minMoveBps: 5,
  minBidSupportRatio: 0.8,
  maxEntrySpreadBps: 180,
  minElapsedSec: 90,
  maxElapsedSec: 240,
  maxEntryPrice: 0.6,
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

function runTrade(
  candles1m: Candle[],
  side: "long" | "short",
  signalTs: number,
  variant: Variant,
) {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
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
  const holdUntil = entry.ts + (variant.holdMinutes * 60_000);

  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    trough = Math.min(trough, candle.low);
    const trail = side === "long"
      ? (peak >= entry.price * (1 + variant.trailActivationPct) ? peak * (1 - variant.trailRetracePct) : null)
      : (trough <= entry.price * (1 - variant.trailActivationPct) ? trough * (1 + variant.trailRetracePct) : null);
    if (side === "long" && candle.low <= stop) {
      exitPrice = stop;
      exitTs = candle.ts;
      break;
    }
    if (side === "short" && candle.high >= stop) {
      exitPrice = stop;
      exitTs = candle.ts;
      break;
    }
    if (side === "long" && candle.high >= take) {
      exitPrice = take;
      exitTs = candle.ts;
      break;
    }
    if (side === "short" && candle.low <= take) {
      exitPrice = take;
      exitTs = candle.ts;
      break;
    }
    if (trail != null && ((side === "long" && candle.low <= trail) || (side === "short" && candle.high >= trail))) {
      exitPrice = trail;
      exitTs = candle.ts;
      break;
    }
    exitPrice = candle.close;
    exitTs = candle.ts;
  }

  const gross = side === "long" ? ((exitPrice / entry.price) - 1) : ((entry.price / exitPrice) - 1);
  const net = gross - (ASTER_TAKER_FEE_PER_SIDE * 2);
  return { pnlUsd: STARTING_CASH_USD * net, pnlPct: net * 100, exitTs };
}

function buildPenguSignals(pengu15m: Candle15m[], variant: Variant) {
  const signals: Array<{ ts: number; side: "long" | "short" }> = [];
  for (const candle of pengu15m.slice(50)) {
    const bullish = candle.close > candle.ema20 && candle.ema20 > candle.ema48 && candle.close >= candle.high3;
    const bearish = candle.close < candle.ema20 && candle.ema20 < candle.ema48 && candle.close <= candle.low3;
    if (bullish && candle.moveBps >= variant.penguMoveBps && candle.accelBps >= variant.penguAccelBps) {
      signals.push({ ts: candle.ts, side: "long" });
    } else if (bearish && -candle.moveBps >= variant.penguMoveBps && -candle.accelBps >= variant.penguAccelBps) {
      signals.push({ ts: candle.ts, side: "short" });
    }
  }
  return signals;
}

function latestSignalBefore(signals: Array<{ ts: number; side: "long" | "short" }>, targetTs: number) {
  let latest: { ts: number; side: "long" | "short" } | null = null;
  for (const signal of signals) {
    if (signal.ts > targetTs) break;
    latest = signal;
  }
  return latest;
}

function summarize(key: string, trades: Array<{ pnlUsd: number; pnlPct: number }>) {
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
    key,
    trades: trades.length,
    wins,
    winRatePct: round(winRatePct, 2),
    pnlUsd: round(pnlUsd, 4),
    totalReturnPct: round((equity / STARTING_CASH_USD - 1) * 100, 4),
    avgTradePct: round(avgTradePct, 4),
    maxDrawdownPct: round(maxDd * 100, 4),
  };
}

function simulate(
  variant: Variant,
  rows: UpdownRow[],
  penguSignals: Array<{ ts: number; side: "long" | "short" }>,
  pengu1m: Candle[],
) {
  const trades: Array<{ pnlUsd: number; pnlPct: number }> = [];
  let lastExitTs = -Infinity;

  for (const row of rows) {
    if (row.ts < lastExitTs) continue;
    if (row.elapsedSec < BTC_FILTER_BEST.minElapsedSec || row.elapsedSec > BTC_FILTER_BEST.maxElapsedSec) continue;
    if (Math.abs(row.moveBps) < BTC_FILTER_BEST.minMoveBps) continue;
    const side = row.moveBps >= 0 ? "long" : "short";
    const book = side === "long" ? row.up : row.down;
    if (!book || !Number.isFinite(book.bestAsk) || Number(book.bestAsk) > BTC_FILTER_BEST.maxEntryPrice) continue;
    if (Number(book.spreadBps || 9999) > BTC_FILTER_BEST.maxEntrySpreadBps) continue;
    const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
    if (bidSupportRatio < BTC_FILTER_BEST.minBidSupportRatio) continue;

    const penguSignal = latestSignalBefore(penguSignals, row.ts);
    if (!penguSignal || penguSignal.side !== side) continue;
    if (row.ts - penguSignal.ts > (variant.maxPenguSignalAgeMinutes * 60_000)) continue;

    const signalPrice = executionPrice(pengu1m, row.ts)?.price;
    if (!signalPrice) continue;
    const confirmUntil = row.ts + (variant.confirmMinutes * 60_000);
    const breakoutPct = variant.confirmBps / 10_000;
    let confirmedTs: number | null = null;
    for (const candle of pengu1m) {
      if (candle.ts < row.ts) continue;
      if (candle.ts > confirmUntil) break;
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
    const trade = runTrade(pengu1m, side, confirmedTs, variant);
    if (!trade) continue;
    trades.push(trade);
    lastExitTs = trade.exitTs;
  }

  return summarize(variant.key, trades);
}

function buildVariants() {
  const variants: Variant[] = [];
  const penguMoveBps = [4, 6, 8, 10];
  const penguAccelBps = [1, 2, 4];
  const confirmBps = [5, 8, 10];
  const confirmMinutes = [2, 3, 4];
  const holdMinutes = [15, 20];
  const stopLossPct = [0.004, 0.005];
  const takeProfitPct = [0.012, 0.015, 0.02];
  const trailActivationPct = [0.008, 0.01];
  const trailRetracePct = [0.004, 0.005];
  const maxPenguSignalAgeMinutes = [15, 30, 45];

  for (const move of penguMoveBps) {
    for (const accel of penguAccelBps) {
      for (const confirm of confirmBps) {
        for (const confirmMin of confirmMinutes) {
          for (const hold of holdMinutes) {
            for (const stop of stopLossPct) {
              for (const take of takeProfitPct) {
                for (const trailAct of trailActivationPct) {
                  for (const trailRet of trailRetracePct) {
                    if (trailRet >= trailAct) continue;
                    for (const age of maxPenguSignalAgeMinutes) {
                      variants.push({
                        key: `m${move}_a${accel}_cb${confirm}_cm${confirmMin}_h${hold}_sl${stop}_tp${take}_ta${trailAct}_tr${trailRet}_age${age}`,
                        penguMoveBps: move,
                        penguAccelBps: accel,
                        confirmBps: confirm,
                        confirmMinutes: confirmMin,
                        holdMinutes: hold,
                        stopLossPct: stop,
                        takeProfitPct: take,
                        trailActivationPct: trailAct,
                        trailRetracePct: trailRet,
                        maxPenguSignalAgeMinutes: age,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return variants;
}

async function main() {
  const rows = await loadGoldcatRows();
  if (!rows.length) throw new Error("No BTC 15m GoldCat rows found.");
  const startMs = rows[0].ts;
  const endMs = rows.at(-1)!.ts + (60 * 60_000);

  const [pengu1m, pengu15mRaw] = await Promise.all([
    loadCachedBinance(EXECUTION_SYMBOL, "1m", startMs, endMs),
    loadCachedBinance(EXECUTION_SYMBOL, "15m", startMs, endMs),
  ]);
  const pengu15m = build15mFeatures(pengu15mRaw);

  const results = buildVariants().map((variant) => {
    const signals = buildPenguSignals(pengu15m, variant);
    return simulate(variant, rows, signals, pengu1m);
  }).sort((a, b) => b.pnlUsd - a.pnlUsd);

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      top20: results.slice(0, 20),
    }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# PENGU + BTC GoldCat Combo Search",
      "",
      "| variant | return % | pnl usd | max DD % | trades | win rate % | avg trade % |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...results.slice(0, 20).map((row) => `| ${row.key} | ${row.totalReturnPct} | ${row.pnlUsd} | ${row.maxDrawdownPct} | ${row.trades} | ${row.winRatePct} | ${row.avgTradePct} |`),
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify(results.slice(0, 10), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
