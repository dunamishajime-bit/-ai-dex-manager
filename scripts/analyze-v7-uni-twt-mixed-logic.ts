import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-uni-twt-mixed-logic");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

type Window = {
  startTs: number;
  endTs: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

function buildCashOnlyWindows(
  points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>,
) {
  const cashPoints = points
    .filter((point) => point.decision.desiredSymbol === "USDT" && point.decision.desiredSide === "cash")
    .sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const point of cashPoints) {
    if (start == null) {
      start = point.ts;
      prev = point.ts;
      continue;
    }
    if (prev != null && point.ts - prev <= STEP_MS) {
      prev = point.ts;
      continue;
    }
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
    start = point.ts;
    prev = point.ts;
  }
  if (start != null) {
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  }
  return windows;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const twtTrades = result.trade_pairs.filter((row) => row.symbol === "TWT");
  const uniTrades = result.trade_pairs.filter((row) => row.symbol === "UNI");
  const byEntry = (symbol: string, text: string) =>
    result.trade_pairs.filter((row) => row.symbol === symbol && String(row.entry_reason ?? "").includes(text)).length;

  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    twtTrades: twtTrades.length,
    twtPnl: round(result.summary.symbol_contribution.TWT ?? 0),
    twtStructureBreakEntries: byEntry("TWT", "structure-break"),
    uniTrades: uniTrades.length,
    uniPnl: round(result.summary.symbol_contribution.UNI ?? 0),
    uniStructureBreakEntries: byEntry("UNI", "structure-break"),
    bySymbol: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);

  const mixedOptions: HybridVariantOptions = {
    ...base,
    expandedTrendSymbols: unique([...(base.expandedTrendSymbols ?? []), "TWT", "UNI"]),
    trendWindowedOverridesBySymbol: {
      TWT: {
        windows: cashOnlyWindows,
        breakoutLookbackBars: 8,
        breakoutMinPct: 0.012,
        minVolumeRatio: 1.01,
        minMomAccel: 0.0005,
        minEfficiencyRatio: 0.17,
      },
      UNI: {
        windows: cashOnlyWindows,
        breakoutLookbackBars: 8,
        breakoutMinPct: 0.012,
        minVolumeRatio: 1.01,
        minMomAccel: 0.0005,
        minEfficiencyRatio: 0.17,
      },
    },
    label: "v7_uni_twt_mixed_logic",
  };

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "base_v7",
      thesis: "Current production v7 baseline.",
      options: { ...base, label: "base_v7_uni_twt_mixed" },
    },
    {
      key: "v7_plus_uni_twt_mixed_logic",
      thesis: "Add TWT and UNI as normal trend symbols, but use TRX-style trend thresholds only during base-v7 cash windows.",
      options: mixedOptions,
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

  const md = [
    "# V7 UNI/TWT Mixed Logic",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- base_strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- cash_window_count: ${cashOnlyWindows.length}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | TWT trades | TWT pnl | TWT structure-break entries | UNI trades | UNI pnl | UNI structure-break entries |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} | ${row.twtTrades} | ${row.twtPnl} | ${row.twtStructureBreakEntries} | ${row.uniTrades} | ${row.uniPnl} | ${row.uniStructureBreakEntries} |`,
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
