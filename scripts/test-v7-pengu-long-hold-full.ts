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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-long-hold-full");
const START_LABEL = process.env.BT_START ?? "2022-01-01";
const END_LABEL = process.env.BT_END ?? "2026-04-24";
const START_TS = Date.parse(`${START_LABEL}T00:00:00.000Z`);
const END_TS = Date.parse(`${END_LABEL}T23:59:59.999Z`);
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
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    avaxPnl: symbolPnl("AVAX"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    uniPnl: symbolPnl("UNI"),
    twtPnl: symbolPnl("TWT"),
    penguTrades: symbolTrades("PENGU"),
    dogeTrades: symbolTrades("DOGE"),
    uniTrades: symbolTrades("UNI"),
    twtTrades: symbolTrades("TWT"),
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

  const baseline = {
    ...production,
    idleBreakoutEntryWhileCash: false,
    idleBreakoutSymbols: undefined,
    label: "v7_baseline",
  } satisfies HybridVariantOptions;

  const candidate = {
    ...production,
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "15m",
    idleBreakoutSymbols: ["PENGU"],
    idleBreakoutAllowTradeGateOff: false,
    idleBreakoutMinVolumeRatio: 1.15,
    idleBreakoutMinMomAccel: 0.0015,
    idleBreakoutBreakoutLookbackBars: 16,
    idleBreakoutBreakoutMinPct: 0.006,
    idleBreakoutMinEfficiencyRatio: 0.18,
    idleBreakoutProfitTrailActivationPct: 0.12,
    idleBreakoutProfitTrailRetracePct: 0.055,
    idleBreakoutMaxHoldBars: 144,
    label: "v7_plus_pengu_long_hold",
  } satisfies HybridVariantOptions;

  const [baselineResult, candidateResult] = await Promise.all([
    runHybridBacktest("RETQ22", baseline),
    runHybridBacktest("RETQ22", candidate),
  ]);

  await writeBacktestArtifacts(baselineResult, path.join(REPORT_DIR, "baseline"));
  await writeBacktestArtifacts(candidateResult, path.join(REPORT_DIR, "candidate"));

  const summary = {
    start: START_LABEL,
    end: END_LABEL,
    baseline: summarize(baselineResult),
    candidate: summarize(candidateResult),
    deltaEndEquity: round(candidateResult.summary.end_equity - baselineResult.summary.end_equity),
    deltaPenguPnl: round((candidateResult.summary.symbol_contribution.PENGU ?? 0) - (baselineResult.summary.symbol_contribution.PENGU ?? 0)),
  };

  const markdown = [
    "# V7 + PENGU Long Hold Full Backtest",
    "",
    `- Start: ${START_LABEL}`,
    `- End: ${END_LABEL}`,
    "",
    "## Summary",
    "",
    "| variant | End Equity | CAGR % | MaxDD % | PF | Trades | ETH | SOL | AVAX | INJ | PENGU | DOGE | UNI | TWT | PENGU trades |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...[
      ["baseline", summary.baseline],
      ["candidate", summary.candidate],
    ].map(([label, s]) => [
      label,
      s.endEquity.toLocaleString(),
      s.cagrPct,
      s.maxDrawdownPct,
      s.profitFactor,
      s.trades,
      s.ethPnl.toLocaleString(),
      s.solPnl.toLocaleString(),
      s.avaxPnl.toLocaleString(),
      s.injPnl.toLocaleString(),
      s.penguPnl.toLocaleString(),
      s.dogePnl.toLocaleString(),
      s.uniPnl.toLocaleString(),
      s.twtPnl.toLocaleString(),
      s.penguTrades,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    `- End Equity delta: ${summary.deltaEndEquity.toLocaleString()}`,
    `- PENGU delta: ${summary.deltaPenguPnl.toLocaleString()}`,
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
