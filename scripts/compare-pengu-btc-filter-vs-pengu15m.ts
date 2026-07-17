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

type Trade = {
  pnlUsd: number;
  pnlPct: number;
  exitTs: number;
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
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const CACHE_DIR = path.join(process.cwd(), ".cache", "pengu-family-compare");
const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-family-compare");
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
  holdMinutes: 20,
  stopLossPct: 0.004,
  takeProfitPct: 0.015,
  trailActivationPct: 0.008,
  trailRetracePct: 0.004,
  filterBreakoutBps: 8,
  filterConfirmMinutes: 4,
};

type FamilyVariant =
  | {
      key: string;
      family: "btc_goldcat_filter";
    }
  | {
      key: string;
      family: "pengu_15m_direct" | "pengu_15m_with_btc_riskoff" | "btc_goldcat_plus_pengu_15m";
      minMoveBps: number;
      minAccelBps: number;
      confirmBps: number;
      confirmMinutes: number;
      holdMinutes: number;
      stopLossPct: number;
      takeProfitPct: number;
      trailActivationPct: number;
      trailRetracePct: number;
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
  holdMinutes: number,
  stopLossPct: number,
  takeProfitPct: number,
  trailActivationPct: number,
  trailRetracePct: number,
): Trade | null {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
  const stop = side === "long"
    ? entry.price * (1 - stopLossPct)
    : entry.price * (1 + stopLossPct);
  const take = side === "long"
    ? entry.price * (1 + takeProfitPct)
    : entry.price * (1 - takeProfitPct);
  let peak = entry.price;
  let trough = entry.price;
  let exitPrice = entry.price;
  let exitTs = entry.ts;
  const holdUntil = entry.ts + (holdMinutes * 60_000);

  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    trough = Math.min(trough, candle.low);
    const trail = side === "long"
      ? (peak >= entry.price * (1 + trailActivationPct) ? peak * (1 - trailRetracePct) : null)
      : (trough <= entry.price * (1 - trailActivationPct) ? trough * (1 + trailRetracePct) : null);
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

function summarize(key: string, family: string, trades: Trade[]): Summary {
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
    family,
    trades: trades.length,
    wins,
    winRatePct: round(winRatePct, 2),
    pnlUsd: round(pnlUsd, 4),
    totalReturnPct: round((equity / STARTING_CASH_USD - 1) * 100, 4),
    avgTradePct: round(avgTradePct, 4),
    maxDrawdownPct: round(maxDd * 100, 4),
  };
}

function simulateBtcGoldcatFilter(rows: UpdownRow[], pengu1m: Candle[]) {
  const trades: Trade[] = [];
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

    const signalPrice = executionPrice(pengu1m, row.ts)?.price;
    if (!signalPrice) continue;
    const confirmUntil = row.ts + (BTC_FILTER_BEST.filterConfirmMinutes * 60_000);
    const breakoutPct = BTC_FILTER_BEST.filterBreakoutBps / 10_000;
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
    const trade = runTrade(
      pengu1m,
      side,
      confirmedTs,
      BTC_FILTER_BEST.holdMinutes,
      BTC_FILTER_BEST.stopLossPct,
      BTC_FILTER_BEST.takeProfitPct,
      BTC_FILTER_BEST.trailActivationPct,
      BTC_FILTER_BEST.trailRetracePct,
    );
    if (!trade) continue;
    trades.push(trade);
    lastExitTs = trade.exitTs;
  }
  return summarize("btc_goldcat_filter_best", "btc_goldcat_filter", trades);
}

function confirmBreakout(
  candles1m: Candle[],
  signalTs: number,
  side: "long" | "short",
  confirmBps: number,
  confirmMinutes: number,
) {
  const signalPrice = executionPrice(candles1m, signalTs)?.price;
  if (!signalPrice) return null;
  const until = signalTs + (confirmMinutes * 60_000);
  const breakoutPct = confirmBps / 10_000;
  for (const candle of candles1m) {
    if (candle.ts < signalTs) continue;
    if (candle.ts > until) break;
    if (side === "long" && candle.high >= signalPrice * (1 + breakoutPct)) return candle.ts;
    if (side === "short" && candle.low <= signalPrice * (1 - breakoutPct)) return candle.ts;
  }
  return null;
}

