import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import type { HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-strong-override");
const START_TS = process.env.START ? Date.parse(process.env.START) : Date.UTC(2022, 0, 1);
const END_TS = process.env.END ? Date.parse(process.env.END) : Date.UTC(2026, 4, 5, 23, 59, 59, 999);
const CURRENT_SYMBOLS = ["ETH", "SOL", "AVAX", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"] as const;
const FROM_2025_WINDOW = [{ startTs: Date.UTC(2025, 0, 1), endTs: Number.POSITIVE_INFINITY }] as const;

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

function baseOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  return {
    ...base,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    ...extra,
  };
}

function penguOverrideOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  const base = baseOptions();
  return {
    ...base,
    penguOffRotationEntry: true,
    penguOffRotationTimeframe: "15m",
    penguOffRotationSymbols: ["PENGU"],
    penguOffRotationCurrentSymbols: CURRENT_SYMBOLS,
    penguOffRotationAllowFromCash: false,
    penguOffRotationAllowWhileHolding: true,
    penguOffRotationAllowTradeGateOff: true,
    penguOffRotationScoreGap: 10,
    penguOffRotationMinHoldBars: 2,
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      PENGU: 16,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      PENGU: 0.006,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      PENGU: 1.15,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      PENGU: 0.0015,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      PENGU: 0.18,
    },
    trendProfitTrailActivationPctBySymbol: {
      ...(base.trendProfitTrailActivationPctBySymbol ?? {}),
      PENGU: 0.06,
    },
    trendProfitTrailRetracePctBySymbol: {
      ...(base.trendProfitTrailRetracePctBySymbol ?? {}),
      PENGU: 0.03,
    },
    ...extra,
  };
}

function weakCurrentPenguOverrideOptions(
  currentSymbols: readonly string[],
  extra: Partial<HybridVariantOptions> = {},
): HybridVariantOptions {
  return penguOverrideOptions({
    penguOffRotationCurrentSymbols: currentSymbols,
    penguOffRotationScoreGap: 10,
    trendBreakoutLookbackBarsBySymbol: {
      ...(penguOverrideOptions().trendBreakoutLookbackBarsBySymbol ?? {}),
      PENGU: 16,
    },
    trendBreakoutMinPctBySymbol: {
      ...(penguOverrideOptions().trendBreakoutMinPctBySymbol ?? {}),
      PENGU: 0.006,
    },
    trendMinVolumeRatioBySymbol: {
      ...(penguOverrideOptions().trendMinVolumeRatioBySymbol ?? {}),
      PENGU: 1.15,
    },
    trendMinMomAccelBySymbol: {
      ...(penguOverrideOptions().trendMinMomAccelBySymbol ?? {}),
      PENGU: 0,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(penguOverrideOptions().trendMinEfficiencyRatioBySymbol ?? {}),
      PENGU: 0.12,
    },
    ...extra,
  });
}

function isolatedWeakCurrentPenguOverrideOptions(
  currentSymbols: readonly string[],
  extra: Partial<HybridVariantOptions> = {},
): HybridVariantOptions {
  const base = baseOptions();
  return {
    ...base,
    penguStrongOverrideEntry: true,
    penguStrongOverrideTimeframe: "15m",
    penguStrongOverrideSymbols: ["PENGU"],
    penguStrongOverrideCurrentSymbols: currentSymbols,
    penguStrongOverrideScoreGap: 15,
    penguStrongOverrideMinHoldBars: 2,
    penguStrongOverrideAllowTradeGateOff: true,
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      PENGU: 16,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      PENGU: 0.006,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      PENGU: 1.15,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      PENGU: 0,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      PENGU: 0.12,
    },
    ...extra,
  };
}

