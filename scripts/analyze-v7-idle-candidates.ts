import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles, type Candle1h } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-idle-candidates");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const CACHE_ROOT = path.join(process.cwd(), ".cache", "backtest-binance");
const BAR_MS = 12 * 60 * 60 * 1000;

const CANDIDATES = [
  "LINK",
  "NEAR",
  "XRP",
  "AAVE",
  "UNI",
  "ADA",
  "LTC",
  "ATOM",
  "TRX",
  "BNB",
  "CAKE",
  "SFP",
  "DOT",
  "BCH",
  "MATIC",
  "ZEC",
  "DASH",
] as const;

type IdleWindow = {
  startTs: number;
  endTs: number;
  startIso: string;
  endIso: string;
  bars: number;
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
  } satisfies HybridVariantOptions;
}

function buildIdleWindowsFromEquityCurve(
  equityCurve: Awaited<ReturnType<typeof runHybridBacktest>>["equity_curve"],
) {
  const windows: IdleWindow[] = [];
  let windowStartTs: number | null = null;

  for (const point of equityCurve) {
    const isCash = point.position_side === "cash";
    if (isCash && windowStartTs == null) {
      windowStartTs = point.ts;
      continue;
    }

    if (!isCash && windowStartTs != null) {
      const bars = Math.max(1, Math.round((point.ts - windowStartTs) / BAR_MS));
      windows.push({
        startTs: windowStartTs,
        endTs: point.ts,
        startIso: new Date(windowStartTs).toISOString(),
        endIso: new Date(point.ts).toISOString(),
        bars,
      });
      windowStartTs = null;
    }
  }

  if (windowStartTs != null) {
    const bars = Math.max(1, Math.round((END_TS - windowStartTs) / BAR_MS));
    windows.push({
      startTs: windowStartTs,
      endTs: END_TS,
      startIso: new Date(windowStartTs).toISOString(),
      endIso: new Date(END_TS).toISOString(),
      bars,
    });
  }

  return windows.filter((window) => window.bars >= 2);
}

function priceAtOrAfter(candles: Candle1h[], ts: number) {
  return candles.find((bar) => bar.ts >= ts)?.close ?? null;
}

function priceAtOrBefore(candles: Candle1h[], ts: number) {
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (candles[index].ts <= ts) return candles[index].close;
  }
  return null;
}

async function loadCandidateCandles(symbol: string) {
  return loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: START_TS,
    endMs: END_TS,
  });
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", {
    ...baseOptions(),
    label: "base_v7_idle_candidate_scan",
  });
  const idleWindows = buildIdleWindowsFromEquityCurve(baseline.equity_curve);

  const results: Array<{
    symbol: string;
    compoundedReturnPct: number;
    avgWindowReturnPct: number;
    positiveWindows: number;
    totalWindows: number;
    bestWindowPct: number;
    worstWindowPct: number;
    positiveRatePct: number;
    bestWindows: Array<{ startIso: string; endIso: string; returnPct: number }>;
  }> = [];

  for (const symbol of CANDIDATES) {
    const candles = await loadCandidateCandles(symbol);
    let compounded = 1;
    let totalReturn = 0;
    let positiveWindows = 0;
    let bestWindowPct = Number.NEGATIVE_INFINITY;
    let worstWindowPct = Number.POSITIVE_INFINITY;
    const rows: Array<{ startIso: string; endIso: string; returnPct: number }> = [];

    for (const window of idleWindows) {
      const startPrice = priceAtOrAfter(candles, window.startTs);
      const endPrice = priceAtOrBefore(candles, window.endTs);
      if (!startPrice || !endPrice || startPrice <= 0) continue;

      const returnPct = (endPrice / startPrice - 1) * 100;
      compounded *= endPrice / startPrice;
      totalReturn += returnPct;
      if (returnPct > 0) positiveWindows += 1;
      bestWindowPct = Math.max(bestWindowPct, returnPct);
      worstWindowPct = Math.min(worstWindowPct, returnPct);
      rows.push({
        startIso: window.startIso,
        endIso: window.endIso,
        returnPct: round(returnPct),
      });
    }

    rows.sort((left, right) => right.returnPct - left.returnPct);
    results.push({
      symbol,
      compoundedReturnPct: round((compounded - 1) * 100),
      avgWindowReturnPct: round(totalReturn / Math.max(rows.length, 1)),
      positiveWindows,
      totalWindows: rows.length,
      bestWindowPct: round(Number.isFinite(bestWindowPct) ? bestWindowPct : 0),
      worstWindowPct: round(Number.isFinite(worstWindowPct) ? worstWindowPct : 0),
      positiveRatePct: round((positiveWindows / Math.max(rows.length, 1)) * 100),
      bestWindows: rows.slice(0, 5),
    });
  }

  results.sort((left, right) =>
    right.compoundedReturnPct - left.compoundedReturnPct
    || right.positiveRatePct - left.positiveRatePct
    || right.bestWindowPct - left.bestWindowPct,
  );

  const md = [
    "# V7 Idle Candidate Analysis",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- idle_window_count: ${idleWindows.length}`,
    "",
    "## Longest Idle Windows",
    "",
    "| start | end | bars | days |",
    "| --- | --- | ---: | ---: |",
    ...idleWindows
      .sort((left, right) => right.bars - left.bars)
      .slice(0, 10)
      .map((window) => `| ${window.startIso} | ${window.endIso} | ${window.bars} | ${round((window.bars * 12) / 24)} |`),
    "",
    "## Candidate Comparison",
    "",
    "| symbol | compounded % | avg window % | positive rate | positive/total | best % | worst % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((row) => `| ${row.symbol} | ${row.compoundedReturnPct} | ${row.avgWindowReturnPct} | ${row.positiveRatePct}% | ${row.positiveWindows}/${row.totalWindows} | ${row.bestWindowPct} | ${row.worstWindowPct} |`),
    "",
    "## Top Windows",
    "",
    ...results.slice(0, 5).flatMap((row) => [
      `### ${row.symbol}`,
      ...row.bestWindows.map((window) => `- ${window.startIso} -> ${window.endIso}: ${window.returnPct}%`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    idleWindows,
    results,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
