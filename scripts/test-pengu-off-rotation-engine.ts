import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import type { HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-off-rotation-engine");
const START_TS = process.env.START ? Date.parse(process.env.START) : Date.UTC(2022, 0, 1);
const END_TS = process.env.END ? Date.parse(process.env.END) : Date.UTC(2026, 4, 5, 23, 59, 59, 999);
const ROTATION_SYMBOLS = ["BANK", "ALLO", "UNI", "DEXE"] as const;
const REPLACE_SYMBOLS = ["ETH", "SOL", "AVAX", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function maxDrawdownPct(equity: { equity: number }[]) {
  let peak = equity[0]?.equity ?? 0;
  let maxDd = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDd = Math.min(maxDd, point.equity / peak - 1);
  }
  return maxDd * 100;
}

function profitFactor(trades: { net_pnl: number }[]) {
  const win = trades.filter((trade) => trade.net_pnl > 0).reduce((sum, trade) => sum + trade.net_pnl, 0);
  const loss = Math.abs(trades.filter((trade) => trade.net_pnl <= 0).reduce((sum, trade) => sum + trade.net_pnl, 0));
  return loss > 0 ? win / loss : win > 0 ? 999 : 0;
}

function symbolPnl(trades: { symbol: string; net_pnl: number }[]) {
  const rows = new Map<string, { symbol: string; trades: number; pnl: number }>();
  for (const trade of trades) {
    const row = rows.get(trade.symbol) ?? { symbol: trade.symbol, trades: 0, pnl: 0 };
    row.trades += 1;
    row.pnl += trade.net_pnl;
    rows.set(trade.symbol, row);
  }
  return [...rows.values()]
    .sort((left, right) => right.pnl - left.pnl)
    .map((row) => ({ ...row, pnl: round(row.pnl, 2) }));
}

function rotationBaseOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  return {
    ...base,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    strictExtraTrendSymbols: [...new Set([...(base.strictExtraTrendSymbols ?? []), ...ROTATION_SYMBOLS])],
    strictExtraTrendDecisionTimeframe: "1h",
    strictExtraTrendExitCheckTimeframe: "1h",
    strictExtraTrendTrailActivationPctBySymbol: {
      ...(base.strictExtraTrendTrailActivationPctBySymbol ?? {}),
      BANK: 0.18,
      ALLO: 0.18,
      UNI: 0.18,
      DEXE: 0.18,
    },
    strictExtraTrendTrailRetracePctBySymbol: {
      ...(base.strictExtraTrendTrailRetracePctBySymbol ?? {}),
      BANK: 0.085,
      ALLO: 0.085,
      UNI: 0.085,
      DEXE: 0.085,
    },
    strictExtraTrendHardStopLossPctBySymbol: {
      ...(base.strictExtraTrendHardStopLossPctBySymbol ?? {}),
      BANK: 0.08,
      ALLO: 0.08,
      UNI: 0.08,
      DEXE: 0.08,
    },
    strictExtraTrendMaxHoldBarsBySymbol: {
      ...(base.strictExtraTrendMaxHoldBarsBySymbol ?? {}),
      BANK: 48,
      ALLO: 48,
      UNI: 48,
      DEXE: 48,
    },
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      BANK: 8,
      ALLO: 8,
      UNI: 8,
      DEXE: 16,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      BANK: 0.016,
      ALLO: 0.016,
      UNI: 0.016,
      DEXE: 0.028,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      BANK: 1.15,
      ALLO: 1.15,
      UNI: 1.1,
      DEXE: 1.45,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      BANK: 0.001,
      ALLO: 0.001,
      UNI: 0.0005,
      DEXE: 0.004,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      BANK: 0.18,
      ALLO: 0.18,
      UNI: 0.16,
      DEXE: 0.28,
    },
    penguOffRotationEntry: true,
    penguOffRotationTimeframe: "1h",
    penguOffRotationSymbols: ROTATION_SYMBOLS,
    penguOffRotationCurrentSymbols: REPLACE_SYMBOLS,
    penguOffRotationAllowFromCash: true,
    penguOffRotationAllowWhileHolding: true,
    penguOffRotationAllowTradeGateOff: true,
    penguOffRotationScoreGap: 0,
    penguOffRotationMinHoldBars: 2,
    penguOffRotationMaxNotionalUsdBySymbol: {
      BANK: 300,
      ALLO: 300,
      UNI: 1000,
      DEXE: 2500,
    },
    ...extra,
  };
}

function rotationPreservePenguOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  return {
    ...base,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    trendProfitTrailActivationPctBySymbol: {
      ...(base.trendProfitTrailActivationPctBySymbol ?? {}),
      BANK: 0.18,
      ALLO: 0.18,
      UNI: 0.18,
      DEXE: 0.18,
    },
    trendProfitTrailRetracePctBySymbol: {
      ...(base.trendProfitTrailRetracePctBySymbol ?? {}),
      BANK: 0.085,
      ALLO: 0.085,
      UNI: 0.085,
      DEXE: 0.085,
    },
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      BANK: 8,
      ALLO: 8,
      UNI: 8,
      DEXE: 16,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      BANK: 0.016,
      ALLO: 0.016,
      UNI: 0.016,
      DEXE: 0.028,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      BANK: 1.15,
      ALLO: 1.15,
      UNI: 1.1,
      DEXE: 1.45,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      BANK: 0.001,
      ALLO: 0.001,
      UNI: 0.0005,
      DEXE: 0.004,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      BANK: 0.18,
      ALLO: 0.18,
      UNI: 0.16,
      DEXE: 0.28,
    },
    penguOffRotationEntry: true,
    penguOffRotationTimeframe: "1h",
    penguOffRotationSymbols: ROTATION_SYMBOLS,
    penguOffRotationCurrentSymbols: REPLACE_SYMBOLS,
    penguOffRotationAllowFromCash: false,
    penguOffRotationAllowWhileHolding: true,
    penguOffRotationAllowTradeGateOff: true,
    penguOffRotationScoreGap: 5,
    penguOffRotationMinHoldBars: 2,
    ...extra,
  };
}

