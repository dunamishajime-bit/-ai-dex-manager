import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-idle-relax");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const BAR_HOURS = 12;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const totalBars = result.equity_curve.length;
  const idleBars = result.equity_curve.filter((point) => point.position_side === "cash").length;
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    idlePct: totalBars ? round((idleBars / totalBars) * 100) : 0,
    idleDays: round((idleBars * BAR_HOURS) / 24),
    bySymbol: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
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
      key: "base_v7",
      thesis: "Current production v7 baseline.",
      options: { ...base, label: "base_v7" },
    },
    {
      key: "idle_trend_gate_relax",
      thesis: "While in USDT only, allow trend entry even when the normal trend gate is off.",
      options: {
        ...base,
        idleCashTrendAllowTrendGateOff: true,
        label: "idle_trend_gate_relax",
      },
    },
    {
      key: "idle_eff_relax",
      thesis: "While in USDT only, lower the trend efficiency threshold slightly.",
      options: {
        ...base,
        idleCashTrendMinEfficiencyRatio: 0.18,
        label: "idle_eff_relax",
      },
    },
    {
      key: "idle_mom20_relax",
      thesis: "While in USDT only, allow slightly softer momentum at entry.",
      options: {
        ...base,
        idleCashTrendMinMom20: -0.005,
        label: "idle_mom20_relax",
      },
    },
    {
      key: "idle_all_relaxed",
      thesis: "While in USDT only, relax trend gate, efficiency, and momentum together.",
      options: {
        ...base,
        idleCashTrendAllowTrendGateOff: true,
        idleCashTrendMinEfficiencyRatio: 0.18,
        idleCashTrendMinMom20: -0.005,
        label: "idle_all_relaxed",
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
    "# V7 Idle Relax Comparison",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | idle % | idle days |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} | ${row.idlePct} | ${row.idleDays} |`,
    ),
    "",
    "## Contributions",
    "",
    ...rows.map((row) => `- ${row.key}: ${Object.entries(row.bySymbol).map(([k, v]) => `${k} ${v}`).join(" / ")}`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