function simulatePenguDirect(
  variant: Extract<FamilyVariant, { family: "pengu_15m_direct" | "pengu_15m_with_btc_riskoff" | "btc_goldcat_plus_pengu_15m" }>,
  pengu15m: Candle15m[],
  btc15mMap: Map<number, Candle15m>,
  pengu1m: Candle[],
) {
  const trades: Trade[] = [];
  let lastExitTs = -Infinity;

  for (const candle of pengu15m.slice(50)) {
    if (candle.ts < lastExitTs) continue;
    const bullish = candle.close > candle.ema20 && candle.ema20 > candle.ema48 && candle.close >= candle.high3;
    const bearish = candle.close < candle.ema20 && candle.ema20 < candle.ema48 && candle.close <= candle.low3;
    let side: "long" | "short" | null = null;
    if (bullish && candle.moveBps >= variant.minMoveBps && candle.accelBps >= variant.minAccelBps) side = "long";
    if (bearish && -candle.moveBps >= variant.minMoveBps && -candle.accelBps >= variant.minAccelBps) side = "short";
    if (!side) continue;

    if (variant.family === "pengu_15m_with_btc_riskoff" || variant.family === "btc_goldcat_plus_pengu_15m") {
      const btc = btc15mMap.get(candle.ts);
      if (!btc) continue;
      const btcBullish = btc.close > btc.ema20;
      const btcBearish = btc.close < btc.ema20;
      if (side === "long" && !btcBullish) continue;
      if (side === "short" && !btcBearish) continue;
    }

    const confirmedTs = confirmBreakout(pengu1m, candle.ts + (15 * 60_000), side, variant.confirmBps, variant.confirmMinutes);
    if (!confirmedTs) continue;
    const trade = runTrade(
      pengu1m,
      side,
      confirmedTs,
      variant.holdMinutes,
      variant.stopLossPct,
      variant.takeProfitPct,
      variant.trailActivationPct,
      variant.trailRetracePct,
    );
    if (!trade) continue;
    trades.push(trade);
    lastExitTs = trade.exitTs;
  }

  return summarize(variant.key, variant.family, trades);
}

function buildPenguSignalMap(
  pengu15m: Candle15m[],
  variants: Extract<FamilyVariant, { family: "btc_goldcat_plus_pengu_15m" }>[],
): Map<string, Array<{ ts: number; side: "long" | "short" }>> {
  const out = new Map<string, Array<{ ts: number; side: "long" | "short" }>>();
  for (const variant of variants) {
    const signals: Array<{ ts: number; side: "long" | "short" }> = [];
    for (const candle of pengu15m.slice(50)) {
      const bullish = candle.close > candle.ema20 && candle.ema20 > candle.ema48 && candle.close >= candle.high3;
      const bearish = candle.close < candle.ema20 && candle.ema20 < candle.ema48 && candle.close <= candle.low3;
      if (bullish && candle.moveBps >= variant.minMoveBps && candle.accelBps >= variant.minAccelBps) {
        signals.push({ ts: candle.ts, side: "long" });
      } else if (bearish && -candle.moveBps >= variant.minMoveBps && -candle.accelBps >= variant.minAccelBps) {
        signals.push({ ts: candle.ts, side: "short" });
      }
    }
    out.set(variant.key, signals);
  }
  return out;
}

function latestPenguSignalBefore(
  signals: Array<{ ts: number; side: "long" | "short" }>,
  targetTs: number,
) {
  let latest: { ts: number; side: "long" | "short" } | null = null;
  for (const signal of signals) {
    if (signal.ts > targetTs) break;
    latest = signal;
  }
  return latest;
}

function simulateBtcGoldcatPlusPengu(
  variant: Extract<FamilyVariant, { family: "btc_goldcat_plus_pengu_15m" }>,
  rows: UpdownRow[],
  pengu1m: Candle[],
  penguSignals: Array<{ ts: number; side: "long" | "short" }>,
) {
  const trades: Trade[] = [];
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

    const alignedSignal = latestPenguSignalBefore(penguSignals, row.ts);
    if (!alignedSignal || alignedSignal.side !== side) continue;
    if (row.ts - alignedSignal.ts > (15 * 60_000)) continue;

    const signalPrice = executionPrice(pengu1m, row.ts)?.price;
    if (!signalPrice) continue;
    const confirmUntil = row.ts + (Math.max(BTC_FILTER_BEST.filterConfirmMinutes, variant.confirmMinutes) * 60_000);
    const breakoutPct = Math.max(BTC_FILTER_BEST.filterBreakoutBps, variant.confirmBps) / 10_000;
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
    const trade = runTrade(
      pengu1m,
      side,
      confirmedTs,
      variant.holdMinutes,
      variant.stopLossPct,
      variant.takeProfitPct,
      variant.trailActivationPct,
      variant.trailRetracePct,
    );
    if (!trade) continue;
    trades.push(trade);
    lastExitTs = trade.exitTs;
  }

  return summarize(variant.key, variant.family, trades);
}

