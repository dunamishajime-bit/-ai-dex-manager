import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "near-inj-dedicated");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const ALL_WINDOW = [{ startTs: START_TS, endTs: END_TS }] as const;

type Family = "NEAR" | "INJ";

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function blockAllBaseSymbols() {
  const block: Record<string, readonly { startTs: number; endTs: number }[]> = {};
  for (const symbol of ["ETH", "SOL", "AVAX"]) {
    block[symbol] = ALL_WINDOW;
  }
  return block;
}

function baseSingleSymbol(symbol: Family): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    strictExtraTrendSymbols: undefined,
    expandedTrendSymbols: [symbol],
    rangeSymbols: [] as unknown as readonly ("ETH" | "SOL" | "AVAX")[],
    auxRangeSymbols: [] as unknown as readonly ("ETH" | "SOL" | "AVAX")[],
    trendSymbolBlockWindows: blockAllBaseSymbols(),
  } satisfies HybridVariantOptions;
}

function buildNearVariants(): VariantSpec[] {
  const base = baseSingleSymbol("NEAR");
  return [
    {
      key: "near_base_only",
      thesis: "NEAR only with current production-style trend logic.",
      options: { ...base, label: "near_base_only" },
    },
    {
      key: "near_smooth_trend",
      thesis: "Smooth medium-term trend follow: moderate breakout, positive acceleration, clean path.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { NEAR: 6 },
        trendBreakoutMinPctBySymbol: { NEAR: 0.015 },
        trendMinMomAccelBySymbol: { NEAR: 0.001 },
        trendMinEfficiencyRatioBySymbol: { NEAR: 0.18 },
        trendMinVolumeRatioBySymbol: { NEAR: 1.02 },
        label: "near_smooth_trend",
      },
    },
    {
      key: "near_smooth_trend_fast_fail",
      thesis: "Same NEAR trend entry, but exit a bit earlier when momentum rolls over.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { NEAR: 6 },
        trendBreakoutMinPctBySymbol: { NEAR: 0.015 },
        trendMinMomAccelBySymbol: { NEAR: 0.001 },
        trendMinEfficiencyRatioBySymbol: { NEAR: 0.18 },
        trendMinVolumeRatioBySymbol: { NEAR: 1.02 },
        symbolSpecificTrendWeakExitSymbols: ["NEAR"],
        symbolSpecificTrendWeakExitMom20Below: 0.05,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.005,
        label: "near_smooth_trend_fast_fail",
      },
    },
    {
      key: "near_smooth_trend_trailing",
      thesis: "NEAR trend follow with profit protection after the move is established.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { NEAR: 6 },
        trendBreakoutMinPctBySymbol: { NEAR: 0.015 },
        trendMinMomAccelBySymbol: { NEAR: 0.001 },
        trendMinEfficiencyRatioBySymbol: { NEAR: 0.18 },
        trendMinVolumeRatioBySymbol: { NEAR: 1.02 },
        trendProfitTrailActivationPct: 0.18,
        trendProfitTrailRetracePct: 0.1,
        label: "near_smooth_trend_trailing",
      },
    },
  ];
}

function buildInjVariants(): VariantSpec[] {
  const base = baseSingleSymbol("INJ");
  return [
    {
      key: "inj_base_only",
      thesis: "INJ only with current production-style trend logic.",
      options: { ...base, label: "inj_base_only" },
    },
    {
      key: "inj_breakout_surge",
      thesis: "Fast breakout entry: stronger breakout, volume, acceleration and efficiency.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { INJ: 3 },
        trendBreakoutMinPctBySymbol: { INJ: 0.025 },
        trendMinVolumeRatioBySymbol: { INJ: 1.25 },
        trendMinMomAccelBySymbol: { INJ: 0.02 },
        trendMinEfficiencyRatioBySymbol: { INJ: 0.2 },
        label: "inj_breakout_surge",
      },
    },
    {
      key: "inj_breakout_surge_fast_exit",
      thesis: "INJ breakout with quicker failure exit when acceleration fades.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { INJ: 3 },
        trendBreakoutMinPctBySymbol: { INJ: 0.025 },
        trendMinVolumeRatioBySymbol: { INJ: 1.25 },
        trendMinMomAccelBySymbol: { INJ: 0.02 },
        trendMinEfficiencyRatioBySymbol: { INJ: 0.2 },
        symbolSpecificTrendWeakExitSymbols: ["INJ"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: 0,
        label: "inj_breakout_surge_fast_exit",
      },
    },
    {
      key: "inj_breakout_surge_trailing",
      thesis: "INJ breakout with tighter profit protection after the move extends.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { INJ: 3 },
        trendBreakoutMinPctBySymbol: { INJ: 0.025 },
        trendMinVolumeRatioBySymbol: { INJ: 1.25 },
        trendMinMomAccelBySymbol: { INJ: 0.02 },
        trendMinEfficiencyRatioBySymbol: { INJ: 0.2 },
        trendProfitTrailActivationPct: 0.15,
        trendProfitTrailRetracePct: 0.08,
        label: "inj_breakout_surge_trailing",
      },
    },
  ];
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>, symbol: Family) {
  const trades = result.trade_pairs.filter((trade) => trade.symbol === symbol);
  const losses = trades.filter((trade) => trade.net_pnl <= 0);
  const lossByReason = Object.entries(
    losses.reduce<Record<string, number>>((acc, trade) => {
      acc[trade.exit_reason] = (acc[trade.exit_reason] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    symbolTradeCount: trades.length,
    symbolWinCount: trades.length - losses.length,
    symbolLossCount: losses.length,
    symbolPnl: round(result.summary.symbol_contribution[symbol] ?? 0),
    exposurePct: round(result.summary.exposure_pct),
    topLossReason: lossByReason[0]?.[0] ?? "none",
    topLossReasonCount: lossByReason[0]?.[1] ?? 0,
  };
}

async function runFamily(symbol: Family, variants: VariantSpec[]) {
  const rows: Array<Record<string, unknown>> = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, symbol.toLowerCase(), variant.key));
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      ...summarize(result, symbol),
    });
  }

  rows.sort((left, right) => Number(right.endEquity) - Number(left.endEquity));
  return rows;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const nearRows = await runFamily("NEAR", buildNearVariants());
  const injRows = await runFamily("INJ", buildInjVariants());

  const out = {
    NEAR: nearRows,
    INJ: injRows,
  };

  const md = [
    "# NEAR / INJ Dedicated Logic",
    "",
    "## NEAR",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | symbol trades | wins | losses | pnl | top loss reason | count |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ...nearRows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.symbolTradeCount} | ${row.symbolWinCount} | ${row.symbolLossCount} | ${row.symbolPnl} | ${row.topLossReason} | ${row.topLossReasonCount} |`,
    ),
    "",
    "## INJ",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | symbol trades | wins | losses | pnl | top loss reason | count |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ...injRows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.symbolTradeCount} | ${row.symbolWinCount} | ${row.symbolLossCount} | ${row.symbolPnl} | ${row.topLossReason} | ${row.topLossReasonCount} |`,
    ),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
