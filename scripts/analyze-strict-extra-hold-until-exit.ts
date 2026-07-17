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

const REPORT_DIR = path.join(process.cwd(), "reports", "strict-extra-hold-until-exit");
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
  const bySymbol = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol);
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const switchAwayFromStrictExtra = result.trade_pairs.filter((row) =>
    ["PENGU", "DOGE"].includes(row.symbol)
    && ["trend-switch", "trend-rotate", "rebalance-switch"].includes(row.exit_reason)
  );
  const strictExtraTrades = ["PENGU", "DOGE"].flatMap(bySymbol);

  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    uniPnl: symbolPnl("UNI"),
    twtPnl: symbolPnl("TWT"),
    penguTrades: bySymbol("PENGU").length,
    dogeTrades: bySymbol("DOGE").length,
    strictExtraAvgHoldBars: round(
      strictExtraTrades.reduce((sum, row) => sum + row.holding_bars, 0) / Math.max(1, strictExtraTrades.length),
      2,
    ),
    strictExtraSwitchAwayCount: switchAwayFromStrictExtra.length,
    strictExtraSwitchAwayPnl: round(switchAwayFromStrictExtra.reduce((sum, row) => sum + row.net_pnl, 0)),
    strictExtraExitReasons: Object.fromEntries(
      [...strictExtraTrades.reduce((map, row) => {
        map.set(row.exit_reason, (map.get(row.exit_reason) ?? 0) + 1);
        return map;
      }, new Map<string, number>()).entries()].sort((left, right) => left[0].localeCompare(right[0])),
    ),
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

  const variants: Array<{ key: string; options: HybridVariantOptions; memo: string }> = [
    {
      key: "production_current",
      memo: "Current deployed logic.",
      options: { ...production, label: "production_current" },
    },
    {
      key: "protect_pengu_doge_hold_until_exit",
      memo: "Do not switch PENGU/DOGE to normal trend candidates such as SOL. Hold until their own exit/trailing fires.",
      options: {
        ...production,
        strictExtraTrendHoldUntilExit: true,
        label: "protect_pengu_doge_hold_until_exit",
      },
    },
    {
      key: "guard_sol_soft",
      memo: "Block PENGU/DOGE -> SOL if current score >= 20, mom20 >= 8%, SOL lead < 8, or near trailing.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU", "DOGE"],
        strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
        strictExtraTrendSwitchGuardMinCurrentScore: 20,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.08,
        strictExtraTrendSwitchGuardRequiredScoreGap: 8,
        strictExtraTrendSwitchGuardNearTrailRatio: 0.7,
        label: "guard_sol_soft",
      },
    },
    {
      key: "guard_sol_balanced",
      memo: "Block PENGU/DOGE -> SOL if current score >= 15, mom20 >= 5%, SOL lead < 12, or near trailing.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU", "DOGE"],
        strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
        strictExtraTrendSwitchGuardMinCurrentScore: 15,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.05,
        strictExtraTrendSwitchGuardRequiredScoreGap: 12,
        strictExtraTrendSwitchGuardNearTrailRatio: 0.65,
        label: "guard_sol_balanced",
      },
    },
    {
      key: "guard_sol_strict",
      memo: "Block PENGU/DOGE -> SOL if current score >= 10, mom20 >= 2%, SOL lead < 15, or near trailing.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU", "DOGE"],
        strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
        strictExtraTrendSwitchGuardMinCurrentScore: 10,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.02,
        strictExtraTrendSwitchGuardRequiredScoreGap: 15,
        strictExtraTrendSwitchGuardNearTrailRatio: 0.6,
        label: "guard_sol_strict",
      },
    },
    {
      key: "guard_all_balanced",
      memo: "Block PENGU/DOGE -> any normal trend candidate with balanced guard.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU", "DOGE"],
        strictExtraTrendSwitchGuardMinCurrentScore: 15,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.05,
        strictExtraTrendSwitchGuardRequiredScoreGap: 12,
        strictExtraTrendSwitchGuardNearTrailRatio: 0.65,
        label: "guard_all_balanced",
      },
    },
    {
      key: "pengu_to_sol_block_below_12",
      memo: "Only PENGU -> SOL: block switch when PENGU unrealized profit is below +12%.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU"],
        strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
        strictExtraTrendSwitchGuardBlockBelowProfitPct: 0.12,
        label: "pengu_to_sol_block_below_12",
      },
    },
    {
      key: "pengu_to_sol_wait_after_trail_activation",
      memo: "Only PENGU -> SOL: if PENGU profit protection is activated, do not switch to SOL; wait for PENGU exit. Below +12%, keep current behavior.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU"],
        strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
        strictExtraTrendSwitchGuardBlockAfterTrailActivation: true,
        label: "pengu_to_sol_wait_after_trail_activation",
      },
    },
    {
      key: "pengu_to_sol_block_below_12_or_after_trail",
      memo: "Only PENGU -> SOL: block if PENGU is below +12% or after profit protection activation.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU"],
        strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
        strictExtraTrendSwitchGuardBlockBelowProfitPct: 0.12,
        strictExtraTrendSwitchGuardBlockAfterTrailActivation: true,
        label: "pengu_to_sol_block_below_12_or_after_trail",
      },
    },
    {
      key: "pengu_to_sol_cash_escape",
      memo: "Only PENGU -> SOL: sell PENGU to USDT and skip same-bar SOL entry.",
      options: {
        ...production,
        strictExtraTrendSwitchToCashSymbols: ["PENGU"],
        strictExtraTrendSwitchToCashTargetSymbols: ["SOL"],
        label: "pengu_to_sol_cash_escape",
      },
    },
    {
      key: "pengu_doge_to_sol_cash_escape",
      memo: "PENGU/DOGE -> SOL: sell strict-extra coin to USDT and skip same-bar SOL entry.",
      options: {
        ...production,
        strictExtraTrendSwitchToCashSymbols: ["PENGU", "DOGE"],
        strictExtraTrendSwitchToCashTargetSymbols: ["SOL"],
        label: "pengu_doge_to_sol_cash_escape",
      },
    },
    {
      key: "pengu_to_sol_cash_escape_below_0",
      memo: "Only PENGU -> SOL: cash escape only when PENGU unrealized profit is below 0%.",
      options: {
        ...production,
        strictExtraTrendSwitchToCashSymbols: ["PENGU"],
        strictExtraTrendSwitchToCashTargetSymbols: ["SOL"],
        strictExtraTrendSwitchToCashBelowProfitPct: 0,
        label: "pengu_to_sol_cash_escape_below_0",
      },
    },
    {
      key: "pengu_to_sol_cash_escape_below_12",
      memo: "Only PENGU -> SOL: cash escape only when PENGU unrealized profit is below +12%.",
      options: {
        ...production,
        strictExtraTrendSwitchToCashSymbols: ["PENGU"],
        strictExtraTrendSwitchToCashTargetSymbols: ["SOL"],
        strictExtraTrendSwitchToCashBelowProfitPct: 0.12,
        label: "pengu_to_sol_cash_escape_below_12",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    console.log(
      `${variant.key}: end=${summary.endEquity} CAGR=${summary.cagrPct} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.trades} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} SOL=${summary.solPnl} switchAway=${summary.strictExtraSwitchAwayCount}`,
    );
  }

  const md = [
    "# Strict Extra Hold Until Exit",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "- test: PENGU/DOGE保有中は通常トレンド候補への乗り換えを禁止し、専用出口まで保有する。",
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | PENGU pnl | DOGE pnl | SOL pnl | strict switch away | strict switch away pnl | strict avg hold |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.penguPnl} | ${row.dogePnl} | ${row.solPnl} | ${row.strictExtraSwitchAwayCount} | ${row.strictExtraSwitchAwayPnl} | ${row.strictExtraAvgHoldBars} |`),
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
