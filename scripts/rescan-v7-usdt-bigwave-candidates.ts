import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-usdt-bigwave-rescan");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const LIQUIDITY_PATH = path.join(process.cwd(), "reports", "v7-bnb-idle-liquidity-candidate-search", "liquidity.json");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

const EXCLUDE = new Set([
  "BTC", "ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT", "BNB", "LINK",
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "AEUR", "EURI", "FRAX", "XUSD", "USD1", "USDE", "WBTC", "WBETH",
  "JUP", "AI", "BANANA", "ACT", "蟶∝ｮ我ｺｺ逕・",
]);

type Window = { startTs: number; endTs: number };
type LiquidityRow = {
  symbol: string;
  address: string;
  quoteVolume24h: number;
  trades24h: number;
  q100LossPct: number | null;
  q300LossPct: number | null;
  pass: boolean;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  };
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const points = result.equity_curve.sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of points) {
    if (point.position_side === "cash") {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) {
      windows.push({ startTs: start, endTs: prev + STEP_MS });
      start = null;
      prev = null;
    }
  }
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS });
  return windows.filter((window) => window.endTs > window.startTs);
}

function barsInWindow(candles: Candle1h[], window: Window) {
  return candles.filter((bar) => bar.ts >= window.startTs && bar.ts <= window.endTs);
}

function firstAtOrAfter(candles: Candle1h[], ts: number) {
  return candles.find((bar) => bar.ts >= ts) ?? null;
}

function scoreSymbol(row: LiquidityRow, candles: Candle1h[], windows: Window[]) {
  let usableWindows = 0;
  let hit10 = 0;
  let hit20 = 0;
  let hit40 = 0;
  let sumMaxHigh = 0;
  let sumPositiveMax = 0;
  let positiveClose = 0;
  let closeCompound = 1;
  const topWindows = [];

  for (const window of windows) {
    const start = firstAtOrAfter(candles, window.startTs);
    const bars = barsInWindow(candles, window);
    if (!start || bars.length < 2) continue;
    const maxHigh = Math.max(...bars.map((bar) => bar.high));
    const minLow = Math.min(...bars.map((bar) => bar.low));
    const last = bars[bars.length - 1];
    const maxHighPct = (maxHigh / start.close - 1) * 100;
    const closePct = (last.close / start.close - 1) * 100;
    const worstLowPct = (minLow / start.close - 1) * 100;
    usableWindows += 1;
    if (maxHighPct >= 10) hit10 += 1;
    if (maxHighPct >= 20) hit20 += 1;
    if (maxHighPct >= 40) hit40 += 1;
    if (closePct > 0) positiveClose += 1;
    sumMaxHigh += maxHighPct;
    sumPositiveMax += Math.max(0, maxHighPct);
    closeCompound *= last.close / start.close;
    topWindows.push({
      start: new Date(window.startTs).toISOString().slice(0, 10),
      end: new Date(window.endTs).toISOString().slice(0, 10),
      maxHighPct: round(maxHighPct),
      closePct: round(closePct),
      worstLowPct: round(worstLowPct),
    });
  }
  topWindows.sort((left, right) => right.maxHighPct - left.maxHighPct);
  const q300 = row.q300LossPct ?? 999;
  const quotePenalty = Math.max(0, q300) * 8;
  const score =
    hit40 * 20
    + hit20 * 10
    + hit10 * 3
    + (sumPositiveMax / Math.max(1, usableWindows)) * 0.5
    + Math.log10(Math.max(1, row.quoteVolume24h)) * 3
    - quotePenalty;

  return {
    symbol: row.symbol,
    quoteVolume24h: round(row.quoteVolume24h, 0),
    trades24h: row.trades24h,
    q100LossPct: row.q100LossPct,
    q300LossPct: row.q300LossPct,
    usableWindows,
    hit10,
    hit20,
    hit40,
    avgMaxHighPct: round(sumMaxHigh / Math.max(1, usableWindows)),
    positiveClosePct: round((positiveClose / Math.max(1, usableWindows)) * 100),
    closeCompoundedPct: round((closeCompound - 1) * 100),
    bestMaxHighPct: topWindows[0]?.maxHighPct ?? 0,
    score: round(score, 2),
    topWindows: topWindows.slice(0, 4),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseline = await runHybridBacktest("RETQ22", { ...baseOptions(), label: "v7_bigwave_rescan_base" });
  const windows = cashWindowsFromBaseline(baseline);
  const liquidity = JSON.parse(await fs.readFile(LIQUIDITY_PATH, "utf8")) as LiquidityRow[];
  const candidates = liquidity
    .filter((row) => row.pass)
    .filter((row) => !EXCLUDE.has(row.symbol))
    .filter((row) => typeof row.q100LossPct === "number" && typeof row.q300LossPct === "number")
    .filter((row) => row.q100LossPct! >= -1 && row.q100LossPct! <= 1 && row.q300LossPct! >= -1 && row.q300LossPct! <= 1)
    .filter((row) => row.quoteVolume24h >= 300_000)
    .sort((left, right) => right.quoteVolume24h - left.quoteVolume24h)
    .slice(0, 60);

  const rows = [];
  for (const row of candidates) {
    const candles = await loadHistoricalCandles({
      symbol: `${row.symbol}USDT`,
      cacheRoot: CACHE_ROOT,
      startMs: START_TS,
      endMs: END_TS,
      interval: "1h",
    }).catch(() => []);
    if (candles.length < 100) continue;
    const scored = scoreSymbol(row, candles, windows);
    rows.push(scored);
    console.log(`${row.symbol}: score=${scored.score} hit40=${scored.hit40} hit20=${scored.hit20} best=${scored.bestMaxHighPct}`);
  }

  rows.sort((left, right) => right.score - left.score);
  const md = [
    "# V7 USDT Big-Wave Candidate Rescan",
    "",
    "- method: V7 engine-direct cash windows + BNB Chain quote-passed symbols + Binance 1h candles",
    "- included: prior-tested symbols are allowed again if quote/liquidity are sane",
    "- filter: q100/q300 value loss between -1% and +1%, Binance 24h volume >= 300k USDT",
    "- note: opportunity scan only; top names still need sidecar backtest.",
    "",
    "| rank | symbol | score | 24h vol | q300 loss % | avg max high % | best max high % | hit >=40% | hit >=20% | hit >=10% | positive close % | close compounded % |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.symbol} | ${row.score} | ${row.quoteVolume24h} | ${row.q300LossPct} | ${row.avgMaxHighPct} | ${row.bestMaxHighPct} | ${row.hit40} | ${row.hit20} | ${row.hit10} | ${row.positiveClosePct}% | ${row.closeCompoundedPct} |`),
    "",
    "## Top Windows",
    "",
    ...rows.slice(0, 15).flatMap((row) => [
      `### ${row.symbol}`,
      ...row.topWindows.map((window) => `- ${window.start} -> ${window.end}: max ${window.maxHighPct}%, close ${window.closePct}%, worst ${window.worstLowPct}%`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
