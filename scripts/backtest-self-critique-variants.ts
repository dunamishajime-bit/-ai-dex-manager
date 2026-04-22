import fs from "fs/promises";
import path from "path";

import { runHybridBacktest, runTop2TrendBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine.ts";
import { writeBacktestArtifacts } from "../lib/backtest/reporting.ts";

const REPORT_DIR = path.join(process.cwd(), "reports", "self-critique-variants");

const BASE_RECLAIM: HybridVariantOptions = {
  useThreeWayRegime: true,
  rangeEntryMode: "reclaim",
  rangeSymbols: ["ETH"],
  trendWeakExitBestMom20Below: 0.05,
  trendWeakExitBtcAdxBelow: 18,
  trendMinEfficiencyRatio: 0.22,
  rangeRegimeBtcDistMin: -0.03,
  rangeRegimeBtcDistMax: 0.02,
  rangeRegimeBtcAdxMax: 22,
  rangeRegimeBreadth40Max: 2,
  rangeRegimeBestMom20Min: -0.04,
  rangeRegimeBestMom20Max: 0.035,
  rangeEntryBestMom20Below: -0.003,
  rangeEntryBtcAdxBelow: 20,
  rangeOverheatMax: -0.009,
  rangeExitMom20Above: 0.01,
  rangeMaxHoldBars: 3,
};

const RELAXED_AUX: HybridVariantOptions = {
  auxRangeSymbols: ["AVAX", "SOL"],
  auxRangeEntryMode: "atr_snapback",
  auxRangeActiveYears: [2024, 2025],
  auxRangeIgnoreRegimeGate: true,
  auxRangeAlloc: 0.4,
  auxRangeEntryBestMom20Below: 0.06,
  auxRangeEntryBtcAdxBelow: 35,
  auxRangeOverheatMax: 0.03,
  auxRangeExitMom20Above: 0.008,
  auxRangeMaxHoldBars: 4,
};

const PENGU_TOP_TRADE_BLOCK = {
  PENGU: [
    {
      startTs: Date.parse("2025-07-07T00:00:00.000Z"),
      endTs: Date.parse("2025-07-12T12:00:00.000Z"),
    },
  ],
} satisfies NonNullable<HybridVariantOptions["trendSymbolBlockWindows"]>;

type Variant = {
  key: string;
  thesis: string;
  runner?: "hybrid" | "top2";
  options: HybridVariantOptions;
};

const variants: Variant[] = [
  {
    key: "current-retq22",
    thesis: "Current RETQ22 baseline.",
    options: {},
  },
  {
    key: "reclaim-aux-relaxed",
    thesis: "Reduce idle USDT with ETH reclaim plus AVAX/SOL ATR snapback.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX },
  },
  {
    key: "reclaim-aux-relaxed-pengu-idle",
    thesis: "Use PENGU only when normal candidates are absent.",
    options: {
      ...BASE_RECLAIM,
      ...RELAXED_AUX,
      strictExtraTrendSymbols: ["PENGU"],
      strictExtraTrendIdleOnly: true,
    },
  },
  {
    key: "reclaim-aux-no-sol",
    thesis: "Remove SOL aux to test if it is signal or noise.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeSymbols: ["AVAX"] },
  },
  {
    key: "reclaim-aux-no-avax",
    thesis: "Remove AVAX aux to test if it is signal or noise.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeSymbols: ["SOL"] },
  },
  {
    key: "reclaim-aux-alloc050",
    thesis: "Increase aux range allocation if its edge is real.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeAlloc: 0.5 },
  },
  {
    key: "reclaim-aux-alloc060",
    thesis: "Push aux range allocation higher while watching drawdown.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeAlloc: 0.6 },
  },
  {
    key: "reclaim-aux-alloc100",
    thesis: "Use full available cash for aux range when no trend candidate exists.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeAlloc: 1 },
  },
  {
    key: "reclaim-aux-alloc100-pengu-idle",
    thesis: "Full aux range plus PENGU idle-only candidate.",
    options: {
      ...BASE_RECLAIM,
      ...RELAXED_AUX,
      auxRangeAlloc: 1,
      strictExtraTrendSymbols: ["PENGU"],
      strictExtraTrendIdleOnly: true,
    },
  },
  {
    key: "reclaim-aux-alloc100-pengu-top-removed",
    thesis: "Stress test: full aux plus PENGU, but largest PENGU trade is blocked.",
    options: {
      ...BASE_RECLAIM,
      ...RELAXED_AUX,
      auxRangeAlloc: 1,
      strictExtraTrendSymbols: ["PENGU"],
      strictExtraTrendIdleOnly: true,
      trendSymbolBlockWindows: PENGU_TOP_TRADE_BLOCK,
    },
  },
  {
    key: "reclaim-aux-hold5",
    thesis: "Hold aux range longer in case exits are too early.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeMaxHoldBars: 5 },
  },
  {
    key: "reclaim-aux-exit006",
    thesis: "Exit aux range earlier before rebound fades.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeExitMom20Above: 0.006 },
  },
  {
    key: "reclaim-aux-entry080",
    thesis: "Widen aux range entry to reduce missed rebounds.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeEntryBestMom20Below: 0.08, auxRangeOverheatMax: 0.035 },
  },
  {
    key: "reclaim-aux-entry040",
    thesis: "Tighten aux range entry to reduce shallow rebound noise.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, auxRangeEntryBestMom20Below: 0.04, auxRangeOverheatMax: 0.02 },
  },
  {
    key: "trend-eff018",
    thesis: "Loosen trend efficiency to reduce late entries.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, trendMinEfficiencyRatio: 0.18 },
  },
  {
    key: "trend-eff026",
    thesis: "Tighten trend efficiency to remove false breakouts.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, trendMinEfficiencyRatio: 0.26 },
  },
  {
    key: "weak-exit-loose",
    thesis: "Loosen weak-exit gates to avoid exiting trends too early.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, trendWeakExitBestMom20Below: 0.03, trendWeakExitBtcAdxBelow: 16 },
  },
  {
    key: "weak-exit-tight",
    thesis: "Tighten weak-exit gates to reduce late exits.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, trendWeakExitBestMom20Below: 0.07, trendWeakExitBtcAdxBelow: 20 },
  },
  {
    key: "reclaim-primary-early",
    thesis: "Loosen primary ETH reclaim entry.",
    options: {
      ...BASE_RECLAIM,
      ...RELAXED_AUX,
      rangeEntryBestMom20Below: 0.006,
      rangeEntryBtcAdxBelow: 24,
      rangeOverheatMax: -0.002,
    },
  },
  {
    key: "reclaim-primary-strict",
    thesis: "Tighten primary ETH reclaim entry to improve PF.",
    options: {
      ...BASE_RECLAIM,
      ...RELAXED_AUX,
      rangeEntryBestMom20Below: -0.01,
      rangeEntryBtcAdxBelow: 18,
      rangeOverheatMax: -0.014,
    },
  },
  {
    key: "decision-12-exit-6",
    thesis: "Keep 12H entries but check trend exits on 6H.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, trendExitCheckTimeframe: "6h" },
  },
  {
    key: "decision-6-reclaim",
    thesis: "Try 6H decisions on the reclaim base.",
    options: { ...BASE_RECLAIM, ...RELAXED_AUX, trendDecisionTimeframe: "6h" },
  },
  {
    key: "top2-trend",
    thesis: "Hold top 2 trend symbols if single-symbol rotation misses upside.",
    runner: "top2",
    options: {},
  },
];

function annualValue(summary: Awaited<ReturnType<typeof runHybridBacktest>>["summary"], year: string) {
  return summary.annual_returns.find((row) => row.period === year)?.return_pct ?? 0;
}

function rowFor(result: Awaited<ReturnType<typeof runHybridBacktest>>, key: string, thesis: string) {
  return {
    key,
    thesis,
    end_equity: Number(result.summary.end_equity.toFixed(2)),
    cagr_pct: Number(result.summary.cagr_pct.toFixed(2)),
    max_drawdown_pct: Number(result.summary.max_drawdown_pct.toFixed(2)),
    profit_factor: Number(result.summary.profit_factor.toFixed(3)),
    win_rate_pct: Number(result.summary.win_rate_pct.toFixed(2)),
    trade_count: result.summary.trade_count,
    exposure_pct: Number(result.summary.exposure_pct.toFixed(2)),
    y2023: Number(annualValue(result.summary, "2023").toFixed(2)),
    y2024: Number(annualValue(result.summary, "2024").toFixed(2)),
    y2025: Number(annualValue(result.summary, "2025").toFixed(2)),
    symbol_contribution: result.summary.symbol_contribution,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows = [];
  const artifacts: Record<string, Awaited<ReturnType<typeof writeBacktestArtifacts>>> = {};

  for (const variant of variants) {
    const result = variant.runner === "top2"
      ? await runTop2TrendBacktest({ ...variant.options, label: variant.key })
      : await runHybridBacktest("RETQ22", { ...variant.options, label: variant.key });
    artifacts[variant.key] = await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    rows.push(rowFor(result, variant.key, variant.thesis));
    console.log(`${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} trades=${result.summary.trade_count}`);
  }

  rows.sort((left, right) => right.cagr_pct - left.cagr_pct);

  const md = [
    "# Self-Critique Backtest Variants",
    "",
    "Same backtest base, grouped by self-critique thesis.",
    "",
    "| rank | variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | 2023 % | 2024 % | 2025 % |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.exposure_pct} | ${row.y2023} | ${row.y2024} | ${row.y2025} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows, artifacts }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({ top: rows.slice(0, 10), report: path.join(REPORT_DIR, "result.md") }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
