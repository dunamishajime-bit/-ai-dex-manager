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
};

type Variant = {
  key: string;
  sideMode: "long_only" | "both";
  holdMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  filterBreakoutBps: number;
  filterConfirmMinutes: number;
};

type Trade = {
  pnlUsd: number;
};

type Summary = {
  key: string;
  sideMode: string;
  trades: number;
  wins: number;
  winRatePct: number;
  pnlUsd: number;
  totalReturnPct: number;
  avgTradePct: number;
  maxDrawdownPct: number;
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const CACHE_DIR = path.join(process.cwd(), ".cache", "btc15m-rebuild");
const REPORT_DIR = path.join(process.cwd(), "reports", "btc15m-goldcat-filter-search");
const STARTING_CASH_USD = 100;
const ASTER_TAKER_FEE_PER_SIDE = 0.0004;

const BASE_FILTER = {
  minMoveBps: 6,
  minAccelBps: 2,
  minBidSupportRatio: 0.8,
  maxEntrySpreadBps: 180,
  minElapsedSec: 120,
  maxElapsedSec: 240,
  maxEntryPrice: 0.65,
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

async function fetchBinance(symbol: string, interval: "1m", startMs: number, endMs: number): Promise<Candle[]> {
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

async function loadCachedBinance(symbol: string, interval: "1m", startMs: number, endMs: number) {
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
  const pnlUsd = STARTING_CASH_USD * net;
  return { pnlUsd, pnlPct: net * 100, exitTs };
}

function simulate(variant: Variant, rows: UpdownRow[], candles1m: Candle[]) {
  const trades: { pnlUsd: number; pnlPct: number }[] = [];
  let lastExitTs = -Infinity;

  for (const row of rows) {
    if (row.ts < lastExitTs) continue;
    if (row.elapsedSec < BASE_FILTER.minElapsedSec || row.elapsedSec > BASE_FILTER.maxElapsedSec) continue;
    if (Math.abs(row.moveBps) < BASE_FILTER.minMoveBps) continue;
    const side = row.moveBps >= 0 ? "long" : "short";
    if (variant.sideMode === "long_only" && side !== "long") continue;

    const book = side === "long" ? row.up : row.down;
    if (!book || !Number.isFinite(book.bestAsk) || Number(book.bestAsk) > BASE_FILTER.maxEntryPrice) continue;
    if (Number(book.spreadBps || 9999) > BASE_FILTER.maxEntrySpreadBps) continue;
    const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
    if (bidSupportRatio < BASE_FILTER.minBidSupportRatio) continue;

    const signalPrice = executionPrice(candles1m, row.ts)?.price;
    if (!signalPrice) continue;
    const confirmUntil = row.ts + (variant.filterConfirmMinutes * 60_000);
    let confirmedTs: number | null = null;
    const breakoutPct = variant.filterBreakoutBps / 10_000;

    for (const candle of candles1m) {
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
    const trade = runTrade(candles1m, side, confirmedTs, variant);
    if (!trade) continue;
    trades.push(trade);
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
    sideMode: variant.sideMode,
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
  const sideModes: Variant["sideMode"][] = ["both", "long_only"];
  const holdMinutes = [15, 20, 25];
  const stopLossPcts = [0.0025, 0.003, 0.0035];
  const takeProfitPcts = [0.007, 0.009, 0.011];
  const trailActivationPcts = [0.0035, 0.0045, 0.0055];
  const trailRetracePcts = [0.0015, 0.002, 0.0025];
  const filterBreakoutBps = [3, 4, 5, 6];
  const filterConfirmMinutes = [2, 3, 4];

  for (const sideMode of sideModes) {
    for (const hold of holdMinutes) {
      for (const stop of stopLossPcts) {
        for (const take of takeProfitPcts) {
          for (const trailAct of trailActivationPcts) {
            for (const trailRet of trailRetracePcts) {
              if (trailRet >= trailAct) continue;
              for (const breakout of filterBreakoutBps) {
                for (const confirm of filterConfirmMinutes) {
                  variants.push({
                    key: `${sideMode}_h${hold}_sl${stop}_tp${take}_ta${trailAct}_tr${trailRet}_b${breakout}_c${confirm}`,
                    sideMode,
                    holdMinutes: hold,
                    stopLossPct: stop,
                    takeProfitPct: take,
                    trailActivationPct: trailAct,
                    trailRetracePct: trailRet,
                    filterBreakoutBps: breakout,
                    filterConfirmMinutes: confirm,
                  });
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
  const candles1m = await loadCachedBinance("BTCUSDT", "1m", startMs, endMs);

  const variants = buildVariants();
  const summaries = variants
    .map((variant) => simulate(variant, rows, candles1m))
    .filter((summary) => summary.trades >= 20)
    .sort((a, b) => b.pnlUsd - a.pnlUsd);

  const best = summaries.slice(0, 20);
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseFilter: BASE_FILTER,
        variantsTested: variants.length,
        top20: best,
      },
      null,
      2,
    ),
    "utf8",
  );

  const markdown = [
    "# BTC 15m GoldCat Filter Search",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- variants tested: ${variants.length}`,
    `- base filter: move>=${BASE_FILTER.minMoveBps}, accel>=${BASE_FILTER.minAccelBps}, elapsed ${BASE_FILTER.minElapsedSec}-${BASE_FILTER.maxElapsedSec}, price<=${BASE_FILTER.maxEntryPrice}, spread<=${BASE_FILTER.maxEntrySpreadBps}, bidSupport>=${BASE_FILTER.minBidSupportRatio}`,
    "",
    "| variant | side | return % | pnl usd | max DD % | trades | win rate % | avg trade % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...best.map((row) => `| ${row.key} | ${row.sideMode} | ${row.totalReturnPct} | ${row.pnlUsd} | ${row.maxDrawdownPct} | ${row.trades} | ${row.winRatePct} | ${row.avgTradePct} |`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), markdown, "utf8");

  console.log(JSON.stringify(best.slice(0, 10), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
