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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-trade-logic-improvements");
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

function withPenguSmaGuard(
  base: HybridVariantOptions,
  params: {
    minMom20: number;
    minMomAccel: number;
    maxCloseBelowSmaPct: number;
  },
) {
  return {
    ...base,
    idleBreakoutSmaBreakGuardSymbols: ["PENGU"],
    idleBreakoutSmaBreakGuardMinMom20: params.minMom20,
    idleBreakoutSmaBreakGuardMinMomAccel: params.minMomAccel,
    idleBreakoutSmaBreakGuardMaxCloseBelowSmaPct: params.maxCloseBelowSmaPct,
    idleBreakoutSmaBreakGuardMinHoldBars: 4,
  } satisfies HybridVariantOptions;
}

function withStrictWeakMarketBlock(base: HybridVariantOptions, bestMom20Below: number, btcAdxBelow: number) {
  return {
    ...base,
    trendWeakMarketBlockSymbols: ["ETH", "INJ", "SOL"],
    trendWeakMarketBlockRequireWeak2022: true,
    trendWeakMarketBlockBestMom20Below: bestMom20Below,
    trendWeakMarketBlockBtcAdxBelow: btcAdxBelow,
  } satisfies HybridVariantOptions;
}

function withEthStrictQuality(base: HybridVariantOptions) {
  return {
    ...base,
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      ETH: 0.01,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      ETH: 0.28,
    },
    trendScoreAdjustmentBySymbol: {
      ...(base.trendScoreAdjustmentBySymbol ?? {}),
      ETH: -2,
    },
  } satisfies HybridVariantOptions;
}

function withSolQualityGate(base: HybridVariantOptions) {
  return {
    ...base,
    trendScoreAdjustmentBySymbol: {
      ...(base.trendScoreAdjustmentBySymbol ?? {}),
      SOL: -12,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      SOL: 0.04,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      SOL: 0.35,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      SOL: 0.9,
    },
  } satisfies HybridVariantOptions;
}

function withInjRotationStrict(base: HybridVariantOptions) {
  return {
    ...base,
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      INJ: 0.04,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      INJ: 1.45,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      INJ: 0.03,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      INJ: 0.28,
    },
    trendRotationTargetExceptionBySymbol: {
      ...(base.trendRotationTargetExceptionBySymbol ?? {}),
      INJ: {
        minScore: 30,
        minMom20: 0.16,
        minMomAccel: 0.025,
        minVolumeRatio: 1.35,
        minAdx14: 22,
        minEfficiencyRatio: 0.28,
        requireStructureBreak: true,
        requireDowHigherHighLow: false,
      },
    },
  } satisfies HybridVariantOptions;
}

function withAvaxStrictQuality(base: HybridVariantOptions) {
  return {
    ...base,
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      AVAX: 0.015,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      AVAX: 0.28,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      AVAX: 1.1,
    },
  } satisfies HybridVariantOptions;
}

function withoutDoge(base: HybridVariantOptions) {
  return {
    ...base,
    strictExtraTrendSymbols: (base.strictExtraTrendSymbols ?? []).filter((symbol) => symbol !== "DOGE"),
    idleBreakoutSwitchGuardTargetSymbols: (base.idleBreakoutSwitchGuardTargetSymbols ?? []).filter((symbol) => symbol !== "DOGE"),
  } satisfies HybridVariantOptions;
}