async function runCase(label: string, options: HybridVariantOptions) {
  const result = await runHybridBacktest("RETQ22", { ...options, label });
  const endEquity = result.equity_curve.at(-1)?.equity ?? 0;
  const rotationTrades = result.trade_pairs.filter((trade) => trade.sub_variant === "pengu-off-rotation");
  return {
    label,
    endEquity,
    maxDrawdownPct: maxDrawdownPct(result.equity_curve),
    profitFactor: profitFactor(result.trade_pairs),
    trades: result.trade_pairs.length,
    rotationTrades: rotationTrades.length,
    rotationPnl: rotationTrades.reduce((sum, trade) => sum + trade.net_pnl, 0),
    symbolPnl: symbolPnl(result.trade_pairs),
    rotationSymbolPnl: symbolPnl(rotationTrades),
    topRotationTrades: rotationTrades
      .sort((left, right) => right.net_pnl - left.net_pnl)
      .slice(0, 8)
      .map((trade) => ({
        symbol: trade.symbol,
        entry: trade.entry_time,
        exit: trade.exit_time,
        pnl: round(trade.net_pnl, 2),
        exitReason: trade.exit_reason,
      })),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  const cases: [string, HybridVariantOptions][] = [
    ["current_v7", { ...base, backtestStartTs: START_TS, backtestEndTs: END_TS, penguOffRotationEntry: false }],
    ["implemented_profile", { ...base, backtestStartTs: START_TS, backtestEndTs: END_TS }],
    ["rotation_dexe_strict_gap0", rotationBaseOptions()],
    ["rotation_dexe_strict_gap5", rotationBaseOptions({ penguOffRotationScoreGap: 5 })],
    ["rotation_dexe_extra_strict_gap0", rotationBaseOptions({
      trendBreakoutMinPctBySymbol: {
        ...(rotationBaseOptions().trendBreakoutMinPctBySymbol ?? {}),
        DEXE: 0.036,
      },
      trendMinVolumeRatioBySymbol: {
        ...(rotationBaseOptions().trendMinVolumeRatioBySymbol ?? {}),
        DEXE: 1.75,
      },
      trendMinMomAccelBySymbol: {
        ...(rotationBaseOptions().trendMinMomAccelBySymbol ?? {}),
        DEXE: 0.007,
      },
      trendMinEfficiencyRatioBySymbol: {
        ...(rotationBaseOptions().trendMinEfficiencyRatioBySymbol ?? {}),
        DEXE: 0.34,
      },
    })],
    ["rotation_bank_allo_only", rotationBaseOptions({
      strictExtraTrendSymbols: [...new Set([...(base.strictExtraTrendSymbols ?? []), "BANK", "ALLO"])],
      penguOffRotationSymbols: ["BANK", "ALLO"],
    })],
    ["rotation_cap1000_5000", rotationBaseOptions({
      penguOffRotationMaxNotionalUsdBySymbol: {
        BANK: 1000,
        ALLO: 1000,
        UNI: 2500,
        DEXE: 5000,
      },
    })],
    ["rotation_bank_allo_cap1000", rotationBaseOptions({
      strictExtraTrendSymbols: [...new Set([...(base.strictExtraTrendSymbols ?? []), "BANK", "ALLO"])],
      penguOffRotationSymbols: ["BANK", "ALLO"],
      penguOffRotationMaxNotionalUsdBySymbol: {
        BANK: 1000,
        ALLO: 1000,
      },
    })],
    ["rotation_replace_only", rotationBaseOptions({
      penguOffRotationAllowFromCash: false,
      penguOffRotationMaxNotionalUsdBySymbol: undefined,
    })],
    ["rotation_replace_only_gap5", rotationBaseOptions({
      penguOffRotationAllowFromCash: false,
      penguOffRotationScoreGap: 5,
      penguOffRotationMaxNotionalUsdBySymbol: undefined,
    })],
    ["rotation_replace_bank_allo_only", rotationBaseOptions({
      strictExtraTrendSymbols: [...new Set([...(base.strictExtraTrendSymbols ?? []), "BANK", "ALLO"])],
      penguOffRotationSymbols: ["BANK", "ALLO"],
      penguOffRotationAllowFromCash: false,
      penguOffRotationMaxNotionalUsdBySymbol: undefined,
    })],
    ["rotation_preserve_pengu_replace_gap5", rotationPreservePenguOptions()],
    ["rotation_preserve_pengu_replace_gap10", rotationPreservePenguOptions({
      penguOffRotationScoreGap: 10,
    })],
    ["rotation_preserve_pengu_bank_allo_only", rotationPreservePenguOptions({
      penguOffRotationSymbols: ["BANK", "ALLO"],
    })],
    ["rotation_preserve_pengu_uni_only", rotationPreservePenguOptions({
      penguOffRotationSymbols: ["UNI"],
    })],
    ["rotation_preserve_pengu_dexe_ultra_filter", rotationPreservePenguOptions({
      trendBreakoutLookbackBarsBySymbol: {
        ...(rotationPreservePenguOptions().trendBreakoutLookbackBarsBySymbol ?? {}),
        DEXE: 24,
      },
      trendBreakoutMinPctBySymbol: {
        ...(rotationPreservePenguOptions().trendBreakoutMinPctBySymbol ?? {}),
        DEXE: 0.05,
      },
      trendMinVolumeRatioBySymbol: {
        ...(rotationPreservePenguOptions().trendMinVolumeRatioBySymbol ?? {}),
        DEXE: 2.2,
      },
      trendMinMomAccelBySymbol: {
        ...(rotationPreservePenguOptions().trendMinMomAccelBySymbol ?? {}),
        DEXE: 0.012,
      },
      trendMinEfficiencyRatioBySymbol: {
        ...(rotationPreservePenguOptions().trendMinEfficiencyRatioBySymbol ?? {}),
        DEXE: 0.42,
      },
    })],
  ];
  const caseFilter = process.env.CASE_FILTER ? new RegExp(process.env.CASE_FILTER) : null;
  const selectedCases = caseFilter ? cases.filter(([label]) => caseFilter.test(label)) : cases;

  const rows = [];
  for (const [label, options] of selectedCases) {
    console.log(`running ${label}`);
    const row = await runCase(label, options);
    rows.push(row);
    console.log(`${label}: end=${round(row.endEquity, 2)} dd=${round(row.maxDrawdownPct, 2)} pf=${round(row.profitFactor, 3)} trades=${row.trades} rotation=${row.rotationTrades} rotationPnl=${round(row.rotationPnl, 2)}`);
  }
  const baseline = rows[0]?.endEquity ?? 0;
  const md = [
    "# V7 PENGU Off-Window Rotation Engine Test",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: engine-direct V7 profile, plus experimental PENGU-off 1h rotation candidate",
    "- rotation symbols: BANK / ALLO / UNI / DEXE",
    "- DEXE dedicated filter: stricter breakout, volume, momAccel, efficiency than BANK/ALLO/UNI",
    "",
    "| pattern | End Equity | diff vs V7 | MaxDD | PF | trades | rotation trades | rotation PnL |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${round(row.endEquity, 2)} | ${round(row.endEquity - baseline, 2)} | ${round(row.maxDrawdownPct, 2)}% | ${round(row.profitFactor, 3)} | ${row.trades} | ${row.rotationTrades} | ${round(row.rotationPnl, 2)} |`),
    "",
    "## Rotation Symbol PnL",
    "",
    ...rows.filter((row) => row.rotationTrades > 0).flatMap((row) => [
      `### ${row.label}`,
      "| symbol | trades | pnl |",
      "| --- | ---: | ---: |",
      ...row.rotationSymbolPnl.map((item) => `| ${item.symbol} | ${item.trades} | ${item.pnl} |`),
      "",
    ]),
    "## Top Rotation Trades",
    "",
    ...rows.filter((row) => row.rotationTrades > 0).flatMap((row) => [
      `### ${row.label}`,
      ...row.topRotationTrades.map((trade) => `- ${trade.symbol}: ${trade.entry} -> ${trade.exit}, pnl ${trade.pnl}, ${trade.exitReason}`),
      "",
    ]),
    "## Full Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.label}`,
      "| symbol | trades | pnl |",
      "| --- | ---: | ---: |",
      ...row.symbolPnl.map((item) => `| ${item.symbol} | ${item.trades} | ${item.pnl} |`),
      "",
    ]),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
