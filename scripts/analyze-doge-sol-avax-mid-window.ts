import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "doge-sol-avax-mid-window");
const WINDOW_START = Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const WINDOW_END = Date.UTC(2026, 3, 17, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const dogeTrades = result.trade_pairs.filter((trade) => trade.symbol === "DOGE");
  const solTrades = result.trade_pairs.filter((trade) => trade.symbol === "SOL");
  const avaxTrades = result.trade_pairs.filter((trade) => trade.symbol === "AVAX");
  return {
    endEquity: round(result.summary.end_equity, 2),
    cagrPct: round(result.summary.cagr_pct, 2),
    maxDrawdownPct: round(result.summary.max_drawdown_pct, 2),
    profitFactor: round(result.summary.profit_factor, 3),
    tradeCount: result.summary.trade_count,
    dogeTrades: dogeTrades.length,
    dogePnl: round(result.summary.symbol_contribution.DOGE ?? 0, 2),
    solTrades: solTrades.length,
    solPnl: round(result.summary.symbol_contribution.SOL ?? 0, 2),
    avaxTrades: avaxTrades.length,
    avaxPnl: round(result.summary.symbol_contribution.AVAX ?? 0, 2),
  };
}

function withoutAvax(base: HybridVariantOptions): HybridVariantOptions {
  return {
    ...base,
    expandedTrendSymbols: ["ETH", "SOL"],
    auxRangeSymbols: ["SOL"],
  };
}

function withoutSolAuxRange(base: HybridVariantOptions): HybridVariantOptions {
  return {
    ...base,
    auxRangeSymbols: ["AVAX"],
  };
}

function withoutSolAndAvaxAuxRange(base: HybridVariantOptions): HybridVariantOptions {
  return {
    ...base,
    auxRangeSymbols: [],
  };
}

function variants(): VariantSpec[] {
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: WINDOW_START,
    backtestEndTs: WINDOW_END,
  } satisfies HybridVariantOptions;

  const dogeGap15Once = {
    strictExtraTrendRotationScoreGapBySymbol: { DOGE: 15 },
  } satisfies Partial<HybridVariantOptions>;

  const dogeGap20Once = {
    strictExtraTrendRotationScoreGapBySymbol: { DOGE: 20 },
  } satisfies Partial<HybridVariantOptions>;

  const dogeGap15Twice = {
    strictExtraTrendRotationScoreGapBySymbol: { DOGE: 15 },
    strictExtraTrendRotationRequireConsecutiveBarsBySymbol: { DOGE: 2 },
  } satisfies Partial<HybridVariantOptions>;

  return [
    {
      key: "current_v3",
      thesis: "Current v3 profile with DOGE eff018 and SOL score -8.",
      options: { ...base, label: "mid_current_v3" },
    },
    {
      key: "doge_gap15_once",
      thesis: "DOGE only stricter rotation with score gap 15.",
      options: { ...base, ...dogeGap15Once, label: "mid_doge_gap15_once" },
    },
    {
      key: "doge_gap20_once",
      thesis: "DOGE only stricter rotation with score gap 20.",
      options: { ...base, ...dogeGap20Once, label: "mid_doge_gap20_once" },
    },
    {
      key: "doge_gap15_twice",
      thesis: "DOGE only stricter rotation with score gap 15 and 2 consecutive bars.",
      options: { ...base, ...dogeGap15Twice, label: "mid_doge_gap15_twice" },
    },
    {
      key: "sol_no_auxrange",
      thesis: "Remove SOL from auxRange while keeping the rest of v3.",
      options: { ...withoutSolAuxRange(base), label: "mid_sol_no_auxrange" },
    },
    {
      key: "doge_gap15_once_plus_sol_no_auxrange",
      thesis: "Combine DOGE stricter rotation (gap15 once) with SOL removed from auxRange.",
      options: { ...withoutSolAuxRange(base), ...dogeGap15Once, label: "mid_doge_gap15_once_plus_sol_no_auxrange" },
    },
    {
      key: "avax_removed",
      thesis: "Remove AVAX from trend and auxRange logic.",
      options: { ...withoutAvax(base), label: "mid_avax_removed" },
    },
    {
      key: "avax_removed_plus_doge_gap15_once_plus_sol_no_auxrange",
      thesis: "Remove AVAX, remove SOL from auxRange, and tighten DOGE rotation (gap15 once).",
      options: {
        ...withoutSolAndAvaxAuxRange(withoutAvax(base)),
        ...dogeGap15Once,
        label: "mid_avax_removed_plus_doge_gap15_once_plus_sol_no_auxrange",
      },
    },
  ];
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of variants()) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      ...summarize(result),
    });
  }

  rows.sort((left, right) => Number(right.endEquity) - Number(left.endEquity));

  const md = [
    "# DOGE / SOL / AVAX Mid Window Variants",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | trades | DOGE trades | DOGE pnl | SOL trades | SOL pnl | AVAX trades | AVAX pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.dogeTrades} | ${row.dogePnl} | ${row.solTrades} | ${row.solPnl} | ${row.avaxTrades} | ${row.avaxPnl} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
