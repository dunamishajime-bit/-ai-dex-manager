import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v6-sol-filter-plus-size");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

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

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const solTrades = result.trade_pairs.filter((row) => row.symbol === "SOL");
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    solTradeCount: solTrades.length,
    solWins: solTrades.filter((row) => row.net_pnl > 0).length,
    solLosses: solTrades.filter((row) => row.net_pnl <= 0).length,
    solNetPnl: round(result.summary.symbol_contribution.SOL ?? 0),
  };
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "base_v6",
      thesis: "Current production v6.",
      options: { ...base, label: "base_v6" },
    },
    {
      key: "sol_5pct_only",
      thesis: "SOL only 5% allocation, no extra filter.",
      options: {
        ...base,
        trendAllocBySymbol: { SOL: 0.05 },
        label: "sol_5pct_only",
      },
    },
    {
      key: "sol_5pct_eff_vol",
      thesis: "SOL 5% allocation + require stronger efficiency and volume.",
      options: {
        ...base,
        trendAllocBySymbol: { SOL: 0.05 },
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, { SOL: 0.24 }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, { SOL: 0.6 }),
        label: "sol_5pct_eff_vol",
      },
    },
    {
      key: "sol_100pct_eff_vol",
      thesis: "SOL 100% allocation + require stronger efficiency and volume.",
      options: {
        ...base,
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, { SOL: 0.24 }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, { SOL: 0.6 }),
        label: "sol_100pct_eff_vol",
      },
    },
    {
      key: "sol_5pct_eff_vol_accel",
      thesis: "SOL 5% allocation + stronger efficiency, volume, and momentum acceleration.",
      options: {
        ...base,
        trendAllocBySymbol: { SOL: 0.05 },
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, { SOL: 0.24 }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, { SOL: 0.6 }),
        trendMinMomAccelBySymbol: mergeBySymbol(base.trendMinMomAccelBySymbol, { SOL: 0.01 }),
        label: "sol_5pct_eff_vol_accel",
      },
    },
    {
      key: "sol_5pct_light_breakout",
      thesis: "SOL 5% allocation + light breakout gate and stricter quality.",
      options: {
        ...base,
        trendAllocBySymbol: { SOL: 0.05 },
        trendBreakoutLookbackBarsBySymbol: mergeBySymbol(base.trendBreakoutLookbackBarsBySymbol, { SOL: 4 }),
        trendBreakoutMinPctBySymbol: mergeBySymbol(base.trendBreakoutMinPctBySymbol, { SOL: 0.015 }),
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, { SOL: 0.24 }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, { SOL: 0.6 }),
        label: "sol_5pct_light_breakout",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      ...summarize(result),
    });
  }

  rows.sort((left, right) => right.endEquity - left.endEquity);

  const md = [
    "# V6 SOL Filter + Size Comparison",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | SOL trades | SOL wins | SOL losses | SOL pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} | ${row.solTradeCount} | ${row.solWins} | ${row.solLosses} | ${row.solNetPnl} |`,
    ),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
