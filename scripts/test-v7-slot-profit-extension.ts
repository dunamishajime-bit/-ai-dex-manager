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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-slot-profit-extension");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2025, 6, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2025, 11, 31, 23, 59, 59, 999);
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

function withCashAltScanner(base: HybridVariantOptions, cashOnlyWindows: readonly Window[], timeframe: "1h" | "6h") {
  const isOneHour = timeframe === "1h";
  return {
    ...base,
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: timeframe,
    idleBreakoutSymbols: ["PENGU", "TWT", "UNI", "TRX", "CAKE", "DOGE"],
    idleBreakoutAllowedWindows: cashOnlyWindows,
    idleBreakoutAllowTradeGateOff: false,
    idleBreakoutBreakoutLookbackBars: isOneHour ? 12 : 8,
    idleBreakoutBreakoutMinPct: isOneHour ? 0.01 : 0.012,
    idleBreakoutMinVolumeRatio: isOneHour ? 1.08 : 1.01,
    idleBreakoutMinMomAccel: isOneHour ? 0.001 : 0.0005,
    idleBreakoutMinEfficiencyRatio: isOneHour ? 0.2 : 0.18,
    idleBreakoutProfitTrailActivationPct: isOneHour ? 0.1 : 0.16,
    idleBreakoutProfitTrailRetracePct: isOneHour ? 0.055 : 0.075,
    idleBreakoutMaxHoldBars: isOneHour ? 24 : 8,
  } satisfies HybridVariantOptions;
}

function withSolEscapeToQualityTrend(base: HybridVariantOptions) {
  return {
    ...base,
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["SOL"],
    trendRotationScoreGap: 7,
    trendRotationAlternateScoreGap: 4,
    trendRotationCurrentMomAccelMax: 0.03,
    trendRotationCurrentMom20Max: 0.18,
    trendRotationRequireConsecutiveBars: 1,
    trendRotationAlternateRequireConsecutiveBars: 1,
    trendRotationMinHoldBars: 1,
    trendRotationTargetBlockSymbols: ["INJ"],
    trendRotationTargetExceptionBySymbol: {
      ...(base.trendRotationTargetExceptionBySymbol ?? {}),
      INJ: {
        minScore: 32,
        minMom20: 0.18,
        minMomAccel: 0.03,
        minVolumeRatio: 1.4,
        minAdx14: 22,
        minEfficiencyRatio: 0.3,
        requireStructureBreak: true,
        requireDowHigherHighLow: false,
      },
    },
  } satisfies HybridVariantOptions;
}

function withSolProfitProtection(base: HybridVariantOptions, activationPct: number, retracePct: number) {
  return {
    ...base,
    trendProfitTrailActivationPctBySymbol: {
      ...(base.trendProfitTrailActivationPctBySymbol ?? {}),
      SOL: activationPct,
    },
    trendProfitTrailRetracePctBySymbol: {
      ...(base.trendProfitTrailRetracePctBySymbol ?? {}),
      SOL: retracePct,
    },
  } satisfies HybridVariantOptions;
}

function withTwtUniCashTrend(base: HybridVariantOptions, cashOnlyWindows: readonly Window[]) {
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
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

function withTwtUniCashTrendEntryOnly(base: HybridVariantOptions, cashOnlyWindows: readonly Window[]) {
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
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
    trendSymbolBlockWindows: {
      ...(base.trendSymbolBlockWindows ?? {}),
      UNI: nonCashWindows,
      TWT: nonCashWindows,
    },
  } satisfies HybridVariantOptions;
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
    avaxPnl: symbolPnl("AVAX"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    uniPnl: symbolPnl("UNI"),
    twtPnl: symbolPnl("TWT"),
    trxPnl: symbolPnl("TRX"),
    cakePnl: symbolPnl("CAKE"),
    solTrades: symbolTrades("SOL"),
    penguTrades: symbolTrades("PENGU"),
    dogeTrades: symbolTrades("DOGE"),
    twtTrades: symbolTrades("TWT"),
    uniTrades: symbolTrades("UNI"),
    trxTrades: symbolTrades("TRX"),
    cakeTrades: symbolTrades("CAKE"),
  };
}

