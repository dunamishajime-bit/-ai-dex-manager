import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-2022-2023-guard-grid");
const WINDOWS = [
  { key: "2022", start: Date.UTC(2022, 0, 1), end: Date.UTC(2022, 11, 31, 23, 59, 59, 999) },
  { key: "2023", start: Date.UTC(2023, 0, 1), end: Date.UTC(2023, 11, 31, 23, 59, 59, 999) },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function variantOptions(
  base: HybridVariantOptions,
  sma85Distance: number | null,
  smaDistance = 0,
  breadth40Below: number | null = null,
  btcMom20Below: number | null = null,
): HybridVariantOptions {
  return {
    ...base,
    trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
    trendWeakMarketBlockRequireWeak2022: false,
    trendWeakMarketBlockBestMom20Below: null,
    trendWeakMarketBlockBtcAdxBelow: null,
    trendWeakMarketBlockWhenBtcBelowSma90: true,
    trendWeakMarketBlockBtcSma90DistanceBelow: smaDistance,
    trendWeakMarketBlockBtcSma85DistanceBelow: sma85Distance,
    trendWeakMarketBlockBreadth40Below: breadth40Below,
    trendWeakMarketBlockBtcMom20Below: btcMom20Below,
    trendWeakMarketBlockSticky: false,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const variants = [
    { key: "current", options: base },
    { key: "sma90_sma85dist_lt_-20", options: variantOptions(base, -0.2) },
    { key: "sma90_sma85dist_lt_-10", options: variantOptions(base, -0.1) },
    { key: "sma90_sma85dist_lt_0", options: variantOptions(base, 0) },
    { key: "sma90_sma85dist_lt_5", options: variantOptions(base, 0.05) },
    { key: "sma90_sma85dist_lt_10", options: variantOptions(base, 0.1) },
    { key: "near3_sma85dist_lt_0", options: variantOptions(base, 0, 0.03) },
    { key: "near3_sma85dist_lt_5", options: variantOptions(base, 0.05, 0.03) },
    { key: "sma90_breadth0", options: variantOptions(base, null, 0, 0) },
    { key: "sma90_breadth1", options: variantOptions(base, null, 0, 1) },
    { key: "sma90_breadth2", options: variantOptions(base, null, 0, 2) },
    { key: "sma90_breadth3", options: variantOptions(base, null, 0, 3) },
    { key: "near3_breadth1", options: variantOptions(base, null, 0.03, 1) },
    { key: "near3_breadth2", options: variantOptions(base, null, 0.03, 2) },
    {
      key: "sma90_block_twt_sol_uni",
      options: {
        ...variantOptions(base, null, 0, null),
        trendWeakMarketBlockSymbols: ["TWT", "SOL", "UNI"],
      },
    },
    {
      key: "sma90_block_twt_sol",
      options: {
        ...variantOptions(base, null, 0, null),
        trendWeakMarketBlockSymbols: ["TWT", "SOL"],
      },
    },
    {
      key: "sma90_block_sol",
      options: {
        ...variantOptions(base, null, 0, null),
        trendWeakMarketBlockSymbols: ["SOL"],
      },
    },
    {
      key: "sma90_block_twt",
      options: {
        ...variantOptions(base, null, 0, null),
        trendWeakMarketBlockSymbols: ["TWT"],
      },
    },
    {
      key: "sma90_btc_mom20_lt_0_block_twt_sol",
      options: {
        ...variantOptions(base, null, 0, null, 0),
        trendWeakMarketBlockSymbols: ["TWT", "SOL"],
      },
    },
    {
      key: "sma90_btc_mom20_lt_3_block_twt_sol",
      options: {
        ...variantOptions(base, null, 0, null, 0.03),
        trendWeakMarketBlockSymbols: ["TWT", "SOL"],
      },
    },
    {
      key: "sma90_btc_mom20_lt_6_block_twt_sol",
      options: {
        ...variantOptions(base, null, 0, null, 0.06),
        trendWeakMarketBlockSymbols: ["TWT", "SOL"],
      },
    },
    {
      key: "sma90_btc_mom20_lt_0_block_non_eth",
      options: variantOptions(base, null, 0, null, 0),
    },
    {
      key: "sma90_btc_mom20_lt_3_block_non_eth",
      options: variantOptions(base, null, 0, null, 0.03),
    },
  ];
  const requestedVariant = process.env.BT_VARIANT || "";
  const requestedPeriod = process.env.BT_PERIOD || "";
  const activeVariants = requestedVariant
    ? variants.filter((variant) => variant.key === requestedVariant)
    : variants;
  const activeWindows = requestedPeriod
    ? WINDOWS.filter((window) => window.key === requestedPeriod)
    : WINDOWS;
  const rows = [];
  for (const variant of activeVariants) {
    for (const window of activeWindows) {
      const result = await runHybridBacktest("RETQ22", {
        ...variant.options,
        initialEquity: 10_000,
        backtestStartTs: window.start,
        backtestExecutionStartTs: window.start,
        backtestEndTs: window.end,
        label: `v7_guard_grid_${variant.key}_${window.key}`,
      });
      const row = {
        variant: variant.key,
        period: window.key,
        end: round(result.summary.end_equity),
        dd: round(result.summary.max_drawdown_pct, 2),
        pf: round(result.summary.profit_factor, 3),
        trades: result.summary.trade_count,
      };
      rows.push(row);
      console.log(`${row.variant} ${row.period}: end=${row.end} dd=${row.dd}% pf=${row.pf} trades=${row.trades}`);
    }
  }
  const lines = [
    "# V7 2022/2023 Guard Grid",
    "",
    "| variant | period | End Equity | MaxDD | PF | Trades |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.variant} | ${row.period} | ${row.end.toLocaleString()} | ${row.dd}% | ${row.pf} | ${row.trades} |`),
  ];
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
