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

const REPORT_DIR = path.join(process.cwd(), "reports", "final-improvement-candidates");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;
const REPORT_SUFFIX = process.env.BT_START || process.env.BT_END
  ? `-${process.env.BT_START ?? "start"}-${process.env.BT_END ?? "end"}`
  : "";

const IDLE_CANDIDATES = [
  "TRX",
  "CAKE",
  "BNB",
  "LINK",
  "SFP",
  "NEAR",
  "LTC",
  "XRP",
  "ATOM",
  "AAVE",
  "ADA",
  "ZEC",
  "DASH",
  "BAT",
  "BCH",
  "EOS",
  "AXS",
  "DODO",
  "XVS",
  "SHIB",
  "PEPE",
] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
}

function buildWindowsFromPoints(
  points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>,
  predicate: (point: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>[number]) => boolean,
) {
  const selected = points.filter(predicate).sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const point of selected) {
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
  return windows.filter((window) => window.endTs > window.startTs);
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

function addCashOnlySymbol(
  production: HybridVariantOptions,
  symbol: string,
  nonCashWindows: readonly Window[],
) {
  return {
    ...production,
    expandedTrendSymbols: unique([...(production.expandedTrendSymbols ?? []), symbol]),
    trendBreakoutLookbackBarsBySymbol: {
      ...(production.trendBreakoutLookbackBarsBySymbol ?? {}),
      [symbol]: 8,
    },
    trendBreakoutMinPctBySymbol: {
      ...(production.trendBreakoutMinPctBySymbol ?? {}),
      [symbol]: 0.012,
    },
    trendMinVolumeRatioBySymbol: {
      ...(production.trendMinVolumeRatioBySymbol ?? {}),
      [symbol]: 1.01,
    },
    trendMinMomAccelBySymbol: {
      ...(production.trendMinMomAccelBySymbol ?? {}),
      [symbol]: 0.0005,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(production.trendMinEfficiencyRatioBySymbol ?? {}),
      [symbol]: 0.17,
    },
    trendSymbolBlockWindows: {
      ...(production.trendSymbolBlockWindows ?? {}),
      [symbol]: nonCashWindows,
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

function tradeSummary(trade: TradePairRow) {
  return {
    symbol: trade.symbol,
    entry: trade.entry_time,
    exit: trade.exit_time,
    pnl: round(trade.net_pnl),
    returnPct: round((trade.exit_price / trade.entry_price - 1) * 100),
    holdBars: trade.holding_bars,
    entryReason: trade.entry_reason,
    exitReason: trade.exit_reason,
  };
}

function summarize(result: BacktestResult) {
  const dd = maxDrawdownWindow(result);
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol).length;
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    ddPeakTime: dd.peak.iso_time,
    ddTroughTime: dd.trough.iso_time,
    ddSymbol: dd.trough.position_symbol,
    ETH: symbolPnl("ETH"),
    SOL: symbolPnl("SOL"),
    AVAX: symbolPnl("AVAX"),
    INJ: symbolPnl("INJ"),
    PENGU: symbolPnl("PENGU"),
    DOGE: symbolPnl("DOGE"),
    UNI: symbolPnl("UNI"),
    TWT: symbolPnl("TWT"),
    SOLTrades: symbolTrades("SOL"),
    AVAXTrades: symbolTrades("AVAX"),
    INJTrades: symbolTrades("INJ"),
  };
}

function avaxDiagnostics(result: BacktestResult) {
  const avaxTrades = result.trade_pairs.filter((trade) => trade.symbol === "AVAX");
  return {
    totalPnl: round(avaxTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    trades: avaxTrades.length,
    wins: avaxTrades.filter((trade) => trade.net_pnl > 0).length,
    losses: avaxTrades.filter((trade) => trade.net_pnl < 0).length,
    worstTrades: avaxTrades
      .filter((trade) => trade.net_pnl < 0)
      .sort((left, right) => left.net_pnl - right.net_pnl)
      .slice(0, 8)
      .map(tradeSummary),
    allTrades: avaxTrades.map(tradeSummary),
  };
}

async function runVariant(key: string, memo: string, options: HybridVariantOptions) {
  const result = await runHybridBacktest("RETQ22", { ...options, label: key });
  const summary = summarize(result);
  console.log(`${key}: end=${summary.endEquity} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} AVAX=${summary.AVAX} SOL=${summary.SOL} ETH=${summary.ETH} INJ=${summary.INJ}`);
  return { key, memo, summary, result };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildWindowsFromPoints(
    decisionWindow,
    (point) => point.decision.desiredSymbol === "USDT" && point.decision.desiredSide === "cash",
  );
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const weakMarketWindows = buildWindowsFromPoints(decisionWindow, (point) => {
    const regime = point.decision.regime;
    return regime.weak2022Regime && regime.bestMom20 < 0.08 && regime.btc.adx14 < 18;
  });
  const production = applyCashOnlyUniTwt(base, nonCashWindows);

  const variants = [
    await runVariant("production_current", "Current V7 production baseline.", production),
    await runVariant("avax_no_aux_range", "Remove AVAX auxRange only.", {
      ...production,
      auxRangeSymbols: [],
    }),
    await runVariant("avax_regime_gate_on", "Keep AVAX but stop ignoring range regime gate.", {
      ...production,
      auxRangeIgnoreRegimeGate: false,
    }),
    await runVariant("avax_strict_gate", "Stricter AVAX auxRange entry gate.", {
      ...production,
      auxRangeEntryBestMom20Below: 0.035,
      auxRangeEntryBtcAdxBelow: 25,
      auxRangeOverheatMax: 0,
      auxRangeMaxHoldBars: 3,
    }),
    await runVariant("avax_fast_exit", "AVAX auxRange max hold shortened to 2 bars.", {
      ...production,
      auxRangeMaxHoldBars: 2,
    }),
    await runVariant("sol_12_8_dd_guard", "SOL-specific normal trend profit trail 12/8.", {
      ...production,
      trendProfitTrailActivationPctBySymbol: { SOL: 0.12 },
      trendProfitTrailRetracePctBySymbol: { SOL: 0.08 },
    }),
    await runVariant("eth_inj_weak_market_block", "Block ETH/INJ entries only during weak-market windows.", {
      ...production,
      trendSymbolBlockWindows: {
        ...(production.trendSymbolBlockWindows ?? {}),
        ETH: weakMarketWindows,
        INJ: weakMarketWindows,
      },
    }),
    await runVariant("eth_inj_weak_market_block_plus_sol_guard", "Weak ETH/INJ block plus SOL 12/8 guard.", {
      ...production,
      trendSymbolBlockWindows: {
        ...(production.trendSymbolBlockWindows ?? {}),
        ETH: weakMarketWindows,
        INJ: weakMarketWindows,
      },
      trendProfitTrailActivationPctBySymbol: { SOL: 0.12 },
      trendProfitTrailRetracePctBySymbol: { SOL: 0.08 },
    }),
    await runVariant("eth_inj_sol_weak_market_block", "Block ETH/INJ/SOL entries during weak-market windows to avoid bad SOL handoff.", {
      ...production,
      trendSymbolBlockWindows: {
        ...(production.trendSymbolBlockWindows ?? {}),
        ETH: weakMarketWindows,
        INJ: weakMarketWindows,
        SOL: weakMarketWindows,
      },
    }),
    await runVariant("core_trend_weak_market_block", "Block ETH/SOL/AVAX/INJ trend entries during weak-market windows, allowing cash/range only.", {
      ...production,
      trendSymbolBlockWindows: {
        ...(production.trendSymbolBlockWindows ?? {}),
        ETH: weakMarketWindows,
        SOL: weakMarketWindows,
        AVAX: weakMarketWindows,
        INJ: weakMarketWindows,
      },
    }),
    await runVariant("core_trend_weak_market_block_plus_sol_guard", "Core weak-market trend block plus SOL 12/8 guard outside weak windows.", {
      ...production,
      trendSymbolBlockWindows: {
        ...(production.trendSymbolBlockWindows ?? {}),
        ETH: weakMarketWindows,
        SOL: weakMarketWindows,
        AVAX: weakMarketWindows,
        INJ: weakMarketWindows,
      },
      trendProfitTrailActivationPctBySymbol: { SOL: 0.12 },
      trendProfitTrailRetracePctBySymbol: { SOL: 0.08 },
    }),
  ];

  const idleResults = [];
  for (const symbol of IDLE_CANDIDATES) {
    try {
      const options = addCashOnlySymbol(production, symbol, nonCashWindows);
      const result = await runHybridBacktest("RETQ22", {
        ...options,
        label: `idle_candidate_${symbol.toLowerCase()}`,
      });
      const summary = summarize(result);
      idleResults.push({
        symbol,
        summary,
        addedPnl: round((result.summary.symbol_contribution[symbol] ?? 0)),
        addedTrades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
      });
      console.log(`idle_${symbol}: end=${summary.endEquity} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} pnl=${idleResults.at(-1)?.addedPnl} trades=${idleResults.at(-1)?.addedTrades}`);
    } catch (error) {
      idleResults.push({
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`idle_${symbol}: skipped`);
    }
  }

  idleResults.sort((left, right) => {
    const leftEnd = "summary" in left ? left.summary.endEquity : -Infinity;
    const rightEnd = "summary" in right ? right.summary.endEquity : -Infinity;
    return rightEnd - leftEnd;
  });

  const baseline = variants[0].result;
  const avax = avaxDiagnostics(baseline);
  const rows = variants.map(({ key, memo, summary }) => ({ key, memo, ...summary }));
  const md = [
    "# Final Improvement Candidates",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- cash_only_windows: ${cashOnlyWindows.length}`,
    `- weak_market_windows: ${weakMarketWindows.length}`,
    "",
    "## Variant Comparison",
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | DD symbol | ETH | SOL | AVAX | INJ | PENGU | DOGE | UNI | TWT |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.ddSymbol} | ${row.ETH} | ${row.SOL} | ${row.AVAX} | ${row.INJ} | ${row.PENGU} | ${row.DOGE} | ${row.UNI} | ${row.TWT} |`),
    "",
    "## Idle Candidate Add-On Ranking",
    "",
    "| symbol | end equity | MaxDD % | PF | added pnl | added trades | error |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...idleResults.map((row) => {
      if (!("summary" in row)) return `| ${row.symbol} | - | - | - | - | - | ${row.error.replace(/\|/g, "/")} |`;
      return `| ${row.symbol} | ${row.summary.endEquity} | ${row.summary.maxDrawdownPct} | ${row.summary.profitFactor} | ${row.addedPnl} | ${row.addedTrades} | - |`;
    }),
    "",
    "## AVAX Diagnostics",
    "",
    `- total_pnl: ${avax.totalPnl}`,
    `- trades: ${avax.trades}`,
    `- wins/losses: ${avax.wins}/${avax.losses}`,
    "",
    "### Worst AVAX Trades",
    "",
    "| entry | exit | pnl | return % | hold bars | entry reason | exit reason |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
    ...avax.worstTrades.map((trade) => `| ${trade.entry} | ${trade.exit} | ${trade.pnl} | ${trade.returnPct} | ${trade.holdBars} | ${trade.entryReason} | ${trade.exitReason} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, `result${REPORT_SUFFIX}.json`), JSON.stringify({
    rows,
    idleResults,
    avax,
    windows: {
      cashOnlyWindows,
      weakMarketWindows,
    },
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, `result${REPORT_SUFFIX}.md`), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
