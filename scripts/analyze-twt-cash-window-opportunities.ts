import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { analyzeHybridDecisionWindow, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { resampleTo12h } from "../lib/backtest/indicators";
import type { Candle12h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "twt-cash-window-opportunities");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "backtest-binance");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

const MIN_UPSWING_PCT = 15;
const RETRACE_CONFIRM_PCT = 8;
const SANITY_MIN_BARS = 2;
const SANITY_MAX_GAIN_PCT = 150;

type Window = {
  startTs: number;
  endTs: number;
};

type Opportunity = {
  startTs: number;
  endTs: number;
  startIso: string;
  endIso: string;
  bars: number;
  entryPrice: number;
  peakPrice: number;
  gainPct: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatIso(ts: number) {
  return new Date(ts).toISOString();
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

function buildCashOnlyWindows(
  points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>,
) {
  const cashPoints = points
    .filter((point) => point.decision.desiredSymbol === "USDT" && point.decision.desiredSide === "cash")
    .sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const point of cashPoints) {
    if (start == null) {
      start = point.ts;
      prev = point.ts;
      continue;
    }

    if (prev != null && point.ts - prev <= STEP_MS) {
      prev = point.ts;
      continue;
    }

    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
    start = point.ts;
    prev = point.ts;
  }

  if (start != null) {
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  }

  return windows;
}

function isWithinWindows(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts < window.endTs);
}

function splitBarsByWindows(bars: readonly Candle12h[], windows: readonly Window[]) {
  const segments: Candle12h[][] = [];
  let current: Candle12h[] = [];

  for (const bar of bars) {
    if (isWithinWindows(bar.ts, windows)) {
      current.push(bar);
      continue;
    }

    if (current.length) {
      segments.push(current);
      current = [];
    }
  }

  if (current.length) {
    segments.push(current);
  }

  return segments;
}

function extractUpsideOpportunities(bars: readonly Candle12h[]) {
  const opportunities: Opportunity[] = [];
  if (!bars.length) return opportunities;

  let troughIndex = 0;
  let troughPrice = Math.min(bars[0].open, bars[0].low, bars[0].close);
  let active = false;
  let peakIndex = 0;
  let peakPrice = Math.max(bars[0].open, bars[0].high, bars[0].close);

  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index];
    const barLow = Math.min(bar.open, bar.low, bar.close);
    const barHigh = Math.max(bar.open, bar.high, bar.close);

    if (!active) {
      if (barLow <= troughPrice) {
        troughPrice = barLow;
        troughIndex = index;
      }

      const risePct = ((barHigh / troughPrice) - 1) * 100;
      if (risePct >= MIN_UPSWING_PCT) {
        active = true;
        peakIndex = index;
        peakPrice = barHigh;
      }
      continue;
    }

    if (barHigh >= peakPrice) {
      peakPrice = barHigh;
      peakIndex = index;
    }

    const retracePct = ((barLow / peakPrice) - 1) * 100;
    if (retracePct <= -RETRACE_CONFIRM_PCT) {
      const gainPct = ((peakPrice / troughPrice) - 1) * 100;
      opportunities.push({
        startTs: bars[troughIndex].ts,
        endTs: bars[peakIndex].ts,
        startIso: formatIso(bars[troughIndex].ts),
        endIso: formatIso(bars[peakIndex].ts),
        bars: Math.max(1, peakIndex - troughIndex + 1),
        entryPrice: round(troughPrice, 6),
        peakPrice: round(peakPrice, 6),
        gainPct: round(gainPct, 2),
      });

      troughIndex = index;
      troughPrice = barLow;
      active = false;
      peakIndex = index;
      peakPrice = barHigh;
    }
  }

  if (active && peakIndex > troughIndex) {
    const gainPct = ((peakPrice / troughPrice) - 1) * 100;
    opportunities.push({
      startTs: bars[troughIndex].ts,
      endTs: bars[peakIndex].ts,
      startIso: formatIso(bars[troughIndex].ts),
      endIso: formatIso(bars[peakIndex].ts),
      bars: Math.max(1, peakIndex - troughIndex + 1),
      entryPrice: round(troughPrice, 6),
      peakPrice: round(peakPrice, 6),
      gainPct: round(gainPct, 2),
    });
  }

  return opportunities.filter((item) => item.gainPct >= MIN_UPSWING_PCT);
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);

  const candles = await loadHistoricalCandles({
    symbol: "TWTUSDT",
    cacheRoot: CACHE_ROOT,
    startMs: START_TS,
    endMs: END_TS,
  });
  const bars = resampleTo12h(candles);
  const segments = splitBarsByWindows(bars, cashOnlyWindows);

  const rawOpportunities = segments.flatMap((segment) => extractUpsideOpportunities(segment));
  const opportunities = rawOpportunities.filter(
    (item) => item.bars >= SANITY_MIN_BARS && item.gainPct <= SANITY_MAX_GAIN_PCT,
  );

  const totalGrossPct = round(opportunities.reduce((sum, item) => sum + item.gainPct, 0));
  const compoundedEquity = round(
    opportunities.reduce((equity, item) => equity * (1 + item.gainPct / 100), 10_000),
  );
  const avgGainPct = round(
    opportunities.length ? opportunities.reduce((sum, item) => sum + item.gainPct, 0) / opportunities.length : 0,
  );

  const md = [
    "# TWT Price Opportunities Inside V7 Cash-only Windows",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- start_utc: ${formatIso(START_TS)}`,
    `- end_utc: ${formatIso(END_TS)}`,
    `- cash_window_count: ${cashOnlyWindows.length}`,
    `- min_upswing_pct: ${MIN_UPSWING_PCT}%`,
    `- retrace_confirm_pct: ${RETRACE_CONFIRM_PCT}%`,
    `- sanity_filter: bars >= ${SANITY_MIN_BARS}, gain <= ${SANITY_MAX_GAIN_PCT}%`,
    "",
    "## Summary",
    "",
    `- raw_price_opportunity_count: ${rawOpportunities.length}`,
    `- qualified_price_opportunity_count: ${opportunities.length}`,
    `- qualified_total_gross_pct: ${totalGrossPct}%`,
    `- qualified_avg_gain_pct: ${avgGainPct}%`,
    `- qualified_compounded_equity: ${compoundedEquity}`,
    `- logic_trade_count_in_previous_twt_test: 1`,
    "",
    "## Qualified Price Opportunities",
    "",
    ...(
      opportunities.length
        ? opportunities.map(
            (window, index) =>
              `${index + 1}. ${window.startIso} -> ${window.endIso}: ${window.gainPct}% (${window.bars} bars)`,
          )
        : ["- none"]
    ),
    "",
    "## Cash-only Windows",
    "",
    ...cashOnlyWindows.map(
      (window, index) => `${index + 1}. ${formatIso(window.startTs)} -> ${formatIso(window.endTs)}`,
    ),
  ].join("\n");

  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify(
      {
        cashOnlyWindows,
        rawOpportunityCount: rawOpportunities.length,
        qualifiedOpportunityCount: opportunities.length,
        totalGrossPct,
        avgGainPct,
        compoundedEquity,
        opportunities,
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(
    JSON.stringify(
      {
        rawOpportunityCount: rawOpportunities.length,
        qualifiedOpportunityCount: opportunities.length,
        totalGrossPct,
        avgGainPct,
        compoundedEquity,
        opportunities,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
