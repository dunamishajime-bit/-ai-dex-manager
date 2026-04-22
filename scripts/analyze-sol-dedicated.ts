import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
} from "../lib/backtest/hybrid-engine";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { buildIndicatorBars, resampleTo12h } from "../lib/backtest/indicators";
import type { IndicatorBar, TradePairRow } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "sol-dedicated-analysis");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

type TrendWindow = {
  startTs: number;
  endTs: number;
  startIso: string;
  endIso: string;
  bars: number;
  startPrice: number;
  peakPrice: number;
  endPrice: number;
  returnPct: number;
  peakPct: number;
  avgMom20: number;
  avgAdx14: number;
  avgEfficiency: number;
  enteredByCurrentLogic: boolean;
  overlappingTradeIds: string[];
};

type MissedWindowAnalysis = TrendWindow & {
  classification: string;
  eligibleBars: number;
  desiredSolBars: number;
  desiredCashBars: number;
  dominantDesiredSymbol: string;
  dominantHeldSymbol: string;
  overlappingActiveSymbols: string[];
  note: string;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatIso(ts: number) {
  return new Date(ts).toISOString();
}

function calcEfficiencyRatio(bars: IndicatorBar[], endIndex: number, lookback: number) {
  if (endIndex <= 0 || endIndex - lookback < 0) return 0;
  const endClose = bars[endIndex]?.close;
  const startClose = bars[endIndex - lookback]?.close;
  if (!Number.isFinite(endClose) || !Number.isFinite(startClose)) return 0;
  let path = 0;
  for (let i = endIndex - lookback + 1; i <= endIndex; i += 1) {
    path += Math.abs(bars[i].close - bars[i - 1].close);
  }
  if (path <= 0) return 0;
  return Math.abs(endClose - startClose) / path;
}

function buildTrendWindows(solBars: IndicatorBar[], solTrades: TradePairRow[]) {
  const windows: TrendWindow[] = [];
  let startIndex = -1;
  let peakPrice = 0;

  const isTrendable = (bar: IndicatorBar, index: number) => {
    const efficiency = calcEfficiencyRatio(solBars, index, 6);
    return (
      bar.ready &&
      bar.close > bar.sma40 &&
      bar.mom20 >= 0.12 &&
      bar.adx14 >= 18 &&
      efficiency >= 0.18
    );
  };

  for (let i = 0; i < solBars.length; i += 1) {
    const bar = solBars[i];
    const trendable = isTrendable(bar, i);

    if (trendable && startIndex === -1) {
      startIndex = i;
      peakPrice = bar.high;
      continue;
    }

    if (trendable && startIndex !== -1) {
      peakPrice = Math.max(peakPrice, bar.high);
      continue;
    }

    if (!trendable && startIndex !== -1) {
      const endIndex = i - 1;
      const segment = solBars.slice(startIndex, endIndex + 1);
      if (segment.length >= 3) {
        const startBar = solBars[startIndex];
        const endBar = solBars[endIndex];
        const returnPct = ((endBar.close / startBar.close) - 1) * 100;
        const peakPct = ((peakPrice / startBar.close) - 1) * 100;
        if (peakPct >= 15) {
          const overlapping = solTrades.filter((trade) => {
            const entryTs = new Date(trade.entry_time).getTime();
            return entryTs >= startBar.ts && entryTs <= endBar.ts;
          });
          windows.push({
            startTs: startBar.ts,
            endTs: endBar.ts,
            startIso: formatIso(startBar.ts),
            endIso: formatIso(endBar.ts),
            bars: segment.length,
            startPrice: startBar.close,
            peakPrice,
            endPrice: endBar.close,
            returnPct: round(returnPct, 2),
            peakPct: round(peakPct, 2),
            avgMom20: round(segment.reduce((sum, item) => sum + item.mom20, 0) / segment.length, 4),
            avgAdx14: round(segment.reduce((sum, item) => sum + item.adx14, 0) / segment.length, 2),
            avgEfficiency: round(segment.reduce((sum, _item, idx) => sum + calcEfficiencyRatio(solBars, startIndex + idx, 6), 0) / segment.length, 3),
            enteredByCurrentLogic: overlapping.length > 0,
            overlappingTradeIds: overlapping.map((trade) => trade.trade_id),
          });
        }
      }
      startIndex = -1;
      peakPrice = 0;
    }
  }

  return windows;
}

function intervalsOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function summarizeCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function analyzeMissedWindows(
  missedWindows: TrendWindow[],
  tradePairs: TradePairRow[],
  equityCurve: { ts: number; position_symbol: string; position_side: string }[],
  decisions: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>,
) {
  return missedWindows.map<MissedWindowAnalysis>((window) => {
    const decisionPoints = decisions.filter((point) => point.ts >= window.startTs && point.ts <= window.endTs);
    const equityPoints = equityCurve.filter((point) => point.ts >= window.startTs && point.ts <= window.endTs);
    const overlappingActiveTrades = tradePairs.filter((trade) => {
      const entryTs = new Date(trade.entry_time).getTime();
      const exitTs = new Date(trade.exit_time).getTime();
      return trade.symbol !== "SOL" && intervalsOverlap(window.startTs, window.endTs, entryTs, exitTs);
    });

    const eligibleBars = decisionPoints.filter((point) =>
      point.trendEvaluations.find((evaluation) => evaluation.symbol === "SOL")?.eligible,
    ).length;
    const desiredSolBars = decisionPoints.filter((point) => point.decision.desiredSymbol === "SOL").length;
    const desiredCashBars = decisionPoints.filter((point) => point.decision.desiredSide === "cash").length;
    const desiredCounts = summarizeCounts(decisionPoints.map((point) => point.decision.desiredSymbol || "cash"));
    const heldCounts = summarizeCounts(
      equityPoints
        .filter((point) => point.position_side !== "cash")
        .map((point) => point.position_symbol || "cash"),
    );
    const overlappingSymbols = [...new Set(overlappingActiveTrades.map((trade) => trade.symbol))];
    const dominantDesiredSymbol = desiredCounts[0]?.[0] ?? "cash";
    const dominantHeldSymbol = heldCounts[0]?.[0] ?? "cash";

    let classification = "sol_not_ready";
    let note = "SOL did not satisfy the 12H entry conditions consistently enough to enter.";

    if (eligibleBars > 0 && desiredSolBars === 0 && dominantDesiredSymbol !== "cash") {
      classification = "other_symbol_preferred";
      note = `SOL became eligible on some bars, but ${dominantDesiredSymbol} was preferred by the ranking.`;
    } else if (overlappingSymbols.length > 0 && dominantHeldSymbol !== "cash") {
      classification = "other_symbol_already_held";
      note = `${dominantHeldSymbol} was already held, so the single-position rule blocked a SOL entry.`;
    } else if (desiredCashBars === decisionPoints.length && decisionPoints.length > 0) {
      classification = "cash_wait";
      note = "The regime gate or SOL-specific conditions kept the system in USDT.";
    } else if (eligibleBars > 0 && desiredSolBars > 0) {
      classification = "timing_mismatch";
      note = "SOL became a desired symbol at times, but the actual trade timing did not overlap this trend window.";
    }

    return {
      ...window,
      classification,
      eligibleBars,
      desiredSolBars,
      desiredCashBars,
      dominantDesiredSymbol,
      dominantHeldSymbol,
      overlappingActiveSymbols: overlappingSymbols,
      note,
    };
  });
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const options = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "sol_dedicated_analysis",
  } as const;

  const result = await runHybridBacktest("RETQ22", options);
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", options);
  const solTrades = result.trade_pairs.filter((trade) => trade.symbol === "SOL");

  const raw = await loadHistoricalCandles({
    symbol: "SOLUSDT",
    cacheRoot: path.join(process.cwd(), ".cache", "sol-dedicated-analysis"),
    startMs: START_TS,
    endMs: END_TS,
  });
  const solBars = buildIndicatorBars(resampleTo12h(raw));
  const windows = buildTrendWindows(solBars, solTrades);

  const lossTrades = solTrades.filter((trade) => trade.net_pnl <= 0);
  const lossByReason = Object.entries(
    lossTrades.reduce<Record<string, { count: number; total: number }>>((acc, trade) => {
      const key = trade.exit_reason;
      acc[key] = acc[key] || { count: 0, total: 0 };
      acc[key].count += 1;
      acc[key].total += trade.net_pnl;
      return acc;
    }, {}),
  )
    .map(([reason, row]) => ({
      reason,
      count: row.count,
      totalNetPnl: round(row.total, 2),
      avgNetPnl: round(row.total / row.count, 2),
    }))
    .sort((a, b) => b.count - a.count || a.totalNetPnl - b.totalNetPnl);

  const missedWindows = windows.filter((window) => !window.enteredByCurrentLogic);
  const capturedWindows = windows.filter((window) => window.enteredByCurrentLogic);
  const missedWindowAnalysis = analyzeMissedWindows(
    missedWindows,
    result.trade_pairs,
    result.equity_curve,
    decisionWindow,
  );
  const worstLosses = [...lossTrades]
    .sort((a, b) => a.net_pnl - b.net_pnl)
    .slice(0, 10)
    .map((trade) => ({
      trade_id: trade.trade_id,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      net_pnl: round(trade.net_pnl, 2),
      holding_bars: trade.holding_bars,
      entry_reason: trade.entry_reason,
      exit_reason: trade.exit_reason,
    }));

  const summary = {
    solTrendableWindows: windows.length,
    solTrendableWindowsCaptured: capturedWindows.length,
    solTrendableWindowsMissed: missedWindows.length,
    solTradeCount: solTrades.length,
    solLossCount: lossTrades.length,
    solWinCount: solTrades.length - lossTrades.length,
    solNetPnl: round(solTrades.reduce((sum, trade) => sum + trade.net_pnl, 0), 2),
    solLossByReason: lossByReason,
    missedWindowClassification: Object.entries(
      missedWindowAnalysis.reduce<Record<string, number>>((acc, window) => {
        acc[window.classification] = (acc[window.classification] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([classification, count]) => ({ classification, count })),
  };

  const md = [
    "# SOL Dedicated Analysis",
    "",
    "## Summary",
    "",
    `- trendable_windows_estimated: ${summary.solTrendableWindows}`,
    `- trendable_windows_captured: ${summary.solTrendableWindowsCaptured}`,
    `- trendable_windows_missed: ${summary.solTrendableWindowsMissed}`,
    `- sol_trade_count: ${summary.solTradeCount}`,
    `- sol_loss_count: ${summary.solLossCount}`,
    `- sol_win_count: ${summary.solWinCount}`,
    `- sol_net_pnl: ${summary.solNetPnl}`,
    "",
    "Trendable window assumption:",
    "- 12H close > SMA40",
    "- mom20 >= 12%",
    "- ADX14 >= 18",
    "- efficiency >= 0.18",
    "- at least 3 bars",
    "- peak move inside the window >= 15%",
    "",
    "## Loss Reasons",
    "",
    "| exit reason | count | total net pnl | avg net pnl |",
    "| --- | ---: | ---: | ---: |",
    ...lossByReason.map((row) => `| ${row.reason} | ${row.count} | ${row.totalNetPnl} | ${row.avgNetPnl} |`),
    "",
    "## Trendable Windows",
    "",
    "| start | end | bars | return % | peak % | avg mom20 | avg adx14 | avg eff | entered | overlapping trades |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...windows.map((window) => `| ${window.startIso} | ${window.endIso} | ${window.bars} | ${window.returnPct} | ${window.peakPct} | ${window.avgMom20} | ${window.avgAdx14} | ${window.avgEfficiency} | ${window.enteredByCurrentLogic ? "yes" : "no"} | ${window.overlappingTradeIds.join(", ")} |`),
    "",
    "## Missed Trendable Windows",
    "",
    "| start | end | bars | return % | peak % | class | desired | held | note |",
    "| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |",
    ...missedWindowAnalysis.map((window) => `| ${window.startIso} | ${window.endIso} | ${window.bars} | ${window.returnPct} | ${window.peakPct} | ${window.classification} | ${window.dominantDesiredSymbol} | ${window.dominantHeldSymbol} | ${window.note} |`),
    "",
    "## Worst SOL Losses",
    "",
    "| trade id | entry | exit | net pnl | bars | entry reason | exit reason |",
    "| --- | --- | --- | ---: | ---: | --- | --- |",
    ...worstLosses.map((trade) => `| ${trade.trade_id} | ${trade.entry_time} | ${trade.exit_time} | ${trade.net_pnl} | ${trade.holding_bars} | ${trade.entry_reason} | ${trade.exit_reason} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ summary, windows, missedWindows, missedWindowAnalysis, worstLosses }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({ summary, windows: windows.length, missedWindows: missedWindows.length, worstLosses }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
