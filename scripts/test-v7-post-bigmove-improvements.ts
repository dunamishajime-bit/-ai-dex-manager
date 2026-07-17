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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-post-bigmove-improvements");
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
    injTrades: symbolTrades("INJ"),
    solTrades: symbolTrades("SOL"),
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
  const weakRecentWindow = [{ startTs: Date.UTC(2025, 11, 31), endTs: Date.UTC(2026, 3, 18, 23, 59, 59, 999) }];

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "production_bigmove_c_mid",
      memo: "Current deployed bigmove_c_mid baseline.",
      options: { ...production, label: "production_bigmove_c_mid" },
    },
    {
      key: "maxdd_guard_profit_trail",
      memo: "Add broad trend profit protection to reduce drawdown after large gains.",
      options: {
        ...production,
        trendProfitTrailActivationPct: 0.22,
        trendProfitTrailRetracePct: 0.12,
        label: "maxdd_guard_profit_trail",
      },
    },
    {
      key: "maxdd_guard_btc_weak_exit",
      memo: "Exit trends earlier when weak BTC regime persists.",
      options: {
        ...production,
        trendWeakExitBestMom20Below: 0.07,
        trendWeakExitBtcAdxBelow: 22,
        label: "maxdd_guard_btc_weak_exit",
      },
    },
    {
      key: "recent_idle_trx_cake",
      memo: "Improve recent weak period with TRX/CAKE idle rescue only during cash windows.",
      options: {
        ...production,
        idleBreakoutEntryWhileCash: true,
        idleBreakoutEntryTimeframe: "6h",
        idleBreakoutSymbols: ["TRX", "CAKE"],
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
        label: "recent_idle_trx_cake",
      },
    },
    {
      key: "strict_extra_rotation_more_open",
      memo: "Allow stronger PENGU/DOGE rotations from normal trend holdings a bit more easily.",
      options: {
        ...production,
        strictExtraTrendRotationScoreGap: 6,
        strictExtraTrendRotationCurrentMomAccelMax: 0.02,
        strictExtraTrendRotationCurrentMom20Max: 0.18,
        strictExtraTrendRotationMinHoldBars: 1,
        label: "strict_extra_rotation_more_open",
      },
    },
    {
      key: "sol_escape_to_strict_extra",
      memo: "When holding SOL, allow faster escape to PENGU/DOGE if strict-extra is strong.",
      options: {
        ...production,
        strictExtraTrendRotationScoreGapBySymbol: {
          PENGU: 5,
          DOGE: 5,
        },
        strictExtraTrendRotationCurrentSymbols: ["SOL"],
        strictExtraTrendRotationCurrentMomAccelMax: 0.08,
        strictExtraTrendRotationCurrentMom20Max: 0.2,
        strictExtraTrendRotationRequireConsecutiveBarsBySymbol: {
          PENGU: 1,
          DOGE: 1,
        },
        strictExtraTrendRotationMinHoldBars: 1,
        label: "sol_escape_to_strict_extra",
      },
    },
    {
      key: "recent_filter_eth_inj",
      memo: "During recent weak window, make ETH/INJ entries more selective.",
      options: {
        ...production,
        trendWindowedOverridesBySymbol: {
          ...(production.trendWindowedOverridesBySymbol ?? {}),
          ETH: {
            windows: weakRecentWindow,
            minMomAccel: 0.02,
            minEfficiencyRatio: 0.28,
            scoreAdjustment: -4,
          },
          INJ: {
            windows: weakRecentWindow,
            breakoutLookbackBars: 4,
            breakoutMinPct: 0.04,
            minVolumeRatio: 1.5,
            minMomAccel: 0.03,
            minEfficiencyRatio: 0.3,
            scoreAdjustment: -6,
          },
        },
        label: "recent_filter_eth_inj",
      },
    },
    {
      key: "combined_defensive",
      memo: "Combine recent filter, SOL escape, and BTC weak exit.",
      options: {
        ...production,
        trendWeakExitBestMom20Below: 0.07,
        trendWeakExitBtcAdxBelow: 22,
        strictExtraTrendRotationScoreGapBySymbol: {
          PENGU: 5,
          DOGE: 5,
        },
        strictExtraTrendRotationCurrentSymbols: ["SOL"],
        strictExtraTrendRotationCurrentMomAccelMax: 0.08,
        strictExtraTrendRotationCurrentMom20Max: 0.2,
        strictExtraTrendRotationMinHoldBars: 1,
        trendWindowedOverridesBySymbol: {
          ...(production.trendWindowedOverridesBySymbol ?? {}),
          ETH: {
            windows: weakRecentWindow,
            minMomAccel: 0.02,
            minEfficiencyRatio: 0.28,
            scoreAdjustment: -4,
          },
          INJ: {
            windows: weakRecentWindow,
            breakoutLookbackBars: 4,
            breakoutMinPct: 0.04,
            minVolumeRatio: 1.5,
            minMomAccel: 0.03,
            minEfficiencyRatio: 0.3,
            scoreAdjustment: -6,
          },
        },
        label: "combined_defensive",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    console.log(
      `${variant.key}: end=${summary.endEquity} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.trades} ETH=${summary.ethPnl} SOL=${summary.solPnl} INJ=${summary.injPnl} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} TWT=${summary.twtPnl}`,
    );
  }

  const md = [
    "# V7 Post Bigmove Improvements",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | ETH | SOL | INJ | PENGU | DOGE | UNI | TWT |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.ethPnl} | ${row.solPnl} | ${row.injPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.uniPnl} | ${row.twtPnl} |`),
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, process.env.BT_START ? `result-${process.env.BT_START}-${process.env.BT_END}.json` : "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, process.env.BT_START ? `result-${process.env.BT_START}-${process.env.BT_END}.md` : "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