function buildDirectVariants() {
  const variants: FamilyVariant[] = [];
  const families: Array<"pengu_15m_direct" | "pengu_15m_with_btc_riskoff" | "btc_goldcat_plus_pengu_15m"> = ["pengu_15m_direct", "pengu_15m_with_btc_riskoff", "btc_goldcat_plus_pengu_15m"];
  const minMoveBps = [8, 12, 16, 20, 30];
  const minAccelBps = [2, 4, 6, 10];
  const confirmBps = [3, 5, 8, 10];
  const confirmMinutes = [2, 3, 4, 5];
  const holdMinutes = [15, 20, 25];
  const stopLossPct = [0.004, 0.005];
  const takeProfitPct = [0.012, 0.015, 0.02];
  const trailActivationPct = [0.008, 0.01];
  const trailRetracePct = [0.004, 0.005];

  for (const family of families) {
    for (const move of minMoveBps) {
      for (const accel of minAccelBps) {
        for (const confirm of confirmBps) {
          for (const confirmMin of confirmMinutes) {
            for (const hold of holdMinutes) {
              for (const stop of stopLossPct) {
                for (const take of takeProfitPct) {
                  for (const trailAct of trailActivationPct) {
                    for (const trailRet of trailRetracePct) {
                      if (trailRet >= trailAct) continue;
                      variants.push({
                        key: `${family}_m${move}_a${accel}_cb${confirm}_cm${confirmMin}_h${hold}_sl${stop}_tp${take}_ta${trailAct}_tr${trailRet}`,
                        family,
                        minMoveBps: move,
                        minAccelBps: accel,
                        confirmBps: confirm,
                        confirmMinutes: confirmMin,
                        holdMinutes: hold,
                        stopLossPct: stop,
                        takeProfitPct: take,
                        trailActivationPct: trailAct,
                        trailRetracePct: trailRet,
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

  const [pengu1m, pengu15mRaw, btc15mRaw] = await Promise.all([
    loadCachedBinance(EXECUTION_SYMBOL, "1m", startMs, endMs),
    loadCachedBinance(EXECUTION_SYMBOL, "15m", startMs, endMs),
    loadCachedBinance("BTCUSDT", "15m", startMs, endMs),
  ]);

  const pengu15m = build15mFeatures(pengu15mRaw);
  const btc15m = build15mFeatures(btc15mRaw);
  const btc15mMap = new Map(btc15m.map((row) => [row.ts, row]));

  const summaries: Summary[] = [];
  summaries.push(simulateBtcGoldcatFilter(rows, pengu1m));

  const directVariants = buildDirectVariants();
  const comboVariants = directVariants.filter((variant): variant is Extract<FamilyVariant, { family: "btc_goldcat_plus_pengu_15m" }> => variant.family === "btc_goldcat_plus_pengu_15m");
  const comboSignalMap = buildPenguSignalMap(pengu15m, comboVariants);

  for (const variant of directVariants) {
    const summary = variant.family === "btc_goldcat_plus_pengu_15m"
      ? simulateBtcGoldcatPlusPengu(variant, rows, pengu1m, comboSignalMap.get(variant.key) || [])
      : simulatePenguDirect(variant, pengu15m, btc15mMap, pengu1m);
    if (summary.trades >= 5) summaries.push(summary);
  }

  const bestByFamily = new Map<string, Summary>();
  for (const summary of summaries) {
    const current = bestByFamily.get(summary.family);
    if (!current || summary.pnlUsd > current.pnlUsd) bestByFamily.set(summary.family, summary);
  }
  const ranked = [...summaries].sort((a, b) => b.pnlUsd - a.pnlUsd);

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        window: {
          first: new Date(startMs).toISOString(),
          last: new Date(rows.at(-1)!.ts).toISOString(),
        },
        executionSymbol: EXECUTION_SYMBOL,
        bestByFamily: Object.fromEntries([...bestByFamily.entries()]),
        top20: ranked.slice(0, 20),
      },
      null,
      2,
    ),
    "utf8",
  );

  const markdown = [
    "# PENGU Family Compare",
    "",
    `- window: ${new Date(startMs).toISOString()} to ${new Date(rows.at(-1)!.ts).toISOString()}`,
    `- execution symbol: ${EXECUTION_SYMBOL}`,
    "",
    "## Best By Family",
    "",
    "| family | variant | return % | pnl usd | max DD % | trades | win rate % | avg trade % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...[...bestByFamily.values()].map((row) => `| ${row.family} | ${row.key} | ${row.totalReturnPct} | ${row.pnlUsd} | ${row.maxDrawdownPct} | ${row.trades} | ${row.winRatePct} | ${row.avgTradePct} |`),
    "",
    "## Top 20",
    "",
    "| family | variant | return % | pnl usd | max DD % | trades | win rate % | avg trade % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...ranked.slice(0, 20).map((row) => `| ${row.family} | ${row.key} | ${row.totalReturnPct} | ${row.pnlUsd} | ${row.maxDrawdownPct} | ${row.trades} | ${row.winRatePct} | ${row.avgTradePct} |`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), markdown, "utf8");

  console.log(JSON.stringify({
    bestByFamily: Object.fromEntries([...bestByFamily.entries()]),
    top10: ranked.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
