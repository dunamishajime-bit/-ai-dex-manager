import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { BacktestResult, Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-usdt-idle-capacity");
const CACHE_DIR = path.join(process.cwd(), ".cache", "backtest-binance", "remote");
const SOURCE_FILES = [
  path.join(process.cwd(), "reports", "bnbchain-unseen-candidate-source", "candidates.json"),
  path.join(process.cwd(), "reports", "bnbchain-all-candidate-source", "candidates.json"),
];

const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2024, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 23, 23, 59, 59, 999);

const STABLE_OR_BASE = new Set([
  "BTC",
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "DAI",
  "AEUR",
  "EURI",
  "FRAX",
  "XUSD",
  "USD1",
  "USDE",
  "WBTC",
  "WBETH",
]);

const CURRENT_V7_SYMBOLS = new Set(["ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT", "BNB", "LINK"]);

const KNOWN_TESTED_SYMBOLS = new Set([
  "AAVE",
  "ACH",
  "ADA",
  "ALPACA",
  "ANKR",
  "ARPA",
  "ATOM",
  "AXS",
  "BAT",
  "BCH",
  "CAKE",
  "CELO",
  "CHR",
  "CHZ",
  "COMP",
  "COTI",
  "CRV",
  "CVC",
  "DASH",
  "DENT",
  "DODO",
  "DOT",
  "DYDX",
  "ENJ",
  "EOS",
  "FET",
  "FIL",
  "FTM",
  "GALA",
  "GLMR",
  "GMT",
  "HOT",
  "IOST",
  "IOTX",
  "JASMY",
  "KAVA",
  "KMD",
  "LRC",
  "LTC",
  "MAGIC",
  "MANA",
  "MASK",
  "MATIC",
  "MTL",
  "NEAR",
  "NEO",
  "NKN",
  "ONE",
  "ONT",
  "OXT",
  "PEPE",
  "PHA",
  "POND",
  "POWR",
  "QTUM",
  "REQ",
  "RLC",
  "ROSE",
  "RUNE",
  "SAND",
  "SFP",
  "SHIB",
  "SKL",
  "SPELL",
  "STORJ",
  "SUPER",
  "SYS",
  "TLM",
  "TRX",
  "VIC",
  "VITE",
  "VTHO",
  "WAN",
  "WAXP",
  "WING",
  "WOO",
  "WRX",
  "XNO",
  "XRP",
  "XTZ",
  "XVS",
  "YGG",
  "ZEC",
  "ZIL",
]);

type CandidateSource = {
  symbol: string;
  id?: string;
  address?: string;
};

type CashWindow = {
  startTs: number;
  endTs: number;
  hours: number;
  startIso: string;
  endIso: string;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDate(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

function halfKey(ts: number) {
  const date = new Date(ts);
  const half = date.getUTCMonth() < 6 ? "H1" : "H2";
  return `${date.getUTCFullYear()}-${half}`;
}

function monthKey(ts: number) {
  const date = new Date(ts);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };
}

function cashWindowsFromEquityCurve(result: BacktestResult) {
  const points = [...result.equity_curve].sort((left, right) => left.ts - right.ts);
  const windows: CashWindow[] = [];
  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const nextTs = points[index + 1]?.ts ?? END_TS;
    if (point.ts < START_TS || point.ts > END_TS) continue;
    if (nextTs <= point.ts) continue;

    if (point.position_side === "cash") {
      if (currentStart == null) currentStart = point.ts;
      currentEnd = Math.min(nextTs, END_TS);
    } else if (currentStart != null && currentEnd != null) {
      const hours = (currentEnd - currentStart) / 3_600_000;
      if (hours > 0) {
        windows.push({
          startTs: currentStart,
          endTs: currentEnd,
          hours,
          startIso: new Date(currentStart).toISOString(),
          endIso: new Date(currentEnd).toISOString(),
        });
      }
      currentStart = null;
      currentEnd = null;
    }
  }

  if (currentStart != null && currentEnd != null) {
    const hours = (currentEnd - currentStart) / 3_600_000;
    if (hours > 0) {
      windows.push({
        startTs: currentStart,
        endTs: currentEnd,
        hours,
        startIso: new Date(currentStart).toISOString(),
        endIso: new Date(currentEnd).toISOString(),
      });
    }
  }

  return windows;
}

