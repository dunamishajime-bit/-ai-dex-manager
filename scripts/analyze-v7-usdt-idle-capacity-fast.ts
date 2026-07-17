import fs from "fs/promises";
import path from "path";

import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-usdt-idle-capacity");
const CACHE_DIR = path.join(process.cwd(), ".cache", "backtest-binance", "remote");
const IDLE_SOURCE = path.join(process.cwd(), "reports", "v7-idle-candidates-fresh", "result.json");
const SOURCE_FILES = [
  path.join(process.cwd(), "reports", "bnbchain-unseen-candidate-source", "candidates.json"),
  path.join(process.cwd(), "reports", "bnbchain-all-candidate-source", "candidates.json"),
];

const START_TS = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);

const STABLE_OR_BASE = new Set(["BTC", "USDT", "USDC", "FDUSD", "TUSD", "DAI", "AEUR", "EURI", "FRAX", "XUSD", "USD1", "USDE", "WBTC", "WBETH"]);
const CURRENT_V7_SYMBOLS = new Set(["ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT", "BNB", "LINK"]);
const PREVIOUSLY_TESTED = new Set([
  "AAVE", "ACH", "ADA", "ALPACA", "ANKR", "ARPA", "ATOM", "AXS", "BAT", "BCH", "CAKE", "CELO", "CHR", "CHZ", "COMP", "COTI", "CRV", "CVC", "DASH", "DENT", "DODO", "DOT", "DYDX", "ENJ", "EOS", "FET", "FIL", "FTM", "GALA", "GLMR", "GMT", "HOT", "IOST", "IOTX", "JASMY", "KAVA", "KMD", "LRC", "LTC", "MAGIC", "MANA", "MASK", "MATIC", "MTL", "NEAR", "NEO", "NKN", "ONE", "ONT", "OXT", "PEPE", "PHA", "POND", "POWR", "QTUM", "REQ", "RLC", "ROSE", "RUNE", "SAND", "SFP", "SHIB", "SKL", "SPELL", "STORJ", "SUPER", "SYS", "TLM", "TRX", "VIC", "VITE", "VTHO", "WAN", "WAXP", "WING", "WOO", "WRX", "XNO", "XRP", "XTZ", "XVS", "YGG", "ZEC", "ZIL",
  "SIGN", "G", "JOE", "ZRO", "ACE", "CGPT", "MOVE", "ASTER", "WLFI", "FLOKI", "HOME", "AVA", "USTC", "W", "TURBO",
]);

type CandidateSource = { symbol: string; id?: string; address?: string };
type IdleWindow = { startTs: number; endTs: number; startIso: string; endIso: string; bars?: number };

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

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return null;
  }
}

function clipWindows(windows: IdleWindow[]) {
  return windows
    .map((window) => ({
      startTs: Math.max(window.startTs, START_TS),
      endTs: Math.min(window.endTs, END_TS),
      startIso: new Date(Math.max(window.startTs, START_TS)).toISOString(),
      endIso: new Date(Math.min(window.endTs, END_TS)).toISOString(),
    }))
    .filter((window) => window.endTs > window.startTs);
}

function summarizeWindows(windows: IdleWindow[], startTs: number, endTs: number) {
  const clipped = windows
    .map((window) => ({ startTs: Math.max(window.startTs, startTs), endTs: Math.min(window.endTs, endTs) }))
    .filter((window) => window.endTs > window.startTs);
  const days = clipped.map((window) => (window.endTs - window.startTs) / 86_400_000);
  const cashDays = days.reduce((sum, value) => sum + value, 0);
  const totalDays = (endTs - startTs) / 86_400_000;
  return {
    windows: clipped.length,
    cashDays: round(cashDays),
    cashPct: round((cashDays / Math.max(totalDays, 1)) * 100),
    avgDays: round(cashDays / Math.max(clipped.length, 1)),
    medianDays: round(median(days)),
    maxDays: round(Math.max(0, ...days)),
  };
}

function halfPeriods() {
  return [
    ["2024-H1", Date.UTC(2024, 0, 1), Date.UTC(2024, 6, 1)],
    ["2024-H2", Date.UTC(2024, 6, 1), Date.UTC(2025, 0, 1)],
    ["2025-H1", Date.UTC(2025, 0, 1), Date.UTC(2025, 6, 1)],
    ["2025-H2", Date.UTC(2025, 6, 1), Date.UTC(2026, 0, 1)],
    ["2026-YTD", Date.UTC(2026, 0, 1), END_TS],
  ] as const;
}

async function candidateSources() {
  const bySymbol = new Map<string, CandidateSource>();
  for (const file of SOURCE_FILES) {
    const rows = await readJsonIfExists<CandidateSource[]>(file);
    for (const row of rows ?? []) {
      const symbol = row.symbol?.toUpperCase();
      if (symbol) bySymbol.set(symbol, { ...row, symbol });
    }
  }
  return bySymbol;
}

async function cachedSymbols() {
  const files = await fs.readdir(CACHE_DIR);
  const latest = new Map<string, string>();
  for (const file of files) {
    const match = file.match(/^([A-Z0-9]+)USDT-.*\.json$/);
    if (!match) continue;
    const symbol = match[1];
    const current = latest.get(symbol);
    if (!current || file > path.basename(current)) latest.set(symbol, path.join(CACHE_DIR, file));
  }
  return latest;
}

function firstAtOrAfter(candles: Candle1h[], ts: number) {
  return candles.find((candle) => candle.ts >= ts) ?? null;
}

