import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "symbol-individual-optimization");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const ALL_WINDOW = [{ startTs: START_TS, endTs: END_TS }] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type SymbolKey = "SOL" | "AVAX" | "DOGE";

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

function blockAllExcept(symbolsToKeep: string[]) {
  const keep = new Set(symbolsToKeep.map((item) => item.toUpperCase()));
  const block: Record<string, readonly { startTs: number; endTs: number }[]> = {};
  for (const symbol of ["ETH", "SOL", "AVAX"]) {
    if (!keep.has(symbol)) block[symbol] = ALL_WINDOW;
  }
  return block;
}

function buildSolVariants(): VariantSpec[] {
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    strictExtraTrendSymbols: undefined,
    rangeSymbols: [] as unknown as readonly ("ETH" | "SOL" | "AVAX")[],
    auxRangeSymbols: [] as unknown as readonly ("ETH" | "SOL" | "AVAX")[],
    trendSymbolBlockWindows: blockAllExcept(["SOL"]),
  } satisfies HybridVariantOptions;

  return [
    {
      key: "sol_base_only",
      thesis: "SOL only with current production logic.",
      options: { ...base, label: "sol_base_only" },
    },
    {
      key: "sol_sma40",
      thesis: "SOL only with faster SMA40 trend exit.",
      options: { ...base, trendExitSma: 40, label: "sol_sma40" },
    },
    {
      key: "sol_trailing",
      thesis: "SOL only with profit-protection trailing on normal trends.",
      options: { ...base, trendProfitTrailActivationPct: 0.16, trendProfitTrailRetracePct: 0.09, label: "sol_trailing" },
    },
    {
      key: "sol_weak_exit",
      thesis: "SOL only with symbol-specific weak exit.",
      options: {
        ...base,
        symbolSpecificTrendWeakExitSymbols: ["SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.015,
        label: "sol_weak_exit",
      },
    },
    {
      key: "sol_quality_bonus",
      thesis: "SOL only with smooth-trend score bonus and overheat penalty.",
      options: {
        ...base,
        trendScoreEfficiencyBonusWeight: 14,
        trendScoreOverheatPenaltyWeight: 0.3,
        label: "sol_quality_bonus",
      },
    },
  ];
}

function buildAvaxVariants(): VariantSpec[] {
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    strictExtraTrendSymbols: undefined,
    rangeSymbols: [] as unknown as readonly ("ETH" | "SOL" | "AVAX")[],
    auxRangeSymbols: [] as unknown as readonly ("ETH" | "SOL" | "AVAX")[],
    trendSymbolBlockWindows: blockAllExcept(["AVAX"]),
  } satisfies HybridVariantOptions;

  return [
    {
      key: "avax_base_only",
      thesis: "AVAX only with current production logic.",
      options: { ...base, label: "avax_base_only" },
    },
    {
      key: "avax_sma40",
      thesis: "AVAX only with faster SMA40 trend exit.",
      options: { ...base, trendExitSma: 40, label: "avax_sma40" },
    },
    {
      key: "avax_looser_eff",
      thesis: "AVAX only with slightly looser efficiency gate for earlier trend capture.",
      options: { ...base, trendMinEfficiencyRatio: 0.18, label: "avax_looser_eff" },
    },
    {
      key: "avax_trailing",
      thesis: "AVAX only with profit-protection trailing on normal trends.",
      options: { ...base, trendProfitTrailActivationPct: 0.16, trendProfitTrailRetracePct: 0.09, label: "avax_trailing" },
    },
    {
      key: "avax_entry_quality",
      thesis: "AVAX only with stronger acceleration requirement and smoother score bias.",
      options: {
        ...base,
        trendMinMomAccel: 0,
        trendScoreEfficiencyBonusWeight: 12,
        trendScoreOverheatPenaltyWeight: 0.2,
        label: "avax_entry_quality",
      },
    },
  ];
}