function withDogeStrictQuality(base: HybridVariantOptions) {
  return {
    ...base,
    strictExtraTrendMinEfficiencyRatioBySymbol: {
      ...(base.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
      DOGE: 0.28,
    },
    strictExtraTrendTrailActivationPctBySymbol: {
      ...(base.strictExtraTrendTrailActivationPctBySymbol ?? {}),
      DOGE: 0.14,
    },
    strictExtraTrendTrailRetracePctBySymbol: {
      ...(base.strictExtraTrendTrailRetracePctBySymbol ?? {}),
      DOGE: 0.06,
    },
  } satisfies HybridVariantOptions;
}

function withPenguTieredTrail(base: HybridVariantOptions) {
  return {
    ...base,
    idleBreakoutTieredTrailBySymbol: {
      ...(base.idleBreakoutTieredTrailBySymbol ?? {}),
      PENGU: [
        { activationPct: 0.06, retracePct: 0.03 },
        { activationPct: 0.15, retracePct: 0.05 },
        { activationPct: 0.3, retracePct: 0.08 },
      ],
    },
  } satisfies HybridVariantOptions;
}

function withPenguStrongMaxHold(base: HybridVariantOptions, maxHoldBars: number) {
  return {
    ...base,
    idleBreakoutStrongMaxHoldBarsBySymbol: {
      ...(base.idleBreakoutStrongMaxHoldBarsBySymbol ?? {}),
      PENGU: maxHoldBars,
    },
    idleBreakoutStrongMaxHoldMinMom20: 0.12,
    idleBreakoutStrongMaxHoldMinMomAccel: 0,
  } satisfies HybridVariantOptions;
}

function withAllCoreQuality(base: HybridVariantOptions) {
  return withDogeStrictQuality(
    withAvaxStrictQuality(
      withInjRotationStrict(
        withSolQualityGate(
          withEthStrictQuality(base),
        ),
      ),
    ),
  );
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol).length;
  const exitCount = (symbol: string, reason: string) =>
    result.trade_pairs.filter((row) => row.symbol === symbol && row.exit_reason === reason).length;
  const wins = (symbol: string) =>
    result.trade_pairs.filter((row) => row.symbol === symbol && row.net_pnl > 0).length;
  const losses = (symbol: string) =>
    result.trade_pairs.filter((row) => row.symbol === symbol && row.net_pnl <= 0).length;

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
    injTrades: symbolTrades("INJ"),
    penguTrades: symbolTrades("PENGU"),
    penguWins: wins("PENGU"),
    penguLosses: losses("PENGU"),
    dogeTrades: symbolTrades("DOGE"),
    dogeWins: wins("DOGE"),
    dogeLosses: losses("DOGE"),
    penguSmaBreakExits: exitCount("PENGU", "sma-break"),
    penguTrailExits: exitCount("PENGU", "idle-breakout-trailing"),
    penguWeakExits: exitCount("PENGU", "idle-breakout-weak-exit"),
    penguTimeExits: exitCount("PENGU", "idle-breakout-time"),
    ethRiskOffExits: exitCount("ETH", "risk-off"),
    ethSmaBreakExits: exitCount("ETH", "sma-break"),
    injWeakExits: exitCount("INJ", "symbol-weak-exit"),
  };
}