async function runCase(label: string, options: HybridVariantOptions) {
  const result = await runHybridBacktest("RETQ22", { ...options, label });
  const endEquity = result.equity_curve.at(-1)?.equity ?? 0;
  const overrideTrades = result.trade_pairs.filter((trade) =>
    trade.sub_variant === "pengu-off-rotation" || trade.sub_variant === "pengu-strong-override"
  );
  const strongRotateTrades = result.trade_pairs.filter((trade) =>
    trade.symbol === "PENGU" &&
    (
      trade.sub_variant === "pengu-off-rotation" ||
      trade.sub_variant === "pengu-strong-override" ||
      trade.entry_reason.includes("strict-extra-rotate")
    )
  );
  const penguTrades = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
  return {
    label,
    endEquity,
    maxDrawdownPct: maxDrawdownPct(result.equity_curve),
    profitFactor: profitFactor(result.trade_pairs),
    trades: result.trade_pairs.length,
    overrideTrades: overrideTrades.length,
    overridePnl: overrideTrades.reduce((sum, trade) => sum + trade.net_pnl, 0),
    strongRotateTrades: strongRotateTrades.length,
    strongRotatePnl: strongRotateTrades.reduce((sum, trade) => sum + trade.net_pnl, 0),
    penguTrades: penguTrades.length,
    penguPnl: penguTrades.reduce((sum, trade) => sum + trade.net_pnl, 0),
    symbolPnl: symbolPnl(result.trade_pairs),
    overrideTopTrades: overrideTrades
      .sort((left, right) => right.net_pnl - left.net_pnl)
      .slice(0, 12)
      .map((trade) => ({
        symbol: trade.symbol,
        entry: trade.entry_time,
        exit: trade.exit_time,
        pnl: round(trade.net_pnl, 2),
        exitReason: trade.exit_reason,
      })),
    overrideWorstTrades: overrideTrades
      .sort((left, right) => left.net_pnl - right.net_pnl)
      .slice(0, 12)
      .map((trade) => ({
        symbol: trade.symbol,
        entry: trade.entry_time,
        exit: trade.exit_time,
        pnl: round(trade.net_pnl, 2),
        exitReason: trade.exit_reason,
      })),
    strongRotateTopTrades: strongRotateTrades
      .sort((left, right) => right.net_pnl - left.net_pnl)
      .slice(0, 12)
      .map((trade) => ({
        symbol: trade.symbol,
        entry: trade.entry_time,
        exit: trade.exit_time,
        pnl: round(trade.net_pnl, 2),
        entryReason: trade.entry_reason,
        exitReason: trade.exit_reason,
      })),
    strongRotateWorstTrades: strongRotateTrades
      .sort((left, right) => left.net_pnl - right.net_pnl)
      .slice(0, 12)
      .map((trade) => ({
        symbol: trade.symbol,
        entry: trade.entry_time,
        exit: trade.exit_time,
        pnl: round(trade.net_pnl, 2),
        entryReason: trade.entry_reason,
        exitReason: trade.exit_reason,
      })),
    recentTrades: result.trade_pairs
      .filter((trade) => Date.parse(trade.entry_time) >= Date.UTC(2026, 3, 15))
      .map((trade) => ({
        symbol: trade.symbol,
        entry: trade.entry_time,
        exit: trade.exit_time,
        pnl: round(trade.net_pnl, 2),
        entryReason: trade.entry_reason,
        exitReason: trade.exit_reason,
        subVariant: trade.sub_variant,
      })),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const cases: [string, HybridVariantOptions][] = [
    ["current_v7", baseOptions({ penguOffRotationEntry: true })],
    ["strict_pengu_15m_gap10_hold2", baseOptions({
      strictExtraTrendDecisionTimeframe: "15m",
      strictExtraTrendExitCheckTimeframe: "15m",
      strictExtraTrendRotationCurrentSymbols: CURRENT_SYMBOLS,
      strictExtraTrendRotationScoreGap: 10,
      strictExtraTrendRotationMinHoldBars: 2,
      strictExtraTrendRotationCurrentMomAccelMax: 0.02,
      strictExtraTrendRotationCurrentMom20Max: 0.2,
      strictExtraTrendRotationCandidateMinMomAccel: 0.0015,
      strictExtraTrendRotationCandidateMinEfficiencyRatio: 0.18,
      strictExtraTrendMinEfficiencyRatioBySymbol: {
        PENGU: 0.18,
        DOGE: 0.28,
      },
      trendBreakoutLookbackBarsBySymbol: {
        ...(baseOptions().trendBreakoutLookbackBarsBySymbol ?? {}),
        PENGU: 16,
      },
      trendBreakoutMinPctBySymbol: {
        ...(baseOptions().trendBreakoutMinPctBySymbol ?? {}),
        PENGU: 0.006,
      },
      trendMinVolumeRatioBySymbol: {
        ...(baseOptions().trendMinVolumeRatioBySymbol ?? {}),
        PENGU: 1.15,
      },
      trendMinMomAccelBySymbol: {
        ...(baseOptions().trendMinMomAccelBySymbol ?? {}),
        PENGU: 0.0015,
      },
      trendMinEfficiencyRatioBySymbol: {
        ...(baseOptions().trendMinEfficiencyRatioBySymbol ?? {}),
        PENGU: 0.18,
      },
    })],
    ["strict_pengu_15m_gap15_hold2", baseOptions({
      strictExtraTrendDecisionTimeframe: "15m",
      strictExtraTrendExitCheckTimeframe: "15m",
      strictExtraTrendRotationCurrentSymbols: CURRENT_SYMBOLS,
      strictExtraTrendRotationScoreGap: 15,
      strictExtraTrendRotationMinHoldBars: 2,
      strictExtraTrendRotationCurrentMomAccelMax: 0.02,
      strictExtraTrendRotationCurrentMom20Max: 0.2,
      strictExtraTrendRotationCandidateMinMomAccel: 0.0015,
      strictExtraTrendRotationCandidateMinEfficiencyRatio: 0.18,
      trendBreakoutLookbackBarsBySymbol: {
        ...(baseOptions().trendBreakoutLookbackBarsBySymbol ?? {}),
        PENGU: 16,
      },
      trendBreakoutMinPctBySymbol: {
        ...(baseOptions().trendBreakoutMinPctBySymbol ?? {}),
        PENGU: 0.006,
      },
      trendMinVolumeRatioBySymbol: {
        ...(baseOptions().trendMinVolumeRatioBySymbol ?? {}),
        PENGU: 1.15,
      },
      trendMinMomAccelBySymbol: {
        ...(baseOptions().trendMinMomAccelBySymbol ?? {}),
        PENGU: 0.0015,
      },
      trendMinEfficiencyRatioBySymbol: {
        ...(baseOptions().trendMinEfficiencyRatioBySymbol ?? {}),
        PENGU: 0.18,
      },
    })],
    ["pengu_override_15m_gap10_hold2", penguOverrideOptions()],
    ["pengu_override_15m_gap5_hold2", penguOverrideOptions({ penguOffRotationScoreGap: 5 })],
    ["pengu_override_15m_gap15_hold2", penguOverrideOptions({ penguOffRotationScoreGap: 15 })],
    ["pengu_override_15m_gap10_hold4", penguOverrideOptions({ penguOffRotationMinHoldBars: 4 })],
    ["pengu_override_15m_early_gap10", penguOverrideOptions({
      penguOffRotationScoreGap: 10,
      trendMinMomAccelBySymbol: {
        ...(penguOverrideOptions().trendMinMomAccelBySymbol ?? {}),
        PENGU: 0,
      },
      trendMinEfficiencyRatioBySymbol: {
        ...(penguOverrideOptions().trendMinEfficiencyRatioBySymbol ?? {}),
        PENGU: 0.12,
      },
    })],
    ["pengu_override_15m_quality_gap10", penguOverrideOptions({
      penguOffRotationScoreGap: 10,
      penguOffRotationMinHoldBars: 2,
      trendBreakoutLookbackBarsBySymbol: {
        ...(penguOverrideOptions().trendBreakoutLookbackBarsBySymbol ?? {}),
        PENGU: 12,
      },
      trendBreakoutMinPctBySymbol: {
        ...(penguOverrideOptions().trendBreakoutMinPctBySymbol ?? {}),
        PENGU: 0.01,
      },
      trendMinVolumeRatioBySymbol: {
        ...(penguOverrideOptions().trendMinVolumeRatioBySymbol ?? {}),
        PENGU: 1.4,
      },
      trendMinMomAccelBySymbol: {
        ...(penguOverrideOptions().trendMinMomAccelBySymbol ?? {}),
        PENGU: 0.003,
      },
      trendMinEfficiencyRatioBySymbol: {
        ...(penguOverrideOptions().trendMinEfficiencyRatioBySymbol ?? {}),
        PENGU: 0.25,
      },
    })],
    ["pengu_override_15m_quality_gap15", penguOverrideOptions({
      penguOffRotationScoreGap: 15,
      penguOffRotationMinHoldBars: 2,
      trendBreakoutLookbackBarsBySymbol: {
        ...(penguOverrideOptions().trendBreakoutLookbackBarsBySymbol ?? {}),
        PENGU: 12,
      },
      trendBreakoutMinPctBySymbol: {
        ...(penguOverrideOptions().trendBreakoutMinPctBySymbol ?? {}),
        PENGU: 0.01,
      },
      trendMinVolumeRatioBySymbol: {
        ...(penguOverrideOptions().trendMinVolumeRatioBySymbol ?? {}),
        PENGU: 1.4,
      },
      trendMinMomAccelBySymbol: {
        ...(penguOverrideOptions().trendMinMomAccelBySymbol ?? {}),
        PENGU: 0.003,
      },
      trendMinEfficiencyRatioBySymbol: {
        ...(penguOverrideOptions().trendMinEfficiencyRatioBySymbol ?? {}),
        PENGU: 0.25,
      },
    })],
    ["pengu_override_15m_ultra_quality_gap15", penguOverrideOptions({
      penguOffRotationScoreGap: 15,
      penguOffRotationMinHoldBars: 2,
      trendBreakoutLookbackBarsBySymbol: {
        ...(penguOverrideOptions().trendBreakoutLookbackBarsBySymbol ?? {}),
        PENGU: 16,
      },
      trendBreakoutMinPctBySymbol: {
        ...(penguOverrideOptions().trendBreakoutMinPctBySymbol ?? {}),
        PENGU: 0.014,
      },
      trendMinVolumeRatioBySymbol: {
        ...(penguOverrideOptions().trendMinVolumeRatioBySymbol ?? {}),
        PENGU: 1.7,
      },
      trendMinMomAccelBySymbol: {
        ...(penguOverrideOptions().trendMinMomAccelBySymbol ?? {}),
        PENGU: 0.006,
      },
      trendMinEfficiencyRatioBySymbol: {
        ...(penguOverrideOptions().trendMinEfficiencyRatioBySymbol ?? {}),
        PENGU: 0.35,
      },
    })],
    ["pengu_override_weak_current_eth_sol_inj_gap10", weakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ"])],
    ["pengu_override_weak_current_eth_sol_inj_gap15", weakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ"], {
      penguOffRotationScoreGap: 15,
    })],
    ["pengu_override_weak_current_eth_only_gap10", weakCurrentPenguOverrideOptions(["ETH"])],
    ["pengu_override_weak_current_eth_sol_inj_gap15_from2025", weakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ"], {
      penguOffRotationScoreGap: 15,
      penguOffRotationAllowedWindows: FROM_2025_WINDOW,
    })],
    ["pengu_override_weak_current_eth_only_gap10_from2025", weakCurrentPenguOverrideOptions(["ETH"], {
      penguOffRotationAllowedWindows: FROM_2025_WINDOW,
    })],
    ["pengu_isolated_weak_current_eth_sol_inj_gap15", isolatedWeakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ"])],
    ["pengu_isolated_weak_current_eth_only_gap10", isolatedWeakCurrentPenguOverrideOptions(["ETH"], {
      penguStrongOverrideScoreGap: 10,
    })],
    ["pengu_isolated_weak_current_eth_sol_inj_gap15_from2025", isolatedWeakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ"], {
      penguStrongOverrideAllowedWindows: FROM_2025_WINDOW,
    })],
    ["scope_1_eth_sol_inj", isolatedWeakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ"])],
    ["scope_2_eth_sol_inj_avax", isolatedWeakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ", "AVAX"])],
    ["scope_3_eth_sol_inj_doge_avax", isolatedWeakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ", "DOGE", "AVAX"])],
    ["scope_4_eth_sol_inj_doge_avax_twt", isolatedWeakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ", "DOGE", "AVAX", "TWT"])],
    ["scope_5_all_except_uni_bio_dusk_pengu", isolatedWeakCurrentPenguOverrideOptions(["ETH", "SOL", "INJ", "DOGE", "AVAX", "TWT"])],
  ];
  const caseFilter = process.env.CASE_FILTER ? new RegExp(process.env.CASE_FILTER) : null;
  const selectedCases = caseFilter ? cases.filter(([label]) => caseFilter.test(label)) : cases;

  const rows = [];
  for (const [label, options] of selectedCases) {
    console.log(`running ${label}`);
    const row = await runCase(label, options);
    rows.push(row);
    console.log(`${label}: end=${round(row.endEquity, 2)} dd=${round(row.maxDrawdownPct, 2)} pf=${round(row.profitFactor, 3)} trades=${row.trades} override=${row.overrideTrades} strictRotate=${row.strongRotateTrades} overridePnl=${round(row.overridePnl, 2)} strictRotatePnl=${round(row.strongRotatePnl, 2)} penguPnl=${round(row.penguPnl, 2)}`);
  }

  const baseline = rows[0]?.endEquity ?? 0;
  const md = [
    "# V7 PENGU Strong Override Engine Test",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: engine-direct V7 profile",
    "- candidate: while holding non-PENGU, allow 15m PENGU breakout rotation",
    "- target: PENGU only; current symbols: ETH / SOL / AVAX / DOGE / INJ / UNI / TWT / BIO / DUSK",
    "",
    "| pattern | End Equity | diff vs V7 | MaxDD | PF | trades | override trades | strict rotate trades | override PnL | strict rotate PnL | PENGU trades | PENGU PnL |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${round(row.endEquity, 2)} | ${round(row.endEquity - baseline, 2)} | ${round(row.maxDrawdownPct, 2)}% | ${round(row.profitFactor, 3)} | ${row.trades} | ${row.overrideTrades} | ${row.strongRotateTrades} | ${round(row.overridePnl, 2)} | ${round(row.strongRotatePnl, 2)} | ${row.penguTrades} | ${round(row.penguPnl, 2)} |`),
    "",
    "## Override Top Trades",
    "",
    ...rows.filter((row) => row.overrideTrades > 0).flatMap((row) => [
      `### ${row.label}`,
      ...row.overrideTopTrades.map((trade) => `- ${trade.entry} -> ${trade.exit}, pnl ${trade.pnl}, ${trade.exitReason}`),
      "",
    ]),
    "## Override Worst Trades",
    "",
    ...rows.filter((row) => row.overrideTrades > 0).flatMap((row) => [
      `### ${row.label}`,
      ...row.overrideWorstTrades.map((trade) => `- ${trade.entry} -> ${trade.exit}, pnl ${trade.pnl}, ${trade.exitReason}`),
      "",
    ]),
    "## Strict/PENGU Rotate Top Trades",
    "",
    ...rows.filter((row) => row.strongRotateTrades > 0).flatMap((row) => [
      `### ${row.label}`,
      ...row.strongRotateTopTrades.map((trade) => `- ${trade.entry} -> ${trade.exit}, pnl ${trade.pnl}, ${trade.exitReason}`),
      "",
    ]),
    "## Strict/PENGU Rotate Worst Trades",
    "",
    ...rows.filter((row) => row.strongRotateTrades > 0).flatMap((row) => [
      `### ${row.label}`,
      ...row.strongRotateWorstTrades.map((trade) => `- ${trade.entry} -> ${trade.exit}, pnl ${trade.pnl}, ${trade.exitReason}`),
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
