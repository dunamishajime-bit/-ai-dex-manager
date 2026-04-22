import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { BacktestResult, TradePairRow } from "../lib/backtest/types";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "v5-improvement-analysis");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const SYMBOLS = ["ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ"] as const;

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeBySymbol<T extends number>(
  base: Record<string, T> | undefined,
  additions: Record<string, T>,
) {
  return {
    ...(base ?? {}),
    ...additions,
  };
}

function summarizeSymbolTrades(rows: TradePairRow[]) {
  return Object.fromEntries(
    SYMBOLS.map((symbol) => {
      const trades = rows.filter((row) => row.symbol === symbol);
      const wins = trades.filter((row) => row.net_pnl > 0);
      const losses = trades.filter((row) => row.net_pnl <= 0);
      const total = trades.reduce((sum, row) => sum + row.net_pnl, 0);
      return [
        symbol,
        {
          tradeCount: trades.length,
          wins: wins.length,
          losses: losses.length,
          totalNetPnl: round(total),
          avgNetPnl: trades.length ? round(total / trades.length) : 0,
        },
      ];
    }),
  );
}

function summarizeLossReasons(rows: TradePairRow[]) {
  const losses = rows.filter((row) => row.net_pnl <= 0);
  const grouped = new Map<string, TradePairRow[]>();
  for (const row of losses) {
    const bucket = grouped.get(row.symbol) ?? [];
    bucket.push(row);
    grouped.set(row.symbol, bucket);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([symbol, symbolRows]) => {
      const reasonMap = new Map<string, TradePairRow[]>();
      for (const row of symbolRows) {
        const key = row.exit_reason || "unknown";
        const bucket = reasonMap.get(key) ?? [];
        bucket.push(row);
        reasonMap.set(key, bucket);
      }
      const summary = [...reasonMap.entries()]
        .map(([reason, reasonRows]) => ({
          reason,
          count: reasonRows.length,
          totalNetPnl: round(reasonRows.reduce((sum, row) => sum + row.net_pnl, 0)),
        }))
        .sort((left, right) => left.totalNetPnl - right.totalNetPnl);
      return [symbol, summary];
    }),
  );
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

function buildVariants(): VariantSpec[] {
  const base = baseOptions();
  return [
    {
      key: "base_v5",
      thesis: "Current production v5 as deployed.",
      options: {
        ...base,
        label: "base_v5",
      },
    },
    {
      key: "v5_no_sol_specific",
      thesis: "Remove SOL score demotion and re-enable SOL aux range to verify SOL-specific logic actually matters.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: {},
        auxRangeSymbols: ["AVAX", "SOL"],
        label: "v5_no_sol_specific",
      },
    },
    {
      key: "v5_inj_dedicated",
      thesis: "Keep v5, but add the dedicated INJ breakout-surge conditions that previously tested well.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: mergeBySymbol(base.trendBreakoutLookbackBarsBySymbol, { INJ: 3 }),
        trendBreakoutMinPctBySymbol: mergeBySymbol(base.trendBreakoutMinPctBySymbol, { INJ: 0.025 }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, { INJ: 1.25 }),
        trendMinMomAccelBySymbol: mergeBySymbol(base.trendMinMomAccelBySymbol, { INJ: 0.02 }),
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, { INJ: 0.2 }),
        symbolSpecificTrendWeakExitSymbols: ["INJ"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: 0,
        label: "v5_inj_dedicated",
      },
    },
    {
      key: "v5_eth_quality",
      thesis: "Raise ETH entry quality slightly to reduce risk-off and weak entries.",
      options: {
        ...base,
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, { ETH: 0.24 }),
        trendMinMomAccelBySymbol: mergeBySymbol(base.trendMinMomAccelBySymbol, { ETH: 0.002 }),
        label: "v5_eth_quality",
      },
    },
    {
      key: "v5_sol_minus10",
      thesis: "Push SOL priority a bit lower to suppress weak SOL participation further.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: mergeBySymbol(base.trendScoreAdjustmentBySymbol, { SOL: -10 }),
        label: "v5_sol_minus10",
      },
    },
    {
      key: "v5_combo",
      thesis: "Combine dedicated INJ logic, better ETH quality, and stronger SOL suppression.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: mergeBySymbol(base.trendBreakoutLookbackBarsBySymbol, { INJ: 3 }),
        trendBreakoutMinPctBySymbol: mergeBySymbol(base.trendBreakoutMinPctBySymbol, { INJ: 0.025 }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, { INJ: 1.25 }),
        trendMinMomAccelBySymbol: mergeBySymbol(base.trendMinMomAccelBySymbol, { INJ: 0.02, ETH: 0.002 }),
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, {
          INJ: 0.2,
          ETH: 0.24,
        }),
        symbolSpecificTrendWeakExitSymbols: ["INJ"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: 0,
        trendScoreAdjustmentBySymbol: mergeBySymbol(base.trendScoreAdjustmentBySymbol, { SOL: -10 }),
        label: "v5_combo",
      },
    },
  ];
}

async function runVariant(spec: VariantSpec) {
  const result = await runHybridBacktest("RETQ22", spec.options);
  await writeBacktestArtifacts(result, path.join(REPORT_DIR, spec.key));
  return {
    key: spec.key,
    thesis: spec.thesis,
    summary: {
      endEquity: round(result.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      winRatePct: round(result.summary.win_rate_pct),
      tradeCount: result.summary.trade_count,
      exposurePct: round(result.summary.exposure_pct),
    },
    symbolStats: summarizeSymbolTrades(result.trade_pairs),
    lossReasons: summarizeLossReasons(result.trade_pairs),
  };
}

function buildMarkdown(rows: Awaited<ReturnType<typeof runVariant>>[]) {
  return [
    "# V5 Improvement Analysis",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "## Variant Summary",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.summary.endEquity} | ${row.summary.cagrPct} | ${row.summary.maxDrawdownPct} | ${row.summary.profitFactor} | ${row.summary.winRatePct} | ${row.summary.tradeCount} | ${row.summary.exposurePct} |`,
    ),
    "",
    ...rows.flatMap((row) => [
      `## ${row.key}`,
      "",
      "### Symbol Stats",
      "",
      "| symbol | trades | wins | losses | total pnl | avg pnl |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...SYMBOLS.map((symbol) => {
        const stats = row.symbolStats[symbol];
        return `| ${symbol} | ${stats.tradeCount} | ${stats.wins} | ${stats.losses} | ${stats.totalNetPnl} | ${stats.avgNetPnl} |`;
      }),
      "",
      "### Loss Reasons",
      "",
      ...SYMBOLS.map((symbol) => {
        const reasons = row.lossReasons[symbol] ?? [];
        if (!reasons.length) return `- ${symbol}: no losing trades`;
        return `- ${symbol}: ${reasons.map((item) => `${item.reason} (${item.count}, ${item.totalNetPnl})`).join(" / ")}`;
      }),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  for (const variant of buildVariants()) {
    rows.push(await runVariant(variant));
  }

  rows.sort((left, right) => right.summary.endEquity - left.summary.endEquity);
  const markdown = buildMarkdown(rows);
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), markdown, "utf8");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
