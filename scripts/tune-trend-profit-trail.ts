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

const REPORT_DIR = path.join(process.cwd(), "reports", "trend-profit-trail-tuning");
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
    trendTrailPnl: round(trendTrailExits.reduce((sum, row) => sum + row.net_pnl, 0)),
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    twtPnl: symbolPnl("TWT"),
    ethTrades: symbolTrades("ETH"),
    solTrades: symbolTrades("SOL"),
    injTrades: symbolTrades("INJ"),
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

  const trailPairs = [
    null,
    { activation: 0.18, retrace: 0.08 },
    { activation: 0.18, retrace: 0.10 },
    { activation: 0.18, retrace: 0.12 },
    { activation: 0.20, retrace: 0.08 },
    { activation: 0.20, retrace: 0.10 },
    { activation: 0.20, retrace: 0.12 },
    { activation: 0.22, retrace: 0.10 },
    { activation: 0.22, retrace: 0.12 },
    { activation: 0.22, retrace: 0.14 },
    { activation: 0.25, retrace: 0.10 },
    { activation: 0.25, retrace: 0.12 },
    { activation: 0.25, retrace: 0.14 },
    { activation: 0.28, retrace: 0.12 },
  ];

  const variants = trailPairs.map((trail) => {
    if (!trail) {
      return {
        key: "production_bigmove_c_mid",
        memo: "Current deployed bigmove_c_mid baseline without broad trend profit trailing.",
        options: { ...production, label: "production_bigmove_c_mid" },
      };
    }
    const key = `trail_${Math.round(trail.activation * 100)}_${Math.round(trail.retrace * 100)}`;
    return {
      key,
      memo: `Normal trend profit trail activation=${trail.activation}, retrace=${trail.retrace}.`,
      options: {
        ...production,
        trendProfitTrailActivationPct: trail.activation,
        trendProfitTrailRetracePct: trail.retrace,
        label: key,
      } satisfies HybridVariantOptions,
    };
  });

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    console.log(
      `${variant.key}: end=${summary.endEquity} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} exits=${summary.trendTrailExits} trailPnl=${summary.trendTrailPnl} ETH=${summary.ethPnl} SOL=${summary.solPnl} INJ=${summary.injPnl} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} TWT=${summary.twtPnl}`,
    );
  }

  const md = [
    "# Trend Profit Trail Tuning",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | trail exits | trail pnl | ETH | SOL | INJ | PENGU | DOGE | TWT |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.trendTrailExits} | ${row.trendTrailPnl} | ${row.ethPnl} | ${row.solPnl} | ${row.injPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.twtPnl} |`),
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
