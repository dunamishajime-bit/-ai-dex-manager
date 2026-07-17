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
  feeRate?: number;
  up?: {
    bestAsk?: number;
    askDepthUsd?: number;
    bidDepthUsd?: number;
    spreadBps?: number;
  };
  down?: {
    bestAsk?: number;
    askDepthUsd?: number;
    bidDepthUsd?: number;
    spreadBps?: number;
  };
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
  moveThresholdBps: number;
  minEntryElapsedSec: number;
  maxEntryElapsedSec: number;
  accelerationLookbackSec: number;
  minAccelerationBps: number;
  maxEntryPrice: number;
  maxEntrySpreadBps: number;
  minBidSupportRatio: number;
  entryPct: number;
  allowLong?: boolean;
  allowShort?: boolean;
};

type FeeProfile = {
  key: string;
  takerFeePerSidePct: number;
};

type SignalTrade = {
  slug: string;
  side: "long" | "short";
  openedAt: string;
  closedAt: string;
  entryAsk: number;
  spreadBps: number;
  bidSupportRatio: number;
  elapsedSec: number;
  moveBps: number;
  accelerationBps: number;
  entryPrice: number;
  exitPrice: number;
  grossReturnPct: number;
  netReturnPct: number;
  pnlUsd: number;
};

type Summary = {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  pnlUsd: number;
  totalReturnPct: number;
  roiOnTurnoverPct: number;
  avgTradePct: number;
  maxDrawdownPct: number;
  tradesDetail: SignalTrade[];
};

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";
const REPORT_DIR = path.join(process.cwd(), "reports", "btc15m-aster-fee-backtest");
const CACHE_DIR = path.join(process.cwd(), ".cache", "btc15m-aster-fee");
const STARTING_CASH_USD = 100;

const STRATEGIES: Strategy[] = [
  {
    key: "base_request",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 420,
    accelerationLookbackSec: 15,
    minAccelerationBps: 1.2,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: true,
    allowShort: true,
  },
  {
    key: "early_window",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 1.2,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: true,
    allowShort: true,
  },
  {
    key: "early_bid1",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 1.2,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 1.0,
    entryPct: 0.05,
    allowLong: true,
    allowShort: true,
  },
  {
    key: "early_accel2",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 2.0,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: true,
    allowShort: true,
  },
  {
    key: "long_only_early",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 1.2,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: true,
    allowShort: false,
  },
  {
    key: "long_only_early_bid1",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 1.2,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 1.0,
    entryPct: 0.05,
    allowLong: true,
    allowShort: false,
  },
  {
    key: "long_only_early_accel2",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 2.0,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: true,
    allowShort: false,
  },
  {
    key: "long_only_early_accel2_bid1",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 2.0,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 1.0,
    entryPct: 0.05,
    allowLong: true,
    allowShort: false,
  },
  {
    key: "short_only_early",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 1.2,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: false,
    allowShort: true,
  },
  {
    key: "short_only_early_accel2",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 2.0,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: false,
    allowShort: true,
  },
  {
    key: "short_only_early_accel2_bid1",
    moveThresholdBps: 4,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 2.0,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 1.0,
    entryPct: 0.05,
    allowLong: false,
    allowShort: true,
  },
  {
    key: "long_only_early_move5",
    moveThresholdBps: 5,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 1.2,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: true,
    allowShort: false,
  },
  {
    key: "short_only_early_move5",
    moveThresholdBps: 5,
    minEntryElapsedSec: 120,
    maxEntryElapsedSec: 240,
    accelerationLookbackSec: 15,
    minAccelerationBps: 1.2,
    maxEntryPrice: 0.65,
    maxEntrySpreadBps: 180,
    minBidSupportRatio: 0.8,
    entryPct: 0.05,
    allowLong: false,
    allowShort: true,
  },
];