function analyze(symbol: string, source: CandidateSource, candles: Candle1h[], windows: IdleWindow[]) {
  let compounded = 1;
  let usable = 0;
  let positive = 0;
  let sumClose = 0;
  let sumMax = 0;
  let hit10 = 0;
  let hit20 = 0;
  const top = [];
  for (const window of windows) {
    const bars = candles.filter((candle) => candle.ts >= window.startTs && candle.ts <= window.endTs);
    const start = firstAtOrAfter(candles, window.startTs);
    if (!start || bars.length < 2) continue;
    const last = bars[bars.length - 1];
    const maxHigh = Math.max(...bars.map((bar) => bar.high));
    const minLow = Math.min(...bars.map((bar) => bar.low));
    const closePct = (last.close / start.close - 1) * 100;
    const maxHighPct = (maxHigh / start.close - 1) * 100;
    const worstLowPct = (minLow / start.close - 1) * 100;
    usable += 1;
    compounded *= last.close / start.close;
    sumClose += closePct;
    sumMax += maxHighPct;
    if (closePct > 0) positive += 1;
    if (maxHighPct >= 10) hit10 += 1;
    if (maxHighPct >= 20) hit20 += 1;
    top.push({ start: window.startIso.slice(0, 10), end: window.endIso.slice(0, 10), closePct: round(closePct), maxHighPct: round(maxHighPct), worstLowPct: round(worstLowPct) });
  }
  top.sort((left, right) => right.maxHighPct - left.maxHighPct);
  return {
    symbol,
    id: source.id ?? "",
    address: source.address ?? "",
    usableWindows: usable,
    avgMaxHighPct: round(sumMax / Math.max(usable, 1)),
    hit20Windows: hit20,
    hit10Windows: hit10,
    closeCompoundedPct: round((compounded - 1) * 100),
    positiveClosePct: round((positive / Math.max(usable, 1)) * 100),
    bestMaxHighPct: round(top[0]?.maxHighPct ?? 0),
    topWindows: top.slice(0, 5),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const idleSource = await readJson<{ idleWindows: IdleWindow[] }>(IDLE_SOURCE);
  const windows = clipWindows(idleSource.idleWindows);
  const sources = await candidateSources();
  const cached = await cachedSymbols();

  const results = [];
  for (const [symbol, filePath] of cached) {
    if (STABLE_OR_BASE.has(symbol) || CURRENT_V7_SYMBOLS.has(symbol) || PREVIOUSLY_TESTED.has(symbol)) continue;
    const source = sources.get(symbol);
    if (!source?.address) continue;
    const candles = (await readJsonIfExists<Candle1h[]>(filePath) ?? [])
      .filter((candle) => candle.ts >= START_TS && candle.ts <= END_TS && candle.close > 0)
      .sort((left, right) => left.ts - right.ts);
    if (candles.length < 300) continue;
    results.push(analyze(symbol, source, candles, windows));
  }
  results.sort((left, right) =>
    right.avgMaxHighPct - left.avgMaxHighPct
    || right.hit20Windows - left.hit20Windows
    || right.positiveClosePct - left.positiveClosePct,
  );

  const total = summarizeWindows(windows, START_TS, END_TS);
  const byHalf = Object.fromEntries(halfPeriods().map(([key, start, end]) => [key, summarizeWindows(windows, start, end)]));
  const longest = [...windows]
    .map((window) => ({ ...window, days: round((window.endTs - window.startTs) / 86_400_000) }))
    .sort((left, right) => right.days - left.days)
    .slice(0, 10);

  const md = [
    "# V7 USDT Idle Capacity Fast Scan",
    "",
    "- USDT windows: reused from existing engine-direct `reports/v7-idle-candidates-fresh/result.json` equity-curve output.",
    "- Candidate scan: cached Binance candles only; this is an opportunity scan, not final strategy backtest.",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "## USDT Holding",
    "",
    "| period | windows | cash days | cash % | avg days | median days | max days |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| total | ${total.windows} | ${total.cashDays} | ${total.cashPct}% | ${total.avgDays} | ${total.medianDays} | ${total.maxDays} |`,
    ...Object.entries(byHalf).map(([key, value]) => `| ${key} | ${value.windows} | ${value.cashDays} | ${value.cashPct}% | ${value.avgDays} | ${value.medianDays} | ${value.maxDays} |`),
    "",
    "## Longest USDT Windows",
    "",
    "| start | end | days |",
    "| --- | --- | ---: |",
    ...longest.map((window) => `| ${window.startIso.slice(0, 10)} | ${window.endIso.slice(0, 10)} | ${window.days} |`),
    "",
    "## Not-Previously-Tested Cached BNB Chain Candidates",
    "",
    "| symbol | avg max high % | hit >=20% | hit >=10% | close compounded % | positive close % | best max high % | address |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...results.slice(0, 20).map((row) => `| ${row.symbol} | ${row.avgMaxHighPct} | ${row.hit20Windows} | ${row.hit10Windows} | ${row.closeCompoundedPct} | ${row.positiveClosePct}% | ${row.bestMaxHighPct} | ${row.address} |`),
    "",
    "## Top Windows",
    "",
    ...results.slice(0, 8).flatMap((row) => [
      `### ${row.symbol}`,
      ...row.topWindows.map((window) => `- ${window.start} -> ${window.end}: max ${window.maxHighPct}%, close ${window.closePct}%, worst ${window.worstLowPct}%`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "fast-result.json"), JSON.stringify({ total, byHalf, longest, results }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "fast-result.md"), md, "utf8");
  console.log(JSON.stringify({ total, byHalf, top: results.slice(0, 10), report: path.join(REPORT_DIR, "fast-result.md") }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
