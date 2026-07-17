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
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "xserver-inj-improvements");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildCashOnlyWindows(points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>) {
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

  if (start != null) windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  return windows;
}

function invertWindows(windows: readonly Window[], startTs: number, endTs: number) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
  let cursor = startTs;
  for (const window of sorted) {
    if (window.startTs > cursor) inverted.push({ startTs: cursor, endTs: window.startTs });
    cursor = Math.max(cursor, window.endTs);
  }
  if (cursor < endTs) inverted.push({ startTs: cursor, endTs });
  return inverted.filter((window) => window.endTs > window.startTs);
}

function applyCashOnlyUniTwt(base: HybridVariantOptions, nonCashWindows: readonly Window[]) {
  return {
    ...base,
    expandedTrendSymbols: unique([...(base.expandedTrendSymbols ?? []), "UNI", "TWT"]),
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      UNI: 8,
      TWT: 8,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      UNI: 0.012,
      TWT: 0.012,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      UNI: 1.01,
      TWT: 1.01,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      UNI: 0.0005,
      TWT: 0.0005,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      UNI: 0.17,
      TWT: 0.17,
    },
    trendPrioritySymbols: ["TWT"],
    trendPriorityMaxScoreGap: null,
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
    trendRotationScoreGap: 0,
    trendRotationCurrentMomAccelMax: 999,
    trendRotationCurrentMom20Max: 999,
    trendRotationMinHoldBars: 1,
    trendRotationRequireConsecutiveBars: 1,
    trendSymbolBlockWindows: {
      ...(base.trendSymbolBlockWindows ?? {}),
      UNI: nonCashWindows,
      TWT: nonCashWindows,
    },
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol).length;
  const injTrades = result.trade_pairs.filter((row) => row.symbol === "INJ");
  const injRotateTrades = injTrades.filter((row) => row.entry_reason.includes("trend-rotate"));

  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    avaxPnl: symbolPnl("AVAX"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    uniPnl: symbolPnl("UNI"),
    twtPnl: symbolPnl("TWT"),
    injTrades: symbolTrades("INJ"),
    injRotationEntries: injRotateTrades.length,
    injRotationPnl: round(injRotateTrades.reduce((sum, row) => sum + Number(row.net_pnl || 0), 0)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;

  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(base, nonCashWindows);

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "baseline",
      memo: "Current Xserver production baseline.",
      options: { ...production, label: "baseline" },
    },
    {
      key: "inj_no_rotation_target",
      memo: "Keep INJ normal entries, but remove INJ as a rotation-target exception.",
      options: {
        ...production,
        trendRotationTargetExceptionBySymbol: {},
        label: "inj_no_rotation_target",
      },
    },
    {
      key: "inj_exception_stricter",
      memo: "Keep INJ rotation exception, but tighten score/momentum/volume/ADX filters.",
      options: {
        ...production,
        trendRotationTargetExceptionBySymbol: {
          ...(production.trendRotationTargetExceptionBySymbol ?? {}),
          INJ: {
            minScore: 30,
            minMom20: 0.16,
            minMomAccel: 0.02,
            minVolumeRatio: 1.45,
            minAdx14: 22,
            minEfficiencyRatio: 0.26,
            requireStructureBreak: true,
            requireDowHigherHighLow: false,
          },
        },
        label: "inj_exception_stricter",
      },
    },
    {
      key: "inj_exception_loose_no_dow",
      memo: "Looser INJ exception without Dow HHHL gate, to capture large moves earlier.",
      options: {
        ...production,
        trendRotationTargetExceptionBySymbol: {
          ...(production.trendRotationTargetExceptionBySymbol ?? {}),
          INJ: {
            minScore: 24,
            minMom20: 0.12,
            minMomAccel: 0.012,
            minVolumeRatio: 1.20,
            minAdx14: 18,
            minEfficiencyRatio: 0.20,
            requireStructureBreak: true,
            requireDowHigherHighLow: false,
          },
        },
        label: "inj_exception_loose_no_dow",
      },
    },
  ];

  const rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }> = [];
  for (const variant of variants) {
    console.log(`running ${variant.key}`);
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    rows.push({ key: variant.key, memo: variant.memo, summary: summarize(result) });
  }

  const baseline = rows[0]?.summary;
  const markdown = [
    "# Xserver INJ Improvements",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | end equity | delta | MaxDD % | PF | trades | INJ pnl | INJ trades | INJ rotate entries | INJ rotate pnl | ETH | PENGU | DOGE | TWT |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map(({ key, summary }) =>
      [
        key,
        summary.endEquity.toLocaleString(),
        round(summary.endEquity - (baseline?.endEquity ?? summary.endEquity)).toLocaleString(),
        summary.maxDrawdownPct,
        summary.profitFactor,
        summary.trades,
        summary.injPnl.toLocaleString(),
        summary.injTrades,
        summary.injRotationEntries,
        summary.injRotationPnl.toLocaleString(),
        summary.ethPnl.toLocaleString(),
        summary.penguPnl.toLocaleString(),
        summary.dogePnl.toLocaleString(),
        summary.twtPnl.toLocaleString(),
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    ),
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
