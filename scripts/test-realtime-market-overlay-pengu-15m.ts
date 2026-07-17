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

const REPORT_DIR = path.join(process.cwd(), "reports", "realtime-market-overlay-pengu-15m");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 23, 23, 59, 59, 999);
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

function withIdleBreakoutDisabled(base: HybridVariantOptions) {
  return {
    ...base,
    idleBreakoutEntryWhileCash: false,
    idleBreakoutSymbols: [],
  } satisfies HybridVariantOptions;
}

function withPenguLongHold(base: HybridVariantOptions) {
  return {
    ...withIdleBreakoutDisabled(base),
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
  } satisfies HybridVariantOptions;
}

function withPenguLongHoldEarlyTrail(base: HybridVariantOptions) {
  return {
    ...withPenguLongHold(base),
    idleBreakoutProfitTrailActivationPct: 0.06,
    idleBreakoutProfitTrailRetracePct: 0.03,
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol).length;
  const exitCount = (reason: string) => result.trade_pairs.filter((row) => row.exit_reason === reason).length;
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
    ethTrades: symbolTrades("ETH"),
    solTrades: symbolTrades("SOL"),
    avaxTrades: symbolTrades("AVAX"),
    injTrades: symbolTrades("INJ"),
    penguTrades: symbolTrades("PENGU"),
    dogeTrades: symbolTrades("DOGE"),
    uniTrades: symbolTrades("UNI"),
    twtTrades: symbolTrades("TWT"),
    strictTrailExits: exitCount("strict-extra-trailing"),
    trendTrailExits: exitCount("trend-profit-trailing"),
    idleBreakoutExits: exitCount("idle-breakout-trailing") + exitCount("idle-breakout-time"),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;

  const baselineSeed = withIdleBreakoutDisabled(base);
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", baselineSeed);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(baselineSeed, nonCashWindows);

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "baseline_current_exact",
      memo: "Historical production-equivalent baseline with idle-breakout disabled.",
      options: { ...production, label: "baseline_current_exact" },
    },
    {
      key: "baseline_plus_pengu_15m_long_hold",
      memo: "Same baseline plus cash-only PENGU 15m long_hold idle-breakout.",
      options: { ...withPenguLongHold(production), label: "baseline_plus_pengu_15m_long_hold" },
    },
    {
      key: "baseline_plus_pengu_15m_long_hold_early_trail",
      memo: "Same long_hold but tighten profit protection trail to 6% / 3.0%.",
      options: { ...withPenguLongHoldEarlyTrail(production), label: "baseline_plus_pengu_15m_long_hold_early_trail" },
    },
  ];
  const variantFilter = process.env.BT_VARIANTS
    ? new Set(process.env.BT_VARIANTS.split(",").map((item) => item.trim()).filter(Boolean))
    : null;
  const selectedVariants = variantFilter
    ? variants.filter((variant) => variantFilter.has(variant.key))
    : variants;

  const rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }> = [];
  for (const variant of selectedVariants) {
    console.log(`running ${variant.key}`);
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    rows.push({ key: variant.key, memo: variant.memo, summary: summarize(result) });
  }

  const baseline = rows[0]?.summary;
  const markdown = [
    "# Realtime Market Overlay + PENGU 15m Long Hold",
    "",
    "## Setup",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "- Method: exact historical realtime-market-overlay baseline construction, then add only PENGU 15m long_hold.",
    "",
    "## Summary",
    "",
    "| variant | end equity | delta | CAGR % | MaxDD % | PF | trades | exposure % | ETH | SOL | AVAX | INJ | PENGU | DOGE | UNI | TWT | PENGU trades | idle exits |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map(({ key, summary }) =>
      [
        key,
        summary.endEquity.toLocaleString(),
        round(summary.endEquity - (baseline?.endEquity ?? summary.endEquity)).toLocaleString(),
        summary.cagrPct,
        summary.maxDrawdownPct,
        summary.profitFactor,
        summary.trades,
        summary.exposurePct,
        summary.ethPnl.toLocaleString(),
        summary.solPnl.toLocaleString(),
        summary.avaxPnl.toLocaleString(),
        summary.injPnl.toLocaleString(),
        summary.penguPnl.toLocaleString(),
        summary.dogePnl.toLocaleString(),
        summary.uniPnl.toLocaleString(),
        summary.twtPnl.toLocaleString(),
        summary.penguTrades,
        summary.idleBreakoutExits,
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    ),
    "",
    "## Variant Meaning",
    "",
    ...rows.flatMap(({ key, memo }) => [`- ${key}: ${memo}`]),
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
