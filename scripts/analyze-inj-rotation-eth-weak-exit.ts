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

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "inj-rotation-eth-weak-exit");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
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

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
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

function withEthWeakExit(
  options: HybridVariantOptions,
  mom20Below: number,
  momAccelBelow: number,
) {
  return {
    ...options,
    symbolSpecificTrendWeakExitSymbols: unique([...(options.symbolSpecificTrendWeakExitSymbols ?? []), "ETH"]),
    symbolSpecificTrendWeakExitMom20Below: mom20Below,
    symbolSpecificTrendWeakExitMomAccelBelow: momAccelBelow,
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const bySymbol = Object.fromEntries(
    Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
  );
  const symbolRows = ["ETH", "INJ", "PENGU", "DOGE", "TWT", "AVAX", "UNI", "SOL"].map((symbol) => {
    const trades = result.trade_pairs.filter((row) => row.symbol === symbol);
    return {
      symbol,
      pnl: round(result.summary.symbol_contribution[symbol] ?? 0),
      trades: trades.length,
      rotateEntries: trades.filter((row) => String(row.entry_reason).startsWith("trend-rotate")).length,
      weakExits: trades.filter((row) => row.exit_reason === "symbol-weak-exit").length,
      riskOffExits: trades.filter((row) => row.exit_reason === "risk-off").length,
    };
  });
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    bySymbol,
    symbolRows,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(base, nonCashWindows);

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "current_deployed",
      thesis: "Current deployed logic.",
      options: { ...production, label: "current_deployed" },
    },
    {
      key: "inj_no_rotation_target",
      thesis: "INJ remains a normal entry candidate, but cannot be selected as a trend-rotation target.",
      options: {
        ...production,
        trendRotationTargetBlockSymbols: ["INJ"],
        label: "inj_no_rotation_target",
      },
    },
    {
      key: "eth_weak_exit_008_000",
      thesis: "Add ETH weak exit: mom20 <= 8% and momAccel <= 0.",
      options: {
        ...withEthWeakExit(production, 0.08, 0),
        label: "eth_weak_exit_008_000",
      },
    },
    {
      key: "eth_weak_exit_010_000",
      thesis: "Add ETH weak exit: mom20 <= 10% and momAccel <= 0.",
      options: {
        ...withEthWeakExit(production, 0.1, 0),
        label: "eth_weak_exit_010_000",
      },
    },
    {
      key: "eth_weak_exit_006_m001",
      thesis: "Add ETH weak exit: mom20 <= 6% and momAccel <= -1%.",
      options: {
        ...withEthWeakExit(production, 0.06, -0.01),
        label: "eth_weak_exit_006_m001",
      },
    },
    {
      key: "combo_inj_no_rotate_eth_008",
      thesis: "INJ cannot be a rotation target plus ETH weak exit 8%/0.",
      options: {
        ...withEthWeakExit(production, 0.08, 0),
        trendRotationTargetBlockSymbols: ["INJ"],
        label: "combo_inj_no_rotate_eth_008",
      },
    },
    {
      key: "combo_inj_no_rotate_eth_010",
      thesis: "INJ cannot be a rotation target plus ETH weak exit 10%/0.",
      options: {
        ...withEthWeakExit(production, 0.1, 0),
        trendRotationTargetBlockSymbols: ["INJ"],
        label: "combo_inj_no_rotate_eth_010",
      },
    },
    {
      key: "combo_inj_no_rotate_eth_006_m001",
      thesis: "INJ cannot be a rotation target plus ETH weak exit 6%/-1%.",
      options: {
        ...withEthWeakExit(production, 0.06, -0.01),
        trendRotationTargetBlockSymbols: ["INJ"],
        label: "combo_inj_no_rotate_eth_006_m001",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, thesis: variant.thesis, ...summary });
    console.log(`${variant.key}: end=${summary.endEquity} CAGR=${summary.cagrPct} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.tradeCount} ETH=${summary.bySymbol.ETH ?? 0} INJ=${summary.bySymbol.INJ ?? 0}`);
  }

  const md = [
    "# INJ Rotation Restriction / ETH Weak Exit Tests",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | trades | ETH pnl | INJ pnl | PENGU pnl | DOGE pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.bySymbol.ETH ?? 0} | ${row.bySymbol.INJ ?? 0} | ${row.bySymbol.PENGU ?? 0} | ${row.bySymbol.DOGE ?? 0} |`),
    "",
    "## Details",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