function summarizeWindows(windows: CashWindow[], periodStart: number, periodEnd: number) {
  const clipped = windows
    .map((window) => ({
      ...window,
      startTs: Math.max(window.startTs, periodStart),
      endTs: Math.min(window.endTs, periodEnd),
    }))
    .filter((window) => window.endTs > window.startTs)
    .map((window) => ({
      ...window,
      hours: (window.endTs - window.startTs) / 3_600_000,
    }));
  const hours = clipped.map((window) => window.hours);
  const cashHours = hours.reduce((total, value) => total + value, 0);
  const totalHours = (periodEnd - periodStart) / 3_600_000;
  return {
    windows: clipped.length,
    cashHours: round(cashHours),
    cashDays: round(cashHours / 24),
    cashPct: round((cashHours / Math.max(totalHours, 1)) * 100),
    avgWindowDays: round((cashHours / Math.max(clipped.length, 1)) / 24),
    medianWindowDays: round(median(hours) / 24),
    maxWindowDays: round(Math.max(0, ...hours) / 24),
  };
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadCandidateSources() {
  const bySymbol = new Map<string, CandidateSource>();
  for (const file of SOURCE_FILES) {
    const rows = await readJsonIfExists<CandidateSource[]>(file);
    for (const row of rows ?? []) {
      const symbol = row.symbol?.toUpperCase();
      if (!symbol) continue;
      bySymbol.set(symbol, { ...row, symbol });
    }
  }
  return bySymbol;
}

async function listCachedSymbols() {
  const files = await fs.readdir(CACHE_DIR);
  const out = new Map<string, string>();
  for (const file of files) {
    const match = file.match(/^([A-Z0-9]+)USDT-.*\.json$/);
    if (!match) continue;
    const symbol = match[1];
    const existing = out.get(symbol);
    if (!existing || file > existing) out.set(symbol, path.join(CACHE_DIR, file));
  }
  return out;
}

async function loadCachedCandles(filePath: string) {
  const candles = await readJsonIfExists<Candle1h[]>(filePath);
  return (candles ?? [])
    .filter((candle) => candle.ts >= START_TS && candle.ts <= END_TS && candle.close > 0)
    .sort((left, right) => left.ts - right.ts);
}

function firstAtOrAfter(candles: Candle1h[], ts: number) {
  return candles.find((candle) => candle.ts >= ts) ?? null;
}

function candlesInside(candles: Candle1h[], startTs: number, endTs: number) {
  return candles.filter((candle) => candle.ts >= startTs && candle.ts <= endTs);
}

function analyzeCandidate(symbol: string, source: CandidateSource | undefined, candles: Candle1h[], windows: CashWindow[]) {
  let closeCompounded = 1;
  let positiveCloseWindows = 0;
  let maxHighHit10 = 0;
  let maxHighHit20 = 0;
  let totalClosePct = 0;
  let totalMaxHighPct = 0;
  const topWindows: Array<{
    start: string;
    end: string;
    closePct: number;
    maxHighPct: number;
    worstLowPct: number;
  }> = [];

  let usableWindows = 0;
  for (const window of windows) {
    const startBar = firstAtOrAfter(candles, window.startTs);
    const bars = candlesInside(candles, window.startTs, window.endTs);
    if (!startBar || bars.length < 2) continue;
    const lastBar = bars[bars.length - 1];
    const maxHigh = Math.max(...bars.map((bar) => bar.high));
    const minLow = Math.min(...bars.map((bar) => bar.low));
    const closePct = (lastBar.close / startBar.close - 1) * 100;
    const maxHighPct = (maxHigh / startBar.close - 1) * 100;
    const worstLowPct = (minLow / startBar.close - 1) * 100;

    usableWindows += 1;
    closeCompounded *= lastBar.close / startBar.close;
    totalClosePct += closePct;
    totalMaxHighPct += maxHighPct;
    if (closePct > 0) positiveCloseWindows += 1;
    if (maxHighPct >= 10) maxHighHit10 += 1;
    if (maxHighPct >= 20) maxHighHit20 += 1;
    topWindows.push({
      start: window.startIso,
      end: window.endIso,
      closePct: round(closePct),
      maxHighPct: round(maxHighPct),
      worstLowPct: round(worstLowPct),
    });
  }

  topWindows.sort((left, right) => right.maxHighPct - left.maxHighPct);
  return {
    symbol,
    providerId: source?.id ?? "",
    address: source?.address ?? "",
    candles: candles.length,
    usableWindows,
    closeCompoundedPct: round((closeCompounded - 1) * 100),
    avgClosePct: round(totalClosePct / Math.max(usableWindows, 1)),
    positiveCloseRatePct: round((positiveCloseWindows / Math.max(usableWindows, 1)) * 100),
    avgMaxHighPct: round(totalMaxHighPct / Math.max(usableWindows, 1)),
    hit10PctWindows: maxHighHit10,
    hit20PctWindows: maxHighHit20,
    bestMaxHighPct: round(topWindows[0]?.maxHighPct ?? 0),
    topWindows: topWindows.slice(0, 5),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", {
    ...buildOptions(),
    label: "v7_usdt_idle_capacity_baseline",
  });
  const windows = cashWindowsFromEquityCurve(baseline);
  const totalSummary = summarizeWindows(windows, START_TS, END_TS);

  const byHalf: Record<string, ReturnType<typeof summarizeWindows>> = {};
  const cursor = new Date(START_TS);
  while (cursor.getTime() < END_TS) {
    const periodStart = cursor.getTime();
    const month = cursor.getUTCMonth();
    const nextMonth = month < 6 ? 6 : 12;
    const periodEnd = Math.min(Date.UTC(cursor.getUTCFullYear(), nextMonth, 1, 0, 0, 0, 0), END_TS);
    byHalf[halfKey(periodStart)] = summarizeWindows(windows, periodStart, periodEnd);
    cursor.setUTCMonth(nextMonth);
    if (nextMonth === 12) cursor.setUTCFullYear(cursor.getUTCFullYear() + 1, 0, 1);
  }

  const byMonth: Record<string, ReturnType<typeof summarizeWindows>> = {};
  const monthCursor = new Date(START_TS);
  while (monthCursor.getTime() < END_TS) {
    const periodStart = monthCursor.getTime();
    const periodEnd = Math.min(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 1), END_TS);
    byMonth[monthKey(periodStart)] = summarizeWindows(windows, periodStart, periodEnd);
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }

  const sources = await loadCandidateSources();
  const cached = await listCachedSymbols();
  const rows = [];
  const skipped = [];
  for (const [symbol, filePath] of cached) {
    if (STABLE_OR_BASE.has(symbol) || CURRENT_V7_SYMBOLS.has(symbol) || KNOWN_TESTED_SYMBOLS.has(symbol)) {
      skipped.push(symbol);
      continue;
    }
    const source = sources.get(symbol);
    if (!source?.address) {
      skipped.push(symbol);
      continue;
    }
    const candles = await loadCachedCandles(filePath);
    if (candles.length < 300) {
      skipped.push(symbol);
      continue;
    }
    rows.push(analyzeCandidate(symbol, source, candles, windows));
  }

  rows.sort((left, right) =>
    right.avgMaxHighPct - left.avgMaxHighPct
    || right.hit20PctWindows - left.hit20PctWindows
    || right.positiveCloseRatePct - left.positiveCloseRatePct,
  );

  const longWindows = [...windows]
    .sort((left, right) => right.hours - left.hours)
    .slice(0, 12);

  const md = [
    "# V7 USDT Idle Capacity",
    "",
    `- method: engine-direct \`runHybridBacktest("RETQ22", V7 profile)\``,
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- baseline_end_equity: ${round(baseline.summary.end_equity)}`,
    `- baseline_max_dd_pct: ${round(baseline.summary.max_drawdown_pct)}`,
    `- baseline_pf: ${round(baseline.summary.profit_factor, 3)}`,
    `- baseline_trades: ${baseline.summary.trade_count}`,
    "",
    "## USDT Holding Summary",
    "",
    "| scope | windows | cash days | cash % | avg window days | median days | max days |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| total | ${totalSummary.windows} | ${totalSummary.cashDays} | ${totalSummary.cashPct}% | ${totalSummary.avgWindowDays} | ${totalSummary.medianWindowDays} | ${totalSummary.maxWindowDays} |`,
    ...Object.entries(byHalf).map(([key, value]) => `| ${key} | ${value.windows} | ${value.cashDays} | ${value.cashPct}% | ${value.avgWindowDays} | ${value.medianWindowDays} | ${value.maxWindowDays} |`),
    "",
    "## Longest USDT Windows",
    "",
    "| start | end | days |",
    "| --- | --- | ---: |",
    ...longWindows.map((window) => `| ${formatDate(window.startTs)} | ${formatDate(window.endTs)} | ${round(window.hours / 24)} |`),
    "",
    "## Cached BNB Chain Candidates Not In Current/Past Tested Sets",
    "",
    "This is an opportunity scan, not a deployable strategy result. `max high` is the upper bound inside V7 cash windows; close-to-close is the passive buy-at-window-start estimate.",
    "",
    "| symbol | avg max high % | hit >=20% | hit >=10% | close compounded % | positive close % | best max high % | address |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.slice(0, 25).map((row) => `| ${row.symbol} | ${row.avgMaxHighPct} | ${row.hit20PctWindows} | ${row.hit10PctWindows} | ${row.closeCompoundedPct} | ${row.positiveCloseRatePct}% | ${row.bestMaxHighPct} | ${row.address} |`),
    "",
    "## Top Candidate Windows",
    "",
    ...rows.slice(0, 8).flatMap((row) => [
      `### ${row.symbol}`,
      ...row.topWindows.map((window) => `- ${window.start.slice(0, 10)} -> ${window.end.slice(0, 10)}: max ${window.maxHighPct}%, close ${window.closePct}%, worst ${window.worstLowPct}%`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    strategyId: RECLAIM_HYBRID_EXECUTION_PROFILE.id,
    startUtc: new Date(START_TS).toISOString(),
    endUtc: new Date(END_TS).toISOString(),
    baseline: baseline.summary,
    totalSummary,
    byHalf,
    byMonth,
    longWindows,
    candidates: rows,
    skippedSymbols: skipped.sort(),
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({
    baselineEndEquity: round(baseline.summary.end_equity),
    totalSummary,
    topCandidates: rows.slice(0, 10),
    report: path.join(REPORT_DIR, "result.md"),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