const FEE_PROFILES: FeeProfile[] = [
  { key: "aster_fee_page_taker_0.04pct", takerFeePerSidePct: 0.0004 },
  { key: "aster_fee_page_taker_0.04pct_aster_discount", takerFeePerSidePct: 0.00038 },
  { key: "aster_overview_taker_0.035pct", takerFeePerSidePct: 0.00035 },
  { key: "frictionless", takerFeePerSidePct: 0 },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function minuteFloor(ts: number) {
  return Math.floor(ts / 60_000) * 60_000;
}

function iso(ts: number) {
  return new Date(ts).toISOString();
}

async function listInputFiles() {
  const names = await fs.readdir(DATA_DIR);
  return names
    .filter((name) => /^updown_lag_.*\.ndjson$/.test(name))
    .sort()
    .map((name) => path.join(DATA_DIR, name));
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
  return rows.sort((left, right) => left.ts - right.ts);
}

function groupByMarket(rows: UpdownRow[]) {
  const grouped = new Map<string, UpdownRow[]>();
  for (const row of rows) {
    const key = `${row.coin}:${row.horizonSec}:${row.startSec}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }
  for (const rowsForMarket of grouped.values()) {
    rowsForMarket.sort((left, right) => left.ts - right.ts);
  }
  return grouped;
}

function priorRow(rows: UpdownRow[], row: UpdownRow, lookbackSec: number) {
  const targetTs = row.ts - (lookbackSec * 1000);
  let prior: UpdownRow | null = null;
  for (const item of rows) {
    if (item.ts >= row.ts) break;
    if (item.ts <= targetTs) prior = item;
  }
  return prior;
}

function recentMoveStillStrong(rows: UpdownRow[], row: UpdownRow, strategy: Strategy) {
  const prior = priorRow(rows, row, strategy.accelerationLookbackSec);
  if (!prior || !Number.isFinite(prior.moveBps)) return false;
  if (Math.sign(prior.moveBps) !== Math.sign(row.moveBps)) return false;
  return Math.abs(row.moveBps) >= Math.abs(prior.moveBps);
}

function accelerationConfirmed(rows: UpdownRow[], row: UpdownRow, strategy: Strategy) {
  const prior = priorRow(rows, row, strategy.accelerationLookbackSec);
  if (!prior || !Number.isFinite(prior.moveBps)) return null;
  if (Math.sign(prior.moveBps) !== Math.sign(row.moveBps)) return null;
  const accelerationBps = Math.abs(row.moveBps) - Math.abs(prior.moveBps);
  if (accelerationBps < strategy.minAccelerationBps) return null;
  return accelerationBps;
}

function signalForRow(rows: UpdownRow[], row: UpdownRow, strategy: Strategy) {
  if (row.elapsedSec < strategy.minEntryElapsedSec || row.elapsedSec > strategy.maxEntryElapsedSec) return null;
  if (Math.abs(row.moveBps) < strategy.moveThresholdBps) return null;
  if (!recentMoveStillStrong(rows, row, strategy)) return null;
  const accelerationBps = accelerationConfirmed(rows, row, strategy);
  if (accelerationBps == null) return null;

  const side = row.moveBps >= 0 ? "long" : "short";
  if (side === "long" && strategy.allowLong === false) return null;
  if (side === "short" && strategy.allowShort === false) return null;
  const book = side === "long" ? row.up : row.down;
  if (!book || !Number.isFinite(book.bestAsk) || book.bestAsk <= 0) return null;
  if (book.bestAsk > strategy.maxEntryPrice) return null;
  if (Number(book.spreadBps || 9999) > strategy.maxEntrySpreadBps) return null;
  const askDepthUsd = Number(book.askDepthUsd || 0);
  const bidDepthUsd = Number(book.bidDepthUsd || 0);
  const bidSupportRatio = bidDepthUsd / Math.max(1, askDepthUsd);
  if (bidSupportRatio < strategy.minBidSupportRatio) return null;

  return {
    row,
    side,
    book,
    bidSupportRatio,
    accelerationBps,
  };
}

async function fetchBinance1m(startMs: number, endMs: number) {
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
  return [...dedup.values()].sort((left, right) => left.ts - right.ts);
}

async function loadCached1m(startMs: number, endMs: number) {
  const filePath = path.join(CACHE_DIR, `BTCUSDT-${minuteFloor(startMs)}-${minuteFloor(endMs)}-1m.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Candle1m[];
  } catch {
    const candles = await fetchBinance1m(startMs, endMs);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(candles), "utf8");
    return candles;
  }
}

function executionPrice(candles: Candle1m[], targetTs: number) {
  const execTs = Math.ceil(targetTs / 60_000) * 60_000;
  const candle = candles.find((row) => row.ts >= execTs);
  return candle ? { ts: candle.ts, price: candle.open } : null;
}

function simulate(strategy: Strategy, signals: ReturnType<typeof signalForRow>[], candles: Candle1m[], feeProfile: FeeProfile): Summary {
  let cashUsd = STARTING_CASH_USD;
  let peakEquityUsd = STARTING_CASH_USD;
  let maxDrawdownPct = 0;
  const trades: SignalTrade[] = [];

  for (const signal of signals) {
    if (!signal) continue;
    const entry = executionPrice(candles, signal.row.ts);
    const exit = executionPrice(candles, signal.row.ts + (signal.row.horizonSec * 1000));
    if (!entry || !exit) continue;

    const stakeUsd = STARTING_CASH_USD * strategy.entryPct;
    const grossReturn = signal.side === "long"
      ? ((exit.price / entry.price) - 1)
      : ((entry.price / exit.price) - 1);
    const feePct = feeProfile.takerFeePerSidePct * 2;
    const netReturn = grossReturn - feePct;
    const pnlUsd = stakeUsd * netReturn;
    cashUsd += pnlUsd;
    peakEquityUsd = Math.max(peakEquityUsd, cashUsd);
    maxDrawdownPct = Math.min(maxDrawdownPct, (cashUsd / peakEquityUsd) - 1);

    trades.push({
      slug: signal.row.slug,
      side: signal.side,
      openedAt: signal.row.iso,
      closedAt: iso(signal.row.ts + (signal.row.horizonSec * 1000)),
      entryAsk: Number(signal.book.bestAsk || 0),
      spreadBps: Number(signal.book.spreadBps || 0),
      bidSupportRatio: signal.bidSupportRatio,
      elapsedSec: signal.row.elapsedSec,
      moveBps: signal.row.moveBps,
      accelerationBps: signal.accelerationBps,
      entryPrice: entry.price,
      exitPrice: exit.price,
      grossReturnPct: grossReturn * 100,
      netReturnPct: netReturn * 100,
      pnlUsd,
    });
  }

  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  const turnoverUsd = trades.length * (STARTING_CASH_USD * strategy.entryPct);

  return {
    key: `${strategy.key}_${feeProfile.key}`,
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    pnlUsd: trades.reduce((sum, trade) => sum + trade.pnlUsd, 0),
    totalReturnPct: ((cashUsd / STARTING_CASH_USD) - 1) * 100,
    roiOnTurnoverPct: turnoverUsd > 0 ? (trades.reduce((sum, trade) => sum + trade.pnlUsd, 0) / turnoverUsd) * 100 : 0,
    avgTradePct: trades.length ? trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) / trades.length : 0,
    maxDrawdownPct: maxDrawdownPct * 100,
    tradesDetail: trades,
  };
}

