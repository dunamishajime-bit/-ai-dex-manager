import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import {
  analyzeHybridDecisionWindow,
  type HybridDecisionWindowPoint,
  type HybridLiveDecisionDetails,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";
import { resampleTo12h } from "../lib/backtest/indicators";
import type { Candle12h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "twt-missed-opportunities");
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

type OpportunityAnalysis = {
  startIso: string;
  endIso: string;
  gainPct: number;
  bars: number;
  twtSeen: boolean;
  eligible: boolean;
  selected: boolean;
  bestScore: number | null;
  topReasons: string[];
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

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
}

function withSymbolMapNumber(
  map: Record<string, number> | undefined,
  symbol: string,
  value: number,
) {
  return {
    ...(map ?? {}),
    [symbol]: value,
  };
}

function withSymbolBlockWindows(
  map: Record<string, readonly Window[]> | undefined,
  symbol: string,
  windows: readonly Window[],
) {
  return {
    ...(map ?? {}),
    [symbol]: windows,
  };
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

function invertWindows(
  windows: readonly Window[],
  startTs: number,
  endTs: number,
) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
  let cursor = startTs;

  for (const window of sorted) {
    if (window.startTs > cursor) {
      inverted.push({ startTs: cursor, endTs: window.startTs });
    }
    cursor = Math.max(cursor, window.endTs);
  }

  if (cursor < endTs) {
    inverted.push({ startTs: cursor, endTs: endTs });
  }

  return inverted.filter((window) => window.endTs > window.startTs);
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

  return opportunities.filter(
    (item) => item.gainPct >= MIN_UPSWING_PCT && item.bars >= SANITY_MIN_BARS && item.gainPct <= SANITY_MAX_GAIN_PCT,
  );
}

function applyTrxLogic(base: HybridVariantOptions, symbol: string): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, symbol, 8),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, symbol, 0.012),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, symbol, 1.01),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, symbol, 0.0005),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, symbol, 0.17),
  };
}

function buildConfiguredBase(base: HybridVariantOptions, symbol: "TWT", nonCashWindows: readonly Window[]) {
  const expandedTrendSymbols = unique([...(base.expandedTrendSymbols ?? []), symbol]);
  return {
    ...base,
    expandedTrendSymbols,
    trendSymbolBlockWindows: withSymbolBlockWindows(base.trendSymbolBlockWindows, symbol, nonCashWindows),
  };
}

function aggregateReasons(evaluations: HybridDecisionWindowPoint[]) {
  const counts = new Map<string, number>();
  for (const point of evaluations) {
    const twt = point.trendEvaluations.find((item) => item.symbol === "TWT");
    if (!twt) continue;
    for (const reason of twt.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = baseOptions();
  const baselineWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(baselineWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);

  const twtOptions = applyTrxLogic(buildConfiguredBase(base, "TWT", nonCashWindows), "TWT");
  const twtWindow = await analyzeHybridDecisionWindow("RETQ22", twtOptions);

  const candles = await loadHistoricalCandles({
    symbol: "TWTUSDT",
    cacheRoot: CACHE_ROOT,
    startMs: START_TS,
    endMs: END_TS,
  });
  const bars = resampleTo12h(candles);
  const segments = splitBarsByWindows(bars, cashOnlyWindows);
  const opportunities = segments.flatMap((segment) => extractUpsideOpportunities(segment));

  const analyzed: OpportunityAnalysis[] = opportunities.map((opportunity) => {
    const points = twtWindow.filter((point) => point.ts >= opportunity.startTs && point.ts <= opportunity.endTs);
    const twtEvals = points
      .map((point) => ({
        point,
        eval: point.trendEvaluations.find((item) => item.symbol === "TWT"),
      }))
      .filter((item): item is { point: HybridDecisionWindowPoint; eval: HybridDecisionWindowPoint["trendEvaluations"][number] } => Boolean(item.eval));

    const best = twtEvals.length
      ? [...twtEvals].sort((a, b) => b.eval.score - a.eval.score)[0]
      : null;
    const eligible = twtEvals.some((item) => item.eval.eligible);
    const selected = points.some((point) => point.decision.desiredSymbol === "TWT");
    const topReasons = best?.eval.reasons.slice(0, 6) ?? [];

    return {
      startIso: opportunity.startIso,
      endIso: opportunity.endIso,
      gainPct: opportunity.gainPct,
      bars: opportunity.bars,
      twtSeen: twtEvals.length > 0,
      eligible,
      selected,
      bestScore: best ? round(best.eval.score) : null,
      topReasons,
    };
  });

  const selectedCount = analyzed.filter((item) => item.selected).length;
  const eligibleNotSelected = analyzed.filter((item) => item.eligible && !item.selected);
  const neverEligible = analyzed.filter((item) => !item.eligible);
  const reasonCounts = aggregateReasons(
    twtWindow.filter((point) =>
      opportunities.some((opportunity) => point.ts >= opportunity.startTs && point.ts <= opportunity.endTs),
    ),
  );

  const md = [
    "# TWT Missed Opportunity Analysis",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- total_price_opportunities: ${opportunities.length}`,
    `- selected_by_current_twt_logic: ${selectedCount}`,
    `- eligible_but_not_selected: ${eligibleNotSelected.length}`,
    `- never_eligible: ${neverEligible.length}`,
    "",
    "## Top blocking reasons inside opportunity windows",
    "",
    ...reasonCounts.slice(0, 12).map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "## Opportunity breakdown",
    "",
    "| start | end | gain % | bars | twt seen | eligible | selected | best score | top reasons |",
    "| --- | --- | ---: | ---: | --- | --- | --- | ---: | --- |",
    ...analyzed.map(
      (item) =>
        `| ${item.startIso} | ${item.endIso} | ${item.gainPct} | ${item.bars} | ${item.twtSeen ? "yes" : "no"} | ${item.eligible ? "yes" : "no"} | ${item.selected ? "yes" : "no"} | ${item.bestScore ?? "-"} | ${item.topReasons.join(", ")} |`,
    ),
  ].join("\n");

  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify(
      {
        totalPriceOpportunities: opportunities.length,
        selectedCount,
        eligibleNotSelectedCount: eligibleNotSelected.length,
        neverEligibleCount: neverEligible.length,
        topReasonCounts: reasonCounts,
        opportunities: analyzed,
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
        totalPriceOpportunities: opportunities.length,
        selectedCount,
        eligibleNotSelectedCount: eligibleNotSelected.length,
        neverEligibleCount: neverEligible.length,
        topReasonCounts: reasonCounts.slice(0, 12),
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
