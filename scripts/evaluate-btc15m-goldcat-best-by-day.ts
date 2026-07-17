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

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const CACHE_DIR = path.join(process.cwd(), ".cache", "btc15m-rebuild");
const REPORT_DIR = path.join(process.cwd(), "reports", "btc15m-goldcat-best-by-day");
const STARTING_CASH_USD = 100;
const ASTER_TAKER_FEE_PER_SIDE = 0.0004;

const BEST = {
  minMoveBps: 5,
  minBidSupportRatio: 0.8,
  maxEntrySpreadBps: 180,
  minElapsedSec: 120,
  maxElapsedSec: 240,
  maxEntryPrice: 0.65,
  holdMinutes: 20,
  stopLossPct: 0.0025,
  takeProfitPct: 0.009,
  trailActivationPct: 0.0055,
  trailRetracePct: 0.0025,
  filterBreakoutBps: 5,
  filterConfirmMinutes: 3,
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

function runTrade(candles1m: Candle[], side: "long" | "short", signalTs: number) {
  const entry = executionPrice(candles1m, signalTs);
  if (!entry) return null;
  const stop = side === "long"
    ? entry.price * (1 - BEST.stopLossPct)
    : entry.price * (1 + BEST.stopLossPct);
  const take = side === "long"
    ? entry.price * (1 + BEST.takeProfitPct)
    : entry.price * (1 - BEST.takeProfitPct);
  let peak = entry.price;
  let trough = entry.price;
  let exitPrice = entry.price;
  let exitTs = entry.ts;
  const holdUntil = entry.ts + (BEST.holdMinutes * 60_000);

  for (const candle of candles1m) {
    if (candle.ts < entry.ts) continue;
    if (candle.ts > holdUntil) break;
    peak = Math.max(peak, candle.high);
    trough = Math.min(trough, candle.low);
    const trail = side === "long"
      ? (peak >= entry.price * (1 + BEST.trailActivationPct) ? peak * (1 - BEST.trailRetracePct) : null)
      : (trough <= entry.price * (1 - BEST.trailActivationPct) ? trough * (1 + BEST.trailRetracePct) : null);
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
  return { pnlUsd: STARTING_CASH_USD * net, pnlPct: net * 100, exitTs, side, entryTs: entry.ts };
}

function dayKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

function simulate(rows: UpdownRow[], candles1m: Candle[]) {
  const trades: { pnlUsd: number; pnlPct: number; exitTs: number; side: string; entryTs: number }[] = [];
  let lastExitTs = -Infinity;

  for (const row of rows) {
    if (row.ts < lastExitTs) continue;
    if (row.elapsedSec < BEST.minElapsedSec || row.elapsedSec > BEST.maxElapsedSec) continue;
    if (Math.abs(row.moveBps) < BEST.minMoveBps) continue;
    const side = row.moveBps >= 0 ? "long" : "short";
    const book = side === "long" ? row.up : row.down;
    if (!book || !Number.isFinite(book.bestAsk) || Number(book.bestAsk) > BEST.maxEntryPrice) continue;
    if (Number(book.spreadBps || 9999) > BEST.maxEntrySpreadBps) continue;
    const bidSupportRatio = Number(book.bidDepthUsd || 0) / Math.max(1, Number(book.askDepthUsd || 0));
    if (bidSupportRatio < BEST.minBidSupportRatio) continue;

    const signalPrice = executionPrice(candles1m, row.ts)?.price;
    if (!signalPrice) continue;
    const confirmUntil = row.ts + (BEST.filterConfirmMinutes * 60_000);
    const breakoutPct = BEST.filterBreakoutBps / 10_000;
    let confirmedTs: number | null = null;
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
    const trade = runTrade(candles1m, side, confirmedTs);
    if (!trade) continue;
    trades.push(trade);
    lastExitTs = trade.exitTs;
  }

  const byDay = new Map<string, typeof trades>();
  for (const trade of trades) {
    const key = dayKey(trade.entryTs);
    const dayTrades = byDay.get(key) || [];
    dayTrades.push(trade);
    byDay.set(key, dayTrades);
  }

  const daily = [...byDay.entries()].map(([date, dayTrades]) => {
    let equity = STARTING_CASH_USD;
    let peak = STARTING_CASH_USD;
    let maxDd = 0;
    for (const trade of dayTrades) {
      equity += trade.pnlUsd;
      peak = Math.max(peak, equity);
      maxDd = Math.min(maxDd, (equity / peak) - 1);
    }
    const pnlUsd = dayTrades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
    const wins = dayTrades.filter((trade) => trade.pnlUsd > 0).length;
    return {
      date,
      trades: dayTrades.length,
      wins,
      winRatePct: round(dayTrades.length ? (wins / dayTrades.length) * 100 : 0, 2),
      pnlUsd: round(pnlUsd, 4),
      returnPct: round((equity / STARTING_CASH_USD - 1) * 100, 4),
      maxDrawdownPct: round(maxDd * 100, 4),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));

  return { trades, daily };
}

async function main() {
  const rows = await loadGoldcatRows();
  const startMs = rows[0].ts;
  const endMs = rows.at(-1)!.ts + (60 * 60_000);
  const candles1m = await loadCachedBinance("BTCUSDT", "1m", startMs, endMs);
  const { trades, daily } = simulate(rows, candles1m);

  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
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
        best: BEST,
        total: {
          trades: trades.length,
          pnlUsd: round(totalPnl, 4),
          returnPct: round((totalPnl / STARTING_CASH_USD) * 100, 4),
        },
        daily,
      },
      null,
      2,
    ),
    "utf8",
  );

  const markdown = [
    "# BTC 15m GoldCat Best By Day",
    "",
    `- window: ${new Date(startMs).toISOString()} to ${new Date(rows.at(-1)!.ts).toISOString()}`,
    `- total trades: ${trades.length}`,
    `- total pnl usd: ${round(totalPnl, 4)}`,
    `- total return %: ${round((totalPnl / STARTING_CASH_USD) * 100, 4)}`,
    "",
    "| date | trades | win rate % | pnl usd | return % | max DD % |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...daily.map((row) => `| ${row.date} | ${row.trades} | ${row.winRatePct} | ${row.pnlUsd} | ${row.returnPct} | ${row.maxDrawdownPct} |`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), markdown, "utf8");
  console.log(JSON.stringify({ totalPnl: round(totalPnl, 4), trades: trades.length, daily }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