function buildMarkdown(rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }>) {
  const baseline = rows[0]?.summary;
  return [
    "# V7 Trade Logic Improvements",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", options)`",
    "",
    "| variant | end equity | delta | MaxDD % | PF | trades | ETH | INJ | PENGU | DOGE | PENGU trades | PENGU W/L | PENGU sma | PENGU trail | DOGE trades | DOGE W/L | ETH risk-off | ETH sma | INJ weak |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(({ key, summary }) => [
      key,
      summary.endEquity.toLocaleString(),
      round(summary.endEquity - (baseline?.endEquity ?? summary.endEquity)).toLocaleString(),
      summary.maxDrawdownPct,
      summary.profitFactor,
      summary.trades,
      summary.ethPnl.toLocaleString(),
      summary.injPnl.toLocaleString(),
      summary.penguPnl.toLocaleString(),
      summary.dogePnl.toLocaleString(),
      summary.penguTrades,
      `${summary.penguWins}/${summary.penguLosses}`,
      summary.penguSmaBreakExits,
      summary.penguTrailExits,
      summary.dogeTrades,
      `${summary.dogeWins}/${summary.dogeLosses}`,
      summary.ethRiskOffExits,
      summary.ethSmaBreakExits,
      summary.injWeakExits,
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
  const production = process.env.SKIP_CASH_WINDOWS === "1"
    ? base
    : (() => {
        throw new Error("Set SKIP_CASH_WINDOWS=1 for this exploratory comparison.");
      })();

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "v7_current",
      memo: "Current V7 profile with PENGU switch guard and weak exit.",
      options: { ...production, label: "v7_current" },
    },
    {
      key: "pengu_sma_guard_soft",
      memo: "Hold PENGU through shallow SMA45 breaks while mom20>=0.08 and accel>=-0.005.",
      options: { ...withPenguSmaGuard(production, { minMom20: 0.08, minMomAccel: -0.005, maxCloseBelowSmaPct: 0.02 }), label: "pengu_sma_guard_soft" },
    },
    {
      key: "pengu_sma_guard_strong",
      memo: "Hold PENGU through SMA45 breaks only while mom20>=0.12 and accel>=0.",
      options: { ...withPenguSmaGuard(production, { minMom20: 0.12, minMomAccel: 0, maxCloseBelowSmaPct: 0.03 }), label: "pengu_sma_guard_strong" },
    },
    {
      key: "pengu_sma_guard_loose",
      memo: "Aggressive PENGU hold-through test: mom20>=0.05, accel>=-0.015, close within 5% below SMA45.",
      options: { ...withPenguSmaGuard(production, { minMom20: 0.05, minMomAccel: -0.015, maxCloseBelowSmaPct: 0.05 }), label: "pengu_sma_guard_loose" },
    },
    {
      key: "eth_inj_sol_weak_block_10_20",
      memo: "Stricter weak-market entry block for ETH/INJ/SOL: bestMom20<0.10 and BTC ADX<20.",
      options: { ...withStrictWeakMarketBlock(production, 0.10, 20), label: "eth_inj_sol_weak_block_10_20" },
    },
    {
      key: "eth_strict_quality",
      memo: "Require stronger ETH acceleration/efficiency and apply a small ETH score penalty.",
      options: { ...withEthStrictQuality(production), label: "eth_strict_quality" },
    },
    {
      key: "sol_quality_gate",
      memo: "Reduce poor SOL selections by requiring stronger SOL acceleration/efficiency/volume and extra score penalty.",
      options: { ...withSolQualityGate(production), label: "sol_quality_gate" },
    },
    {
      key: "inj_rotation_strict",
      memo: "Make INJ rotation entries more selective with stronger breakout, volume, acceleration, ADX, and efficiency.",
      options: { ...withInjRotationStrict(production), label: "inj_rotation_strict" },
    },
    {
      key: "avax_strict_quality",
      memo: "Require stronger AVAX acceleration, volume, and efficiency.",
      options: { ...withAvaxStrictQuality(production), label: "avax_strict_quality" },
    },
    {
      key: "eth_inj_sol_weak_block_12_20",
      memo: "Stricter weak-market entry block for ETH/INJ/SOL: bestMom20<0.12 and BTC ADX<20.",
      options: { ...withStrictWeakMarketBlock(production, 0.12, 20), label: "eth_inj_sol_weak_block_12_20" },
    },
    {
      key: "doge_off",
      memo: "Remove DOGE from strict-extra trend candidates.",
      options: { ...withoutDoge(production), label: "doge_off" },
    },
    {
      key: "doge_strict_quality",
      memo: "Keep DOGE but require higher efficiency and use 14%/6% symbol trail.",
      options: { ...withDogeStrictQuality(production), label: "doge_strict_quality" },
    },
    {
      key: "pengu_tiered_trail",
      memo: "PENGU idle-breakout tiered trail: 6%/3%, 15%/5%, 30%/8%.",
      options: { ...withPenguTieredTrail(production), label: "pengu_tiered_trail" },
    },
    {
      key: "pengu_strong_maxhold_192",
      memo: "Extend PENGU idle-breakout maxHold to 192 bars while mom20>=0.12 and accel>=0.",
      options: { ...withPenguStrongMaxHold(production, 192), label: "pengu_strong_maxhold_192" },
    },
    {
      key: "pengu_strong_maxhold_240",
      memo: "Extend PENGU idle-breakout maxHold to 240 bars while mom20>=0.12 and accel>=0.",
      options: { ...withPenguStrongMaxHold(production, 240), label: "pengu_strong_maxhold_240" },
    },
    {
      key: "pengu_tiered_trail_maxhold_192",
      memo: "Combine PENGU tiered trail with strong-state maxHold 192.",
      options: { ...withPenguStrongMaxHold(withPenguTieredTrail(production), 192), label: "pengu_tiered_trail_maxhold_192" },
    },
    {
      key: "pengu_tiered_trail_doge_strict",
      memo: "Combine PENGU tiered trail with deployed DOGE strict quality.",
      options: { ...withDogeStrictQuality(withPenguTieredTrail(production)), label: "pengu_tiered_trail_doge_strict" },
    },
    {
      key: "combined_pengustrong_weakblock_dogeoff",
      memo: "Combine PENGU strong SMA guard, stricter ETH/INJ/SOL weak block, and DOGE off.",
      options: {
        ...withoutDoge(withStrictWeakMarketBlock(withPenguSmaGuard(production, { minMom20: 0.12, minMomAccel: 0, maxCloseBelowSmaPct: 0.03 }), 0.10, 20)),
        label: "combined_pengustrong_weakblock_dogeoff",
      },
    },
    {
      key: "all_core_quality",
      memo: "Combine ETH, SOL, INJ, AVAX, and DOGE quality filters while keeping PENGU logic unchanged.",
      options: { ...withAllCoreQuality(production), label: "all_core_quality" },
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
      `${variant.key}: end=${summary.endEquity} dd=${summary.maxDrawdownPct} pf=${summary.profitFactor} trades=${summary.trades} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} ETH=${summary.ethPnl} INJ=${summary.injPnl}`,
    );
    await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "summary.md"), buildMarkdown(rows), "utf8");
  }

  console.log(buildMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
