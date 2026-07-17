import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-2022-alt-integrated");
const WINDOWS = [
  { key: "2022", start: Date.UTC(2022, 0, 1), end: Date.UTC(2022, 11, 31, 23, 59, 59, 999) },
  { key: "2023", start: Date.UTC(2023, 0, 1), end: Date.UTC(2023, 11, 31, 23, 59, 59, 999) },
];
const FULL_2022 = [{ startTs: WINDOWS[0].start, endTs: WINDOWS[0].end + 1 }];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function block2022(base: HybridVariantOptions, symbols: readonly string[]) {
  const out = { ...(base.trendSymbolBlockWindows ?? {}) };
  for (const symbol of symbols) out[symbol] = FULL_2022;
  return out;
}

function addExpanded(base: HybridVariantOptions, symbols: readonly string[]): HybridVariantOptions {
  return {
    ...base,
    expandedTrendSymbols: [...new Set([...(base.expandedTrendSymbols ?? []), ...symbols])],
  };
}

function tuneTrend(base: HybridVariantOptions, symbols: readonly string[]): HybridVariantOptions {
  const minVolume = { ...(base.trendMinVolumeRatioBySymbol ?? {}) };
  const minAccel = { ...(base.trendMinMomAccelBySymbol ?? {}) };
  const minEff = { ...(base.trendMinEfficiencyRatioBySymbol ?? {}) };
  const lookback = { ...(base.trendBreakoutLookbackBarsBySymbol ?? {}) };
  const breakout = { ...(base.trendBreakoutMinPctBySymbol ?? {}) };
  for (const symbol of symbols) {
    minVolume[symbol] = 0.8;
    minAccel[symbol] = 0;
    minEff[symbol] = 0.12;
    lookback[symbol] = 6;
    breakout[symbol] = 0.006;
  }
  return {
    ...base,
    trendMinVolumeRatioBySymbol: minVolume,
    trendMinMomAccelBySymbol: minAccel,
    trendMinEfficiencyRatioBySymbol: minEff,
    trendBreakoutLookbackBarsBySymbol: lookback,
    trendBreakoutMinPctBySymbol: breakout,
  };
}

function summarySymbols(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  return Object.entries(result.summary.symbol_contribution)
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(Number(pnl)),
      trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
    }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const strongSet = ["SFP", "AAVE", "LINK", "XRP", "ATOM"];
  const wideSet = ["SFP", "AAVE", "LINK", "XRP", "ATOM", "DOGE", "UNI", "AVAX"];
  const variants: Array<{ key: string; options: HybridVariantOptions }> = [
    { key: "current", options: base },
    { key: "add_strong", options: addExpanded(tuneTrend(base, strongSet), strongSet) },
    { key: "add_wide", options: addExpanded(tuneTrend(base, wideSet), wideSet) },
    {
      key: "add_strong_block_sol_twt_2022",
      options: {
        ...addExpanded(tuneTrend(base, strongSet), strongSet),
        trendSymbolBlockWindows: block2022(base, ["SOL", "TWT"]),
      },
    },
    {
      key: "add_wide_block_sol_twt_2022",
      options: {
        ...addExpanded(tuneTrend(base, wideSet), wideSet),
        trendSymbolBlockWindows: block2022(base, ["SOL", "TWT"]),
      },
    },
    {
      key: "add_strong_block_sol_twt_uni_2022",
      options: {
        ...addExpanded(tuneTrend(base, strongSet), strongSet),
        trendSymbolBlockWindows: block2022(base, ["SOL", "TWT", "UNI"]),
      },
    },
  ];
  const requestedVariant = process.env.BT_VARIANT || "";
  const requestedPeriod = process.env.BT_PERIOD || "";
  const activeVariants = requestedVariant ? variants.filter((variant) => variant.key === requestedVariant) : variants;
  const activeWindows = requestedPeriod ? WINDOWS.filter((window) => window.key === requestedPeriod) : WINDOWS;
  const rows = [];
  for (const variant of activeVariants) {
    for (const window of activeWindows) {
      const result = await runHybridBacktest("RETQ22", {
        ...variant.options,
        initialEquity: 10_000,
        backtestStartTs: window.start,
        backtestExecutionStartTs: window.start,
        backtestEndTs: window.end,
        label: `v7_alt_integrated_${variant.key}_${window.key}`,
      });
      const row = {
        variant: variant.key,
        period: window.key,
        end: round(result.summary.end_equity),
        dd: round(result.summary.max_drawdown_pct, 2),
        pf: round(result.summary.profit_factor, 3),
        trades: result.summary.trade_count,
        symbols: summarySymbols(result),
      };
      rows.push(row);
      await fs.writeFile(path.join(REPORT_DIR, `${variant.key}-${window.key}-trades.json`), JSON.stringify(result.trade_pairs, null, 2), "utf8");
      console.log(`${row.variant} ${row.period}: end=${row.end} dd=${row.dd}% pf=${row.pf} trades=${row.trades}`);
    }
  }
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  const lines = [
    "# V7 2022 Alt Integrated",
    "",
    "| variant | period | End Equity | MaxDD | PF | Trades |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.variant} | ${row.period} | ${row.end.toLocaleString()} | ${row.dd}% | ${row.pf} | ${row.trades} |`),
  ];
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
