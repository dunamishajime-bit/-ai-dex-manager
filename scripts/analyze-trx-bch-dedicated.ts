import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "trx-bch-dedicated");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const ALL_WINDOW = [{ startTs: START_TS, endTs: END_TS }] as const;

type Family = "TRX" | "BCH";

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

function buildTrxVariants(): VariantSpec[] {
  const base = baseSingleSymbol("TRX");
  return [
    {
      key: "trx_base_only",
      thesis: "TRX only with current production-style trend logic.",
      options: { ...base, label: "trx_base_only" },
    },
    {
      key: "trx_smooth_trend",
      thesis: "Stable trend follow with light breakout, modest acceleration and cleaner efficiency.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { TRX: 8 },
        trendBreakoutMinPctBySymbol: { TRX: 0.012 },
        trendMinVolumeRatioBySymbol: { TRX: 1.01 },
        trendMinMomAccelBySymbol: { TRX: 0.0005 },
        trendMinEfficiencyRatioBySymbol: { TRX: 0.17 },
        label: "trx_smooth_trend",
      },
    },
    {
      key: "trx_smooth_trend_trailing",
      thesis: "TRX trend follow with profit protection after the move is established.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { TRX: 8 },
        trendBreakoutMinPctBySymbol: { TRX: 0.012 },
        trendMinVolumeRatioBySymbol: { TRX: 1.01 },
        trendMinMomAccelBySymbol: { TRX: 0.0005 },
        trendMinEfficiencyRatioBySymbol: { TRX: 0.17 },
        trendProfitTrailActivationPct: 0.16,
        trendProfitTrailRetracePct: 0.09,
        label: "trx_smooth_trend_trailing",
      },
    },
    {
      key: "trx_smooth_trend_fast_fail",
      thesis: "TRX trend follow with slightly quicker failure exit once momentum deteriorates.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { TRX: 8 },
        trendBreakoutMinPctBySymbol: { TRX: 0.012 },
        trendMinVolumeRatioBySymbol: { TRX: 1.01 },
        trendMinMomAccelBySymbol: { TRX: 0.0005 },
        trendMinEfficiencyRatioBySymbol: { TRX: 0.17 },
        symbolSpecificTrendWeakExitSymbols: ["TRX"],
        symbolSpecificTrendWeakExitMom20Below: 0.04,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.002,
        label: "trx_smooth_trend_fast_fail",
      },
    },
  ];
}

function buildBchVariants(): VariantSpec[] {
  const base = baseSingleSymbol("BCH");
  return [
    {
      key: "bch_base_only",
      thesis: "BCH only with current production-style trend logic.",
      options: { ...base, label: "bch_base_only" },
    },
    {
      key: "bch_breakout_surge",
      thesis: "Fast breakout entry with stronger breakout, volume and acceleration for BCH spikes.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { BCH: 4 },
        trendBreakoutMinPctBySymbol: { BCH: 0.02 },
        trendMinVolumeRatioBySymbol: { BCH: 1.15 },
        trendMinMomAccelBySymbol: { BCH: 0.01 },
        trendMinEfficiencyRatioBySymbol: { BCH: 0.18 },
        label: "bch_breakout_surge",
      },
    },
    {
      key: "bch_breakout_surge_fast_exit",
      thesis: "BCH breakout with quicker loss-cut once momentum stalls.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { BCH: 4 },
        trendBreakoutMinPctBySymbol: { BCH: 0.02 },
        trendMinVolumeRatioBySymbol: { BCH: 1.15 },
        trendMinMomAccelBySymbol: { BCH: 0.01 },
        trendMinEfficiencyRatioBySymbol: { BCH: 0.18 },
        symbolSpecificTrendWeakExitSymbols: ["BCH"],
        symbolSpecificTrendWeakExitMom20Below: 0.07,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.002,
        label: "bch_breakout_surge_fast_exit",
      },
    },
    {
      key: "bch_breakout_surge_trailing",
      thesis: "BCH breakout with tighter trailing once profits extend.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { BCH: 4 },
        trendBreakoutMinPctBySymbol: { BCH: 0.02 },
        trendMinVolumeRatioBySymbol: { BCH: 1.15 },
        trendMinMomAccelBySymbol: { BCH: 0.01 },
        trendMinEfficiencyRatioBySymbol: { BCH: 0.18 },
        trendProfitTrailActivationPct: 0.15,
        trendProfitTrailRetracePct: 0.08,
        label: "bch_breakout_surge_trailing",
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

  const trxRows = await runFamily("TRX", buildTrxVariants());
  const bchRows = await runFamily("BCH", buildBchVariants());

  const out = {
    TRX: trxRows,
    BCH: bchRows,
  };

  const md = [
    "# TRX / BCH Dedicated Logic",
    "",
    "## TRX",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | symbol trades | wins | losses | pnl | top loss reason | count |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ...trxRows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.symbolTradeCount} | ${row.symbolWinCount} | ${row.symbolLossCount} | ${row.symbolPnl} | ${row.topLossReason} | ${row.topLossReasonCount} |`,
    ),
    "",
    "## BCH",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | symbol trades | wins | losses | pnl | top loss reason | count |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ...bchRows.map(
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
