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

const REPORT_DIR = path.join(process.cwd(), "reports", "next-logic-improvements");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 18, 23, 59, 59, 999);
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
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol).length;
  const trendTrailExits = result.trade_pairs.filter((row) => row.exit_reason === "trend-profit-trailing");
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    trendTrailExits: trendTrailExits.length,
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    twtPnl: symbolPnl("TWT"),
    uniPnl: symbolPnl("UNI"),
    trxPnl: symbolPnl("TRX"),
    cakePnl: symbolPnl("CAKE"),
    solTrades: symbolTrades("SOL"),
    injTrades: symbolTrades("INJ"),
    penguTrades: symbolTrades("PENGU"),
    dogeTrades: symbolTrades("DOGE"),
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
  const recentWindow = [{ startTs: Date.UTC(2025, 11, 31), endTs: Date.UTC(2026, 3, 18, 23, 59, 59, 999) }];

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "production_current",
      memo: "Current production: INJ bigmove_c_mid + normal trend trail 18/12.",
      options: { ...production, label: "production_current" },
    },
    {
      key: "sol_trail_12_8",
      memo: "SOL-specific profit trail 12/8 while keeping global trend trail 18/12.",
      options: {
        ...production,
        trendProfitTrailActivationPctBySymbol: { SOL: 0.12 },
        trendProfitTrailRetracePctBySymbol: { SOL: 0.08 },
        label: "sol_trail_12_8",
      },
    },
    {
      key: "sol_trail_15_8",
      memo: "SOL-specific profit trail 15/8 while keeping global trend trail 18/12.",
      options: {
        ...production,
        trendProfitTrailActivationPctBySymbol: { SOL: 0.15 },
        trendProfitTrailRetracePctBySymbol: { SOL: 0.08 },
        label: "sol_trail_15_8",
      },
    },
    {
      key: "btc_weak_trail_15_8",
      memo: "BTC weak-context proxy: lower global trend trail to 15/8.",
      options: {
        ...production,
        trendProfitTrailActivationPct: 0.15,
        trendProfitTrailRetracePct: 0.08,
        label: "btc_weak_trail_15_8",
      },
    },
    {
      key: "btc_weak_exit_more_sensitive",
      memo: "More sensitive weak BTC trend exit.",
      options: {
        ...production,
        trendWeakExitBestMom20Below: 0.08,
        trendWeakExitBtcAdxBelow: 24,
        label: "btc_weak_exit_more_sensitive",
      },
    },
    {
      key: "pengu_doge_rotation_selective",
      memo: "Selective strict-extra rotation with moderate gap and still-weak current holding.",
      options: {
        ...production,
        strictExtraTrendRotationScoreGap: 8,
        strictExtraTrendRotationCurrentMomAccelMax: 0.005,
        strictExtraTrendRotationCurrentMom20Max: 0.12,
        strictExtraTrendRotationMinHoldBars: 2,
        strictExtraTrendRotationRequireConsecutiveBars: 1,
        label: "pengu_doge_rotation_selective",
      },
    },
    {
      key: "pengu_doge_rotation_strict",
      memo: "Stricter PENGU/DOGE rotation only when current is clearly fading.",
      options: {
        ...production,
        strictExtraTrendRotationScoreGap: 12,
        strictExtraTrendRotationCurrentMomAccelMax: -0.01,
        strictExtraTrendRotationCurrentMom20Max: 0.08,
        strictExtraTrendRotationMinHoldBars: 2,
        strictExtraTrendRotationRequireConsecutiveBars: 1,
        label: "pengu_doge_rotation_strict",
      },
    },
    {
      key: "idle_rescue_uni_twt_trx",
      memo: "USDT idle rescue adds TRX to existing cash-only framework.",
      options: {
        ...production,
        idleBreakoutEntryWhileCash: true,
        idleBreakoutEntryTimeframe: "6h",
        idleBreakoutSymbols: ["TRX"],
        idleBreakoutAllowedWindows: cashOnlyWindows,
        idleBreakoutAllowTradeGateOff: true,
        idleBreakoutBreakoutLookbackBars: 8,
        idleBreakoutBreakoutMinPct: 0.012,
        idleBreakoutMinVolumeRatio: 1.01,
        idleBreakoutMinMomAccel: 0.0005,
        idleBreakoutMinEfficiencyRatio: 0.17,
        idleBreakoutProfitTrailActivationPct: 0.16,
        idleBreakoutProfitTrailRetracePct: 0.075,
        idleBreakoutMaxHoldBars: 8,
        label: "idle_rescue_uni_twt_trx",
      },
    },
    {
      key: "recent_filter_light",
      memo: "Light recent weak-market filter for ETH/INJ only.",
      options: {
        ...production,
        trendWindowedOverridesBySymbol: {
          ...(production.trendWindowedOverridesBySymbol ?? {}),
          ETH: {
            windows: recentWindow,
            minMomAccel: 0.005,
            minEfficiencyRatio: 0.24,
            scoreAdjustment: -2,
          },
          INJ: {
            windows: recentWindow,
            breakoutLookbackBars: 3,
            breakoutMinPct: 0.035,
            minVolumeRatio: 1.4,
            minMomAccel: 0.025,
            minEfficiencyRatio: 0.27,
            scoreAdjustment: -3,
          },
        },
        label: "recent_filter_light",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    console.log(`${variant.key}: end=${summary.endEquity} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.trades} trail=${summary.trendTrailExits} ETH=${summary.ethPnl} SOL=${summary.solPnl} INJ=${summary.injPnl} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} TWT=${summary.twtPnl} TRX=${summary.trxPnl}`);
  }

  const md = [
    "# Next Logic Improvements",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | trail exits | ETH | SOL | INJ | PENGU | DOGE | TWT | TRX | CAKE |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.trendTrailExits} | ${row.ethPnl} | ${row.solPnl} | ${row.injPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.twtPnl} | ${row.trxPnl} | ${row.cakePnl} |`),
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  const suffix = process.env.BT_START ? `-${process.env.BT_START}-${process.env.BT_END}` : "";
  await fs.writeFile(path.join(REPORT_DIR, `result${suffix}.json`), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, `result${suffix}.md`), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
