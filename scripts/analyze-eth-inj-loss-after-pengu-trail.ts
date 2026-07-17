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

const REPORT_DIR = path.join(process.cwd(), "reports", "eth-inj-loss-after-pengu-trail");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;
const TARGET_SYMBOLS = ["ETH", "INJ"] as const;

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

function legacyPenguExitOptions(options: HybridVariantOptions) {
  return {
    ...options,
    strictExtraTrendTrailActivationPctBySymbol: undefined,
    strictExtraTrendTrailRetracePctBySymbol: undefined,
    label: "legacy_before_pengu_symbol_trail",
  } satisfies HybridVariantOptions;
}

function summarizeSymbol(result: Awaited<ReturnType<typeof runHybridBacktest>>, symbol: string) {
  const trades = result.trade_pairs.filter((row) => row.symbol === symbol);
  const wins = trades.filter((row) => row.net_pnl > 0);
  const losses = trades.filter((row) => row.net_pnl <= 0);
  const byExitReason = Object.fromEntries(
    [...new Set(trades.map((row) => row.exit_reason))]
      .map((reason) => [
        reason,
        {
          count: trades.filter((row) => row.exit_reason === reason).length,
          pnl: round(trades.filter((row) => row.exit_reason === reason).reduce((sum, row) => sum + row.net_pnl, 0)),
        },
      ]),
  );
  const byEntryReasonPrefix = Object.fromEntries(
    [...new Set(trades.map((row) => String(row.entry_reason || "").split("|")[0]))]
      .map((reason) => [
        reason,
        {
          count: trades.filter((row) => String(row.entry_reason || "").startsWith(reason)).length,
          pnl: round(trades.filter((row) => String(row.entry_reason || "").startsWith(reason)).reduce((sum, row) => sum + row.net_pnl, 0)),
        },
      ]),
  );

  return {
    symbol,
    pnl: round(result.summary.symbol_contribution[symbol] ?? 0),
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: trades.length ? round((wins.length / trades.length) * 100) : 0,
    avgHoldBars: trades.length ? round(trades.reduce((sum, row) => sum + row.holding_bars, 0) / trades.length, 2) : 0,
    byExitReason,
    byEntryReasonPrefix,
    worstTrades: [...trades].sort((left, right) => left.net_pnl - right.net_pnl).slice(0, 8).map((row) => ({
      entry: row.entry_time,
      exit: row.exit_time,
      pnl: round(row.net_pnl),
      hold: row.holding_bars,
      entryReason: row.entry_reason,
      exitReason: row.exit_reason,
    })),
    bestTrades: [...trades].sort((left, right) => right.net_pnl - left.net_pnl).slice(0, 5).map((row) => ({
      entry: row.entry_time,
      exit: row.exit_time,
      pnl: round(row.net_pnl),
      hold: row.holding_bars,
      entryReason: row.entry_reason,
      exitReason: row.exit_reason,
    })),
  };
}

function summarizeOverall(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    tradeCount: result.summary.trade_count,
    bySymbol: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution).map(([symbol, value]) => [symbol, round(Number(value))]),
    ),
    symbols: Object.fromEntries(TARGET_SYMBOLS.map((symbol) => [symbol, summarizeSymbol(result, symbol)])),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(base, nonCashWindows);

  const variants = [
    {
      key: "current_deployed",
      thesis: "Current deployed logic with PENGU 12%/5.5% symbol-specific trail.",
      result: await runHybridBacktest("RETQ22", { ...production, label: "current_deployed" }),
    },
    {
      key: "before_pengu_symbol_trail",
      thesis: "Same production-emulated logic, but PENGU symbol-specific trail removed.",
      result: await runHybridBacktest("RETQ22", legacyPenguExitOptions(production)),
    },
  ];

  const rows = variants.map((variant) => ({
    key: variant.key,
    thesis: variant.thesis,
    ...summarizeOverall(variant.result),
  }));

  const md = [
    "# ETH / INJ Loss Analysis After PENGU Trail",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "| variant | end equity | MaxDD % | PF | trades | ETH pnl | ETH trades | INJ pnl | INJ trades |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => {
      const eth = row.symbols.ETH;
      const inj = row.symbols.INJ;
      return `| ${row.key} | ${row.endEquity} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${eth.pnl} | ${eth.trades} | ${inj.pnl} | ${inj.trades} |`;
    }),
    "",
    "## Details",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(rows.map((row) => ({
    key: row.key,
    endEquity: row.endEquity,
    maxDrawdownPct: row.maxDrawdownPct,
    profitFactor: row.profitFactor,
    ETH: row.symbols.ETH,
    INJ: row.symbols.INJ,
  })), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