function buildDogeVariants(): VariantSpec[] {
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    strictExtraTrendSymbols: ["DOGE"],
    strictExtraTrendIdleOnly: true,
    strictExtraTrendTrailActivationPct: undefined,
    strictExtraTrendTrailRetracePct: undefined,
    strictExtraTrendRotationWhileHolding: false,
    rangeSymbols: [] as unknown as readonly ("ETH" | "SOL" | "AVAX")[],
    auxRangeSymbols: [] as unknown as readonly ("ETH" | "SOL" | "AVAX")[],
    trendSymbolBlockWindows: blockAllExcept([]),
  } satisfies HybridVariantOptions;

  return [
    {
      key: "doge_base_only",
      thesis: "DOGE only as idle strict-extra candidate with current baseline-style settings.",
      options: { ...base, label: "doge_base_only" },
    },
    {
      key: "doge_sma40",
      thesis: "DOGE only with faster SMA40 exit.",
      options: { ...base, trendExitSma: 40, label: "doge_sma40" },
    },
    {
      key: "doge_eff018",
      thesis: "DOGE only with looser strict-extra efficiency gate for earlier entry.",
      options: { ...base, strictExtraTrendMinEfficiencyRatio: 0.18, label: "doge_eff018" },
    },
    {
      key: "doge_trailing",
      thesis: "DOGE only with dedicated strict-extra trailing protection.",
      options: {
        ...base,
        strictExtraTrendTrailActivationPct: 0.18,
        strictExtraTrendTrailRetracePct: 0.08,
        label: "doge_trailing",
      },
    },
    {
      key: "doge_6h_entry_exit",
      thesis: "DOGE only with 6H strict-extra decision and exit checks.",
      options: {
        ...base,
        strictExtraTrendDecisionTimeframe: "6h",
        strictExtraTrendExitCheckTimeframe: "6h",
        strictExtraTrendMinEfficiencyRatio: 0.18,
        label: "doge_6h_entry_exit",
      },
    },
  ];
}

async function runFamily(symbol: SymbolKey, variants: VariantSpec[]) {
  const rows: Array<Record<string, unknown>> = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, symbol.toLowerCase(), variant.key));
    const losses = result.trade_pairs.filter((trade) => trade.net_pnl <= 0);
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      end_equity: round(result.summary.end_equity, 2),
      cagr_pct: round(result.summary.cagr_pct, 2),
      max_drawdown_pct: round(result.summary.max_drawdown_pct, 2),
      profit_factor: round(result.summary.profit_factor, 3),
      win_rate_pct: round(result.summary.win_rate_pct, 2),
      trade_count: result.summary.trade_count,
      loss_count: losses.length,
      symbol_pnl: round(result.summary.symbol_contribution[symbol] ?? 0, 2),
      exposure_pct: round(result.summary.exposure_pct, 2),
      top_loss_reason: losses.reduce<Record<string, number>>((acc, trade) => {
        acc[trade.exit_reason] = (acc[trade.exit_reason] || 0) + 1;
        return acc;
      }, {}),
    });
  }

  rows.sort((left, right) =>
    Number(right.end_equity) - Number(left.end_equity) ||
    Number(right.profit_factor) - Number(left.profit_factor),
  );

  return rows;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const solRows = await runFamily("SOL", buildSolVariants());
  const avaxRows = await runFamily("AVAX", buildAvaxVariants());
  const dogeRows = await runFamily("DOGE", buildDogeVariants());

  const out = {
    SOL: solRows,
    AVAX: avaxRows,
    DOGE: dogeRows,
  };

  const md = [
    "# Symbol Individual Optimization",
    "",
    "## SOL",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | SOL pnl | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...solRows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.loss_count} | ${row.symbol_pnl} | ${row.exposure_pct} |`),
    "",
    "## AVAX",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | AVAX pnl | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...avaxRows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.loss_count} | ${row.symbol_pnl} | ${row.exposure_pct} |`),
    "",
    "## DOGE",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | DOGE pnl | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...dogeRows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.loss_count} | ${row.symbol_pnl} | ${row.exposure_pct} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(out, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
