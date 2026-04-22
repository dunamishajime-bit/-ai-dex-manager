import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";
import type { EquityPoint, HybridDecisionWindowPoint } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "production-improvement-analysis");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

type IdleWindow = {
  startTs: number;
  endTs: number;
  startIso: string;
  endIso: string;
  bars: number;
  days: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function inferBarMs(points: EquityPoint[]) {
  const diffs: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const diff = points[i].ts - points[i - 1].ts;
    if (diff > 0) diffs.push(diff);
  }
  return median(diffs) || 12 * 60 * 60 * 1000;
}

function collectIdleWindows(points: EquityPoint[], barMs: number) {
  const windows: IdleWindow[] = [];
  let startIndex = -1;
  for (let i = 0; i < points.length; i += 1) {
    const isCash = points[i].position_side === "cash";
    if (isCash && startIndex === -1) {
      startIndex = i;
      continue;
    }
    if (!isCash && startIndex !== -1) {
      const start = points[startIndex];
      const end = points[i - 1];
      const bars = i - startIndex;
      windows.push({
        startTs: start.ts,
        endTs: end.ts,
        startIso: start.iso_time,
        endIso: end.iso_time,
        bars,
        days: round((bars * barMs) / (24 * 60 * 60 * 1000), 2),
      });
      startIndex = -1;
    }
  }
  if (startIndex !== -1) {
    const start = points[startIndex];
    const end = points.at(-1)!;
    const bars = points.length - startIndex;
    windows.push({
      startTs: start.ts,
      endTs: end.ts,
      startIso: start.iso_time,
      endIso: end.iso_time,
      bars,
      days: round((bars * barMs) / (24 * 60 * 60 * 1000), 2),
    });
  }
  return windows.sort((a, b) => b.days - a.days);
}

function analyzeIdleWindow(window: IdleWindow, decisions: HybridDecisionWindowPoint[]) {
  const rows = decisions.filter((point) => point.ts >= window.startTs && point.ts <= window.endTs);
  const topScores = rows.map((row) => row.trendEvaluations[0]).filter(Boolean);
  const strictExtraRows = rows.map((row) => row.trendEvaluations.find((item) => item.symbol === "PENGU")).filter(Boolean);
  const reserveWaitCount = rows.filter((row) => row.decision.desiredSide === "cash").length;
  const trendEligibleRows = rows.filter((row) => row.trendEvaluations.some((item) => item.eligible));
  const penguEligibleRows = strictExtraRows.filter((row) => row.eligible);

  return {
    startIso: window.startIso,
    endIso: window.endIso,
    days: window.days,
    bars: window.bars,
    reserveWaitCount,
    trendEligibleCount: trendEligibleRows.length,
    penguEligibleCount: penguEligibleRows.length,
    maxTopScore: round(Math.max(...topScores.map((row) => row.score), Number.NEGATIVE_INFINITY), 2),
    maxPenguScore: round(Math.max(...strictExtraRows.map((row) => row.score), Number.NEGATIVE_INFINITY), 2),
    topSymbolFrequency: Object.entries(
      topScores.reduce<Record<string, number>>((acc, row) => {
        acc[row.symbol] = (acc[row.symbol] || 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3),
    blockedExamples: rows
      .filter((row) => row.decision.desiredSide === "cash")
      .slice(0, 5)
      .map((row) => ({
        isoTime: row.isoTime,
        top: row.trendEvaluations[0]
          ? {
              symbol: row.trendEvaluations[0].symbol,
              score: round(row.trendEvaluations[0].score, 2),
              eligible: row.trendEvaluations[0].eligible,
              reasons: row.trendEvaluations[0].reasons.join("|"),
            }
          : null,
      })),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseOptions: HybridVariantOptions = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "current_production_base",
  };

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "base",
      thesis: "Current live implementation.",
      options: baseOptions,
    },
    {
      key: "eth_sol_weak_exit",
      thesis: "Add earlier weak exit for ETH and SOL when both momentum and momentum acceleration deteriorate.",
      options: {
        ...baseOptions,
        symbolSpecificTrendWeakExitSymbols: ["ETH", "SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.015,
        label: "eth_sol_weak_exit",
      },
    },
    {
      key: "pengu_rotate_volume_filter",
      thesis: "Keep current logic but require stronger volume when PENGU enters as strict-extra candidate.",
      options: {
        ...baseOptions,
        strictExtraTrendMinVolumeRatio: 1.15,
        label: "pengu_rotate_volume_filter",
      },
    },
    {
      key: "combo",
      thesis: "Combine ETH/SOL weak exit and PENGU strict-extra volume filter.",
      options: {
        ...baseOptions,
        symbolSpecificTrendWeakExitSymbols: ["ETH", "SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.015,
        strictExtraTrendMinVolumeRatio: 1.15,
        label: "combo",
      },
    },
  ];

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    const lossCount = result.trade_pairs.filter((trade) => trade.net_pnl <= 0).length;
    const smaBreakLossCount = result.trade_pairs.filter((trade) => trade.net_pnl <= 0 && trade.exit_reason === "sma-break").length;
    const riskOffLossCount = result.trade_pairs.filter((trade) => trade.net_pnl <= 0 && trade.exit_reason === "risk-off").length;
    const rotateLossCount = result.trade_pairs.filter((trade) => trade.net_pnl <= 0 && trade.exit_reason === "strict-extra-rotate").length;
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      end_equity: round(result.summary.end_equity, 2),
      cagr_pct: round(result.summary.cagr_pct, 2),
      max_drawdown_pct: round(result.summary.max_drawdown_pct, 2),
      profit_factor: round(result.summary.profit_factor, 3),
      trade_count: result.summary.trade_count,
      loss_count: lossCount,
      sma_break_losses: smaBreakLossCount,
      risk_off_losses: riskOffLossCount,
      strict_extra_rotate_losses: rotateLossCount,
      exposure_pct: round(result.summary.exposure_pct, 2),
      pengu_contribution: round(result.summary.symbol_contribution.PENGU ?? 0, 2),
      summary: formatResultSummary(result),
    });
  }

  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", baseOptions);
  const baseResult = await runHybridBacktest("RETQ22", baseOptions);
  const idleWindows = collectIdleWindows(baseResult.equity_curve, inferBarMs(baseResult.equity_curve));
  const topIdleAnalyses = idleWindows.slice(0, 8).map((window) => analyzeIdleWindow(window, decisionWindow));

  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify({ rows, topIdleAnalyses }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# Production Improvement Analysis",
      "",
      "## Variant Comparison",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | trades | losses | sma-break losses | risk-off losses | rotate losses | exposure % | PENGU contribution |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.trade_count} | ${row.loss_count} | ${row.sma_break_losses} | ${row.risk_off_losses} | ${row.strict_extra_rotate_losses} | ${row.exposure_pct} | ${row.pengu_contribution} |`),
      "",
      "## Longest Idle Window Diagnostics",
      "",
      "| start | end | days | reserve-wait bars | trend eligible bars | PENGU eligible bars | max top score | max PENGU score | top symbols |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
      ...topIdleAnalyses.map((item) => `| ${item.startIso} | ${item.endIso} | ${item.days} | ${item.reserveWaitCount} | ${item.trendEligibleCount} | ${item.penguEligibleCount} | ${item.maxTopScore} | ${item.maxPenguScore} | ${item.topSymbolFrequency.map(([symbol, count]) => `${symbol}:${count}`).join(", ")} |`),
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify({ rows, topIdleAnalyses }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
