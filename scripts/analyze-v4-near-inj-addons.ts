import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "v4-near-inj-addons");
const FULL_START = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const FULL_END = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const LATEST_START = Date.UTC(2025, 11, 31, 0, 0, 0, 0);
const LATEST_END = Date.UTC(2026, 3, 17, 23, 59, 59, 999);

type WindowConfig = {
  key: "full" | "latest";
  title: string;
  startTs: number;
  endTs: number;
};

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

const WINDOWS: WindowConfig[] = [
  { key: "full", title: "Full Window", startTs: FULL_START, endTs: FULL_END },
  { key: "latest", title: "Latest Window", startTs: LATEST_START, endTs: LATEST_END },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(window: WindowConfig): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: window.startTs,
    backtestEndTs: window.endTs,
  } satisfies HybridVariantOptions;
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

function buildVariants(window: WindowConfig): VariantSpec[] {
  const base = baseOptions(window);
  const expandedBase = [...RECLAIM_HYBRID_EXECUTION_PROFILE.expandedTrendSymbols];

  return [
    {
      key: "base_v4",
      thesis: "Current production v4.",
      options: {
        ...base,
        label: `v4_base_${window.key}`,
      },
    },
    {
      key: "v4_plus_near",
      thesis: "Add NEAR with smooth medium-term trend logic.",
      options: {
        ...base,
        expandedTrendSymbols: [...expandedBase, "NEAR"],
        trendBreakoutLookbackBarsBySymbol: mergeBySymbol(base.trendBreakoutLookbackBarsBySymbol, { NEAR: 6 }),
        trendBreakoutMinPctBySymbol: mergeBySymbol(base.trendBreakoutMinPctBySymbol, { NEAR: 0.015 }),
        trendMinMomAccelBySymbol: mergeBySymbol(base.trendMinMomAccelBySymbol, { NEAR: 0.001 }),
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, { NEAR: 0.18 }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, { NEAR: 1.02 }),
        label: `v4_plus_near_${window.key}`,
      },
    },
    {
      key: "v4_plus_inj",
      thesis: "Add INJ with breakout-surge logic and fast failure exit.",
      options: {
        ...base,
        expandedTrendSymbols: [...expandedBase, "INJ"],
        trendBreakoutLookbackBarsBySymbol: mergeBySymbol(base.trendBreakoutLookbackBarsBySymbol, { INJ: 3 }),
        trendBreakoutMinPctBySymbol: mergeBySymbol(base.trendBreakoutMinPctBySymbol, { INJ: 0.025 }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, { INJ: 1.25 }),
        trendMinMomAccelBySymbol: mergeBySymbol(base.trendMinMomAccelBySymbol, { INJ: 0.02 }),
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, { INJ: 0.2 }),
        symbolSpecificTrendWeakExitSymbols: ["INJ"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: 0,
        label: `v4_plus_inj_${window.key}`,
      },
    },
    {
      key: "v4_plus_near_inj",
      thesis: "Add both NEAR smooth-trend and INJ breakout-surge logic.",
      options: {
        ...base,
        expandedTrendSymbols: [...expandedBase, "NEAR", "INJ"],
        trendBreakoutLookbackBarsBySymbol: mergeBySymbol(base.trendBreakoutLookbackBarsBySymbol, {
          NEAR: 6,
          INJ: 3,
        }),
        trendBreakoutMinPctBySymbol: mergeBySymbol(base.trendBreakoutMinPctBySymbol, {
          NEAR: 0.015,
          INJ: 0.025,
        }),
        trendMinVolumeRatioBySymbol: mergeBySymbol(base.trendMinVolumeRatioBySymbol, {
          NEAR: 1.02,
          INJ: 1.25,
        }),
        trendMinMomAccelBySymbol: mergeBySymbol(base.trendMinMomAccelBySymbol, {
          NEAR: 0.001,
          INJ: 0.02,
        }),
        trendMinEfficiencyRatioBySymbol: mergeBySymbol(base.trendMinEfficiencyRatioBySymbol, {
          NEAR: 0.18,
          INJ: 0.2,
        }),
        symbolSpecificTrendWeakExitSymbols: ["INJ"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: 0,
        label: `v4_plus_near_inj_${window.key}`,
      },
    },
  ];
}

async function runWindow(window: WindowConfig) {
  const rows: Array<Record<string, unknown>> = [];
  for (const variant of buildVariants(window)) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, window.key, variant.key));
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      endEquity: round(result.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      winRatePct: round(result.summary.win_rate_pct),
      tradeCount: result.summary.trade_count,
      exposurePct: round(result.summary.exposure_pct),
      nearPnl: round(result.summary.symbol_contribution.NEAR ?? 0),
      injPnl: round(result.summary.symbol_contribution.INJ ?? 0),
      symbolContribution: Object.fromEntries(
        Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
      ),
    });
  }

  rows.sort((left, right) => Number(right.endEquity) - Number(left.endEquity));
  return rows;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const byWindow: Record<string, Array<Record<string, unknown>>> = {};
  for (const window of WINDOWS) {
    byWindow[window.key] = await runWindow(window);
  }

  const md = [
    "# V4 + NEAR / INJ Add-ons",
    "",
    ...WINDOWS.flatMap((window) => [
      `## ${window.title}`,
      "",
      `- start_utc: ${new Date(window.startTs).toISOString()}`,
      `- end_utc: ${new Date(window.endTs).toISOString()}`,
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | NEAR pnl | INJ pnl |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...byWindow[window.key].map(
        (row) =>
          `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} | ${row.nearPnl} | ${row.injPnl} |`,
      ),
      "",
      "### Contribution",
      "",
      ...byWindow[window.key].map((row) => {
        const top = Object.entries(row.symbolContribution as Record<string, number>)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 7)
          .map(([symbol, pnl]) => `${symbol} ${pnl}`);
        return `- ${row.key}: ${top.join(" / ")}`;
      }),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(byWindow, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify(byWindow, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