function buildMarkdown(rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }>) {
  const baseline = rows[0]?.summary;
  return [
    "# V7 Slot Profit Extension",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", options)`",
    "",
    "| variant | end equity | delta | MaxDD % | PF | trades | SOL | PENGU | DOGE | TWT | UNI | TRX | CAKE | SOL trades | cash-alt trades |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(({ key, summary }) => [
      key,
      summary.endEquity.toLocaleString(),
      round(summary.endEquity - (baseline?.endEquity ?? summary.endEquity)).toLocaleString(),
      summary.maxDrawdownPct,
      summary.profitFactor,
      summary.trades,
      summary.solPnl.toLocaleString(),
      summary.penguPnl.toLocaleString(),
      summary.dogePnl.toLocaleString(),
      summary.twtPnl.toLocaleString(),
      summary.uniPnl.toLocaleString(),
      summary.trxPnl.toLocaleString(),
      summary.cakePnl.toLocaleString(),
      summary.solTrades,
      summary.twtTrades + summary.uniTrades + summary.trxTrades + summary.cakeTrades,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## Variant Meaning",
    "",
    ...rows.map(({ key, memo }) => `- ${key}: ${memo}`),
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
    "",
  ].join("\n");
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

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "v7_current",
      memo: "Current V7 profile.",
      options: { ...base, label: "v7_current" },
    },
    {
      key: "trend_profit_trail_22_12",
      memo: "Let normal trend positions breathe until +22%, then protect with 12% retrace.",
      options: { ...base, trendProfitTrailActivationPct: 0.22, trendProfitTrailRetracePct: 0.12, label: "trend_profit_trail_22_12" },
    },
    {
      key: "trend_profit_trail_28_14",
      memo: "More aggressive profit-extension: activate only after +28%, protect with 14% retrace.",
      options: { ...base, trendProfitTrailActivationPct: 0.28, trendProfitTrailRetracePct: 0.14, label: "trend_profit_trail_28_14" },
    },
    {
      key: "cash_alt_scanner_1h",
      memo: "USDT waiting-slot scanner on 1H for PENGU/TWT/UNI/TRX/CAKE/DOGE.",
      options: { ...withCashAltScanner(base, cashOnlyWindows, "1h"), label: "cash_alt_scanner_1h" },
    },
    {
      key: "cash_alt_scanner_6h",
      memo: "USDT waiting-slot scanner on 6H for PENGU/TWT/UNI/TRX/CAKE/DOGE.",
      options: { ...withCashAltScanner(base, cashOnlyWindows, "6h"), label: "cash_alt_scanner_6h" },
    },
    {
      key: "cash_twt_uni_trend",
      memo: "Allow TWT/UNI trend candidates only during V7 cash windows.",
      options: { ...withTwtUniCashTrend(base, cashOnlyWindows), label: "cash_twt_uni_trend" },
    },
    {
      key: "cash_twt_uni_entry_only",
      memo: "Pure cash-window TWT/UNI candidate add-on without changing the existing rotation thresholds.",
      options: { ...withTwtUniCashTrendEntryOnly(base, cashOnlyWindows), label: "cash_twt_uni_entry_only" },
    },
    {
      key: "sol_escape_quality_trend",
      memo: "When holding SOL, rotate faster only into stronger quality trend candidates.",
      options: { ...withSolEscapeToQualityTrend(base), label: "sol_escape_quality_trend" },
    },
    {
      key: "sol_profit_trail_12_8",
      memo: "Protect SOL position after +12% with 8% retrace.",
      options: { ...withSolProfitProtection(base, 0.12, 0.08), label: "sol_profit_trail_12_8" },
    },
    {
      key: "cash_1h_plus_sol_trail",
      memo: "Combine 1H USDT waiting scanner with SOL +12%/+8% profit protection.",
      options: { ...withSolProfitProtection(withCashAltScanner(base, cashOnlyWindows, "1h"), 0.12, 0.08), label: "cash_1h_plus_sol_trail" },
    },
    {
      key: "cash_twt_uni_plus_sol_escape",
      memo: "Combine cash-window TWT/UNI trend candidates with stricter SOL escape rotation.",
      options: { ...withSolEscapeToQualityTrend(withTwtUniCashTrend(base, cashOnlyWindows)), label: "cash_twt_uni_plus_sol_escape" },
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
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, summary });
    console.log(
      `${variant.key}: end=${summary.endEquity} dd=${summary.maxDrawdownPct} pf=${summary.profitFactor} trades=${summary.trades} SOL=${summary.solPnl} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} TWT=${summary.twtPnl} UNI=${summary.uniPnl} TRX=${summary.trxPnl} CAKE=${summary.cakePnl}`,
    );
    await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "summary.md"), buildMarkdown(rows), "utf8");
    await fs.writeFile(
      path.join(REPORT_DIR, `summary-${process.env.BT_START ?? "default"}-${process.env.BT_END ?? "default"}.md`),
      buildMarkdown(rows),
      "utf8",
    );
  }

  console.log(buildMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
