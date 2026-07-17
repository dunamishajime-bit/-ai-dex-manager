import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-sol-q4-rotation-engine-direct");
const START_TS = Number(process.env.BT_START_TS ?? Date.UTC(2022, 0, 1));
const END_TS = Number(process.env.BT_END_TS ?? Date.UTC(2026, 3, 29, 23, 59, 59, 999));

type Variant = {
  key: string;
  options: HybridVariantOptions;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function yearWindow(year: number, startMonth: number, endMonth: number) {
  return {
    startTs: Date.UTC(year, startMonth, 1),
    endTs: Date.UTC(year, endMonth + 1, 1),
  };
}

function recurringNovDecWindows() {
  return [2022, 2023, 2024, 2025, 2026].map((year) => yearWindow(year, 10, 11));
}

function q4Windows() {
  return [2022, 2023, 2024, 2025, 2026].map((year) => yearWindow(year, 9, 11));
}

function baseOptions(label: string): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    solWaveOverrideEntry: false,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label,
  };
}

function solWaveOptions(label: string, windows: readonly { startTs: number; endTs: number }[], extra: HybridVariantOptions = {}): HybridVariantOptions {
  const base = baseOptions(label);
  return {
    ...base,
    solWaveOverrideEntry: true,
    solWaveOverrideTimeframe: "1h",
    solWaveOverrideCurrentSymbols: extra.solWaveOverrideCurrentSymbols ?? ["ETH", "AVAX", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"],
    solWaveOverrideScoreGap: extra.solWaveOverrideScoreGap ?? 0,
    solWaveOverrideMinHoldBars: extra.solWaveOverrideMinHoldBars ?? 2,
    solWaveOverrideAllowTradeGateOff: extra.solWaveOverrideAllowTradeGateOff ?? true,
    solWaveOverrideAllowedWindows: windows,
    solWaveOverrideBreakoutLookbackBars: extra.solWaveOverrideBreakoutLookbackBars ?? 16,
    solWaveOverrideBreakoutMinPct: extra.solWaveOverrideBreakoutMinPct ?? 0.006,
    solWaveOverrideMinVolumeRatio: extra.solWaveOverrideMinVolumeRatio ?? 1.25,
    solWaveOverrideMinMomAccel: extra.solWaveOverrideMinMomAccel ?? 0,
    solWaveOverrideMinEfficiencyRatio: extra.solWaveOverrideMinEfficiencyRatio ?? 0.12,
    trendProfitTrailActivationPctBySymbol: {
      ...(base.trendProfitTrailActivationPctBySymbol ?? {}),
      ...(extra.trendProfitTrailActivationPctBySymbol ?? {}),
      SOL: extra.trendProfitTrailActivationPctBySymbol?.SOL ?? 0.34,
    },
    trendProfitTrailRetracePctBySymbol: {
      ...(base.trendProfitTrailRetracePctBySymbol ?? {}),
      ...(extra.trendProfitTrailRetracePctBySymbol ?? {}),
      SOL: extra.trendProfitTrailRetracePctBySymbol?.SOL ?? 0.12,
    },
    ...extra,
  };
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const solTrades = result.trade_pairs.filter((trade) => trade.symbol === "SOL");
  const switchTrades = result.trade_pairs.filter((trade) => trade.entry_reason.includes("sol-wave-override"));
  return {
    endEquity: round(result.summary.end_equity),
    maxDd: round(result.summary.max_drawdown_pct),
    pf: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    solPnl: round(Number(result.summary.symbol_contribution.SOL ?? 0)),
    solTrades: solTrades.length,
    rotationTrades: switchTrades.length,
    rotationPnl: round(switchTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
  };
}

function markdown(rows: Array<{ key: string; summary: ReturnType<typeof summarize>; diff: number }>) {
  return [
    "# SOL Q4 Rotation Engine-Direct",
    "",
    "- method: V7 engine-direct, actual position switch through dedicated solWaveOverride mechanism",
    `- period: ${new Date(START_TS).toISOString()} to ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | End Equity | diff | MaxDD | PF | Trades | SOL PnL | SOL trades | rotation trades | rotation PnL |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(({ key, summary, diff }) => `| ${key} | ${summary.endEquity.toLocaleString()} | ${round(diff).toLocaleString()} | ${summary.maxDd}% | ${summary.pf} | ${summary.trades} | ${summary.solPnl.toLocaleString()} | ${summary.solTrades} | ${summary.rotationTrades} | ${summary.rotationPnl.toLocaleString()} |`),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const variants: Variant[] = [
    { key: "baseline", options: baseOptions("baseline") },
    { key: "sol_nov_dec_wave_gap0", options: solWaveOptions("sol_nov_dec_wave_gap0", recurringNovDecWindows()) },
    { key: "sol_nov_dec_wave_gap10", options: solWaveOptions("sol_nov_dec_wave_gap10", recurringNovDecWindows(), { solWaveOverrideScoreGap: 10 }) },
    { key: "sol_q4_wave_gap0", options: solWaveOptions("sol_q4_wave_gap0", q4Windows()) },
    { key: "sol_q4_wave_gap10", options: solWaveOptions("sol_q4_wave_gap10", q4Windows(), { solWaveOverrideScoreGap: 10 }) },
    { key: "sol_nov_dec_wave_from_uni_only", options: solWaveOptions("sol_nov_dec_wave_from_uni_only", recurringNovDecWindows(), { solWaveOverrideCurrentSymbols: ["UNI"] }) },
    { key: "sol_q4_wave_from_uni_only", options: solWaveOptions("sol_q4_wave_from_uni_only", q4Windows(), { solWaveOverrideCurrentSymbols: ["UNI"] }) },
    { key: "sol_nov_dec_wave_loose_vol", options: solWaveOptions("sol_nov_dec_wave_loose_vol", recurringNovDecWindows(), { solWaveOverrideMinVolumeRatio: 1.05, solWaveOverrideMinEfficiencyRatio: 0.08 }) },
    { key: "sol_q4_wave_loose_vol", options: solWaveOptions("sol_q4_wave_loose_vol", q4Windows(), { solWaveOverrideMinVolumeRatio: 1.05, solWaveOverrideMinEfficiencyRatio: 0.08 }) },
  ];
  const onlyVariants = (process.env.ONLY_VARIANTS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const targetVariants = onlyVariants.length
    ? variants.filter((variant) => variant.key === "baseline" || onlyVariants.includes(variant.key))
    : variants;
  const runVariants = process.env.INCLUDE_BASELINE === "0"
    ? targetVariants.filter((variant) => variant.key !== "baseline")
    : targetVariants;

  const results = [];
  for (const variant of runVariants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await fs.writeFile(path.join(REPORT_DIR, `${variant.key}-trades.json`), JSON.stringify(result.trade_pairs, null, 2), "utf8");
    results.push({ key: variant.key, result, summary: summarize(result) });
  }

  const baseEnd = results[0]?.summary.endEquity ?? 0;
  const rows = results.map((row) => ({
    key: row.key,
    summary: row.summary,
    diff: row.summary.endEquity - baseEnd,
  }));
  const md = markdown(rows);
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