async function writeReport(input: {
  sourceRows: number;
  sourceMarkets: number;
  signalCounts: Record<string, number>;
  start: string;
  end: string;
  summaries: Summary[];
}) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, "result.json");
  const mdPath = path.join(REPORT_DIR, "result.md");
  const md = [
    "# BTC 15m Aster Fee Backtest",
    "",
    `- source rows: ${input.sourceRows}`,
    `- source markets: ${input.sourceMarkets}`,
    `- signal counts: ${Object.entries(input.signalCounts).map(([key, value]) => `${key}=${value}`).join(", ")}`,
    `- source window: ${input.start} to ${input.end}`,
    `- variants: BTC 15m filtered entry variants with Aster taker fee scenarios`,
    `- execution: BTCUSDT 1m next-open entry and forced close after 15m`,
    "",
    "| fee profile | return % | pnl usd | max DD % | trades | win rate % | avg trade % | turnover ROI % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...input.summaries.map((row) => `| ${row.key} | ${round(row.totalReturnPct)} | ${round(row.pnlUsd)} | ${round(row.maxDrawdownPct)} | ${row.trades} | ${round(row.winRatePct)} | ${round(row.avgTradePct, 3)} | ${round(row.roiOnTurnoverPct, 3)} |`),
  ].join("\n");

  await fs.writeFile(jsonPath, JSON.stringify(input, null, 2), "utf8");
  await fs.writeFile(mdPath, md, "utf8");
}

async function main() {
  const rows = await loadRows();
  const rowsByMarket = groupByMarket(rows);
  const startMs = Math.min(...rows.map((row) => row.ts)) - (60 * 60 * 1000);
  const endMs = Math.max(...rows.map((row) => row.ts + (row.horizonSec * 1000))) + (60 * 60 * 1000);
  const candles = await loadCached1m(startMs, endMs);
  const signalsByStrategy = new Map<string, NonNullable<ReturnType<typeof signalForRow>>[]>();
  for (const strategy of STRATEGIES) {
    const signals = [...rowsByMarket.values()]
      .map((marketRows) => {
        for (const row of marketRows) {
          const signal = signalForRow(marketRows, row, strategy);
          if (signal) return signal;
        }
        return null;
      })
      .filter((value): value is NonNullable<ReturnType<typeof signalForRow>> => value != null);
    signalsByStrategy.set(strategy.key, signals);
  }

  const summaries = STRATEGIES.flatMap((strategy) => FEE_PROFILES.map((feeProfile) => simulate(strategy, signalsByStrategy.get(strategy.key) || [], candles, feeProfile)))
    .sort((left, right) => right.pnlUsd - left.pnlUsd);

  await writeReport({
    sourceRows: rows.length,
    sourceMarkets: rowsByMarket.size,
    signalCounts: Object.fromEntries(STRATEGIES.map((strategy) => [strategy.key, (signalsByStrategy.get(strategy.key) || []).length])),
    start: iso(startMs),
    end: iso(endMs),
    summaries: summaries.map((summary) => ({ ...summary, tradesDetail: summary.tradesDetail.slice(0, 30) })),
  });

  console.log(JSON.stringify(summaries.map((summary) => ({
    key: summary.key,
    trades: summary.trades,
    winRatePct: round(summary.winRatePct),
    pnlUsd: round(summary.pnlUsd),
    totalReturnPct: round(summary.totalReturnPct),
    maxDrawdownPct: round(summary.maxDrawdownPct),
    avgTradePct: round(summary.avgTradePct, 3),
    roiOnTurnoverPct: round(summary.roiOnTurnoverPct, 3),
  })), null, 2));
}

main().catch((error) => {
  console.error("[backtest-btc15m-aster-fee] failed:", error);
  process.exitCode = 1;
});
