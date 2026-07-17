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
import type { BacktestResult, TradePairRow } from "../lib/backtest/types";

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "risk-and-symbol-improvements");
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

function maxDrawdownWindow(result: BacktestResult) {
  let peak = -Infinity;
  let peakPoint = result.equity_curve[0];
  let worst = {
    peak: result.equity_curve[0],
    trough: result.equity_curve[0],
    drawdownPct: 0,
  };

  for (const point of result.equity_curve) {
    if (point.equity > peak) {
      peak = point.equity;
      peakPoint = point;
    }
    const drawdownPct = peak > 0 ? (point.equity / peak - 1) * 100 : 0;
    if (drawdownPct < worst.drawdownPct) {
      worst = { peak: peakPoint, trough: point, drawdownPct };
    }
  }
  return worst;
}

function overlappingTrades(result: BacktestResult, startTs: number, endTs: number) {
  return result.trade_pairs
    .filter((trade) => Date.parse(trade.entry_time) <= endTs && Date.parse(trade.exit_time) >= startTs)
    .map((trade) => ({
      symbol: trade.symbol,
      entry: trade.entry_time,
      exit: trade.exit_time,
      pnl: round(trade.net_pnl),
      holdBars: trade.holding_bars,
      entryReason: trade.entry_reason,
      exitReason: trade.exit_reason,
    }));
}

function lossTrades(result: BacktestResult, startTs: number, endTs: number) {
  return result.trade_pairs
    .filter((trade) => trade.net_pnl < 0 && Date.parse(trade.exit_time) >= startTs && Date.parse(trade.exit_time) <= endTs)
    .sort((left, right) => left.net_pnl - right.net_pnl)
    .slice(0, 10)
    .map((trade) => tradeSummary(trade));
}

function tradeSummary(trade: TradePairRow) {
  return {
    symbol: trade.symbol,
    entry: trade.entry_time,
    exit: trade.exit_time,
    pnl: round(trade.net_pnl),
    returnPct: round((trade.exit_price / trade.entry_price - 1) * 100, 2),
    holdBars: trade.holding_bars,
    entryReason: trade.entry_reason,
    exitReason: trade.exit_reason,
  };
}

function summarize(result: BacktestResult) {
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol).length;
  const trendTrailExits = result.trade_pairs.filter((row) => row.exit_reason === "trend-profit-trailing");
  const dd = maxDrawdownWindow(result);
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    trendTrailExits: trendTrailExits.length,
    ddPeakTime: dd.peak.iso_time,
    ddPeakEquity: round(dd.peak.equity),
    ddTroughTime: dd.trough.iso_time,
    ddTroughEquity: round(dd.trough.equity),
    ddPosition: dd.trough.position_symbol,
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    twtPnl: symbolPnl("TWT"),
    uniPnl: symbolPnl("UNI"),
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
  const recentStart = Date.UTC(2025, 11, 31);
  const recentEnd = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
  const recentWindow = [{ startTs: recentStart, endTs: recentEnd }];

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "production_current",
      memo: "Current production baseline.",
      options: { ...production, label: "production_current" },
    },
    {
      key: "symbol_trail_sol12_inj15_twt18",
      memo: "Symbol-specific trend profit trail: SOL 12/8, INJ 15/8, TWT 18/10.",
      options: {
        ...production,
        trendProfitTrailActivationPctBySymbol: { SOL: 0.12, INJ: 0.15, TWT: 0.18 },
        trendProfitTrailRetracePctBySymbol: { SOL: 0.08, INJ: 0.08, TWT: 0.10 },
        label: "symbol_trail_sol12_inj15_twt18",
      },
    },
    {
      key: "exit_check_6h",
      memo: "Use 6H trend exit checks while keeping 12H decisions.",
      options: {
        ...production,
        trendExitCheckTimeframe: "6h",
        label: "exit_check_6h",
      },
    },
    {
      key: "exit_check_4h",
      memo: "Use 4H trend exit checks while keeping 12H decisions.",
      options: {
        ...production,
        trendExitCheckTimeframe: "4h",
        label: "exit_check_4h",
      },
    },
    {
      key: "exit_6h_plus_sol12",
      memo: "6H exits plus SOL-specific 12/8 trail.",
      options: {
        ...production,
        trendExitCheckTimeframe: "6h",
        trendProfitTrailActivationPctBySymbol: { SOL: 0.12 },
        trendProfitTrailRetracePctBySymbol: { SOL: 0.08 },
        label: "exit_6h_plus_sol12",
      },
    },
    {
      key: "recent_loss_filter_light",
      memo: "Recent weak period filter for ETH/INJ to avoid recent losing trades.",
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
        label: "recent_loss_filter_light",
      },
    },
    {
      key: "dd_guard_sol12",
      memo: "Pinpoint DD reduction candidate: SOL-specific 12/8 trail.",
      options: {
        ...production,
        trendProfitTrailActivationPctBySymbol: { SOL: 0.12 },
        trendProfitTrailRetracePctBySymbol: { SOL: 0.08 },
        label: "dd_guard_sol12",
      },
    },
    {
      key: "dd_guard_sol12_no_inj_rotation",
      memo: "SOL DD guard plus disable INJ rotation exception to reduce drawdown.",
      options: {
        ...production,
        trendProfitTrailActivationPctBySymbol: { SOL: 0.12 },
        trendProfitTrailRetracePctBySymbol: { SOL: 0.08 },
        trendRotationTargetExceptionBySymbol: {
          ...(production.trendRotationTargetExceptionBySymbol ?? {}),
          INJ: {
            minScore: 999,
            minMom20: 9,
            minMomAccel: 9,
            minVolumeRatio: 9,
            minAdx14: 99,
            minEfficiencyRatio: 9,
            requireStructureBreak: true,
          },
        },
        label: "dd_guard_sol12_no_inj_rotation",
      },
    },
  ];

  const rows = [];
  const details: Record<string, unknown> = {};
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    const dd = maxDrawdownWindow(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    details[variant.key] = {
      maxDrawdownWindow: {
        peak: dd.peak,
        trough: dd.trough,
        drawdownPct: round(dd.drawdownPct),
        overlappingTrades: overlappingTrades(result, dd.peak.ts, dd.trough.ts),
      },
      recentWorstLosses: lossTrades(result, recentStart, recentEnd),
    };
    console.log(`${variant.key}: end=${summary.endEquity} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.trades} trail=${summary.trendTrailExits} DD=${summary.ddPeakTime}->${summary.ddTroughTime} ${summary.ddPosition} ETH=${summary.ethPnl} SOL=${summary.solPnl} INJ=${summary.injPnl} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} TWT=${summary.twtPnl}`);
  }

  const md = [
    "# Risk And Symbol Improvements",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | trail exits | DD window | DD symbol | ETH | SOL | INJ | PENGU | DOGE | TWT |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.trendTrailExits} | ${row.ddPeakTime} -> ${row.ddTroughTime} | ${row.ddPosition} | ${row.ethPnl} | ${row.solPnl} | ${row.injPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.twtPnl} |`),
    "",
    "```json",
    JSON.stringify({ rows, details }, null, 2),
    "```",
  ].join("\n");

  const suffix = process.env.BT_START ? `-${process.env.BT_START}-${process.env.BT_END}` : "";
  await fs.writeFile(path.join(REPORT_DIR, `result${suffix}.json`), JSON.stringify({ rows, details }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, `result${suffix}.md`), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
