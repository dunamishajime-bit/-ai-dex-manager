import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-2022-improvement-check");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0);
const END_TS = Date.UTC(2022, 11, 31, 23, 59, 59, 999);
const FULL_2022 = [{ startTs: START_TS, endTs: END_TS + 1 }];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function blockSymbols(base: HybridVariantOptions, symbols: readonly string[]) {
  const windows = { ...(base.trendSymbolBlockWindows ?? {}) };
  for (const symbol of symbols) windows[symbol] = FULL_2022;
  return windows;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  return {
    end: round(result.summary.end_equity),
    dd: round(result.summary.max_drawdown_pct, 2),
    pf: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    bySymbol: Object.entries(result.summary.symbol_contribution)
      .map(([symbol, pnl]) => ({
        symbol,
        pnl: round(Number(pnl)),
        trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
      }))
      .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const variants: Array<{ key: string; options: HybridVariantOptions }> = [
    {
      key: "current_v7",
      options: {},
    },
    {
      key: "block_twt_2022",
      options: {
        trendSymbolBlockWindows: blockSymbols(base, ["TWT"]),
      },
    },
    {
      key: "block_sol_2022",
      options: {
        trendSymbolBlockWindows: blockSymbols(base, ["SOL"]),
      },
    },
    {
      key: "block_uni_2022",
      options: {
        trendSymbolBlockWindows: blockSymbols(base, ["UNI"]),
      },
    },
    {
      key: "block_twt_sol_2022",
      options: {
        trendSymbolBlockWindows: blockSymbols(base, ["TWT", "SOL"]),
      },
    },
    {
      key: "block_twt_sol_uni_2022",
      options: {
        trendSymbolBlockWindows: blockSymbols(base, ["TWT", "SOL", "UNI"]),
      },
    },
    {
      key: "block_twt_sol_uni_doge_2022",
      options: {
        trendSymbolBlockWindows: blockSymbols(base, ["TWT", "SOL", "UNI", "DOGE"]),
      },
    },
    {
      key: "eth_only_2022",
      options: {
        trendSymbolBlockWindows: blockSymbols(base, ["TWT", "SOL", "UNI", "DOGE", "AVAX", "INJ", "PENGU"]),
        expandedTrendSymbols: ["ETH"],
        strictExtraTrendSymbols: [],
      },
    },
    {
      key: "cash_only_2022",
      options: {
        disableTrend: true,
        rangeSymbols: [],
        auxRangeSymbols: [],
        aux2RangeSymbols: [],
        idleBreakoutEntryWhileCash: false,
        penguOffRotationEntry: false,
        penguStrongOverrideEntry: false,
        injSpringCashEntry: false,
      },
    },
    {
      key: "weak_market_block_non_eth",
      options: {
        trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
        trendWeakMarketBlockRequireWeak2022: true,
        trendWeakMarketBlockBestMom20Below: 0.08,
        trendWeakMarketBlockBtcAdxBelow: 18,
      },
    },
    {
      key: "weak_market_block_non_eth_loose_adx",
      options: {
        trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
        trendWeakMarketBlockRequireWeak2022: true,
        trendWeakMarketBlockBestMom20Below: 0.1,
        trendWeakMarketBlockBtcAdxBelow: 25,
      },
    },
    {
      key: "weak_market_block_non_eth_no_adx",
      options: {
        trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
        trendWeakMarketBlockRequireWeak2022: true,
        trendWeakMarketBlockBestMom20Below: 0.12,
        trendWeakMarketBlockBtcAdxBelow: null,
      },
    },
    {
      key: "weak_market_cash_only_except_eth_range",
      options: {
        trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
        trendWeakMarketBlockRequireWeak2022: true,
        trendWeakMarketBlockBestMom20Below: 0.2,
        trendWeakMarketBlockBtcAdxBelow: null,
        strictExtraTrendIdleOnly: true,
      },
    },
    {
      key: "btc_below_sma90_block_non_eth",
      options: {
        trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
        trendWeakMarketBlockRequireWeak2022: false,
        trendWeakMarketBlockBestMom20Below: null,
        trendWeakMarketBlockBtcAdxBelow: null,
        trendWeakMarketBlockWhenBtcBelowSma90: true,
        trendWeakMarketBlockBtcSma90DistanceBelow: 0,
      },
    },
    {
      key: "btc_near_sma90_3pct_block_non_eth",
      options: {
        trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
        trendWeakMarketBlockRequireWeak2022: false,
        trendWeakMarketBlockBestMom20Below: null,
        trendWeakMarketBlockBtcAdxBelow: null,
        trendWeakMarketBlockWhenBtcBelowSma90: true,
        trendWeakMarketBlockBtcSma90DistanceBelow: 0.03,
      },
    },
    {
      key: "btc_near_sma90_8pct_block_non_eth",
      options: {
        trendWeakMarketBlockSymbols: ["SOL", "TWT", "UNI", "DOGE", "AVAX", "INJ", "PENGU"],
        trendWeakMarketBlockRequireWeak2022: false,
        trendWeakMarketBlockBestMom20Below: null,
        trendWeakMarketBlockBtcAdxBelow: null,
        trendWeakMarketBlockWhenBtcBelowSma90: true,
        trendWeakMarketBlockBtcSma90DistanceBelow: 0.08,
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", {
      ...base,
      ...variant.options,
      initialEquity: 10_000,
      backtestStartTs: START_TS,
      backtestExecutionStartTs: START_TS,
      backtestEndTs: END_TS,
      label: `v7_2022_${variant.key}`,
    });
    const summary = summarize(result);
    rows.push({ key: variant.key, ...summary });
    await fs.writeFile(path.join(REPORT_DIR, `${variant.key}-trades.json`), JSON.stringify(result.trade_pairs, null, 2), "utf8");
    console.log(`${variant.key}: end=${summary.end} dd=${summary.dd}% pf=${summary.pf} trades=${summary.trades}`);
  }

  const lines = [
    "# V7 2022 Improvement Check",
    "",
    "| variant | End Equity | MaxDD | PF | Trades |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.end.toLocaleString()} | ${row.dd}% | ${row.pf} | ${row.trades} |`),
    "",
    "## Symbol Detail",
    "",
  ];
  for (const row of rows) {
    lines.push(`### ${row.key}`, "", "| symbol | PnL | trades |", "| --- | ---: | ---: |");
    for (const item of row.bySymbol) {
      lines.push(`| ${item.symbol} | ${item.pnl.toLocaleString()} | ${item.trades} |`);
    }
    lines.push("");
  }
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
