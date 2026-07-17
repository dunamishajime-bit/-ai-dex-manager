import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-night-sidecar-engine");

const PERIODS = [
  { key: "2024-H2", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
  { key: "2024-2026", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function bestNight(base: HybridVariantOptions, variant: "raw" | "path20" | "jump18" = "raw"): HybridVariantOptions {
  return {
    ...base,
    idleNightBreakoutEntryWhileCash: true,
    idleNightBreakoutEntryTimeframe: "15m",
    idleNightBreakoutSymbols: ["PENGU"],
    idleNightBreakoutJstStartHour: 22,
    idleNightBreakoutJstEndHour: 2,
    idleNightBreakoutAllowTradeGateOff: false,
    idleNightBreakoutMinVolumeRatio: 1.15,
    idleNightBreakoutMinMomAccel: 0,
    idleNightBreakoutBreakoutLookbackBars: 8,
    idleNightBreakoutBreakoutMinPct: 0.006,
    idleNightBreakoutMinEfficiencyRatio: 0.08,
    ...(variant === "path20" ? { idleNightBreakoutMinRecentPathPct: 0.02 } : {}),
    ...(variant === "jump18" ? { idleNightBreakoutMaxOneBarMovePct: 0.018 } : {}),
  };
}

function summarize(
  period: string,
  variant: string,
  result: Awaited<ReturnType<typeof runHybridBacktest>>,
  baseline = 0,
) {
  const nightTrades = result.trade_pairs.filter((trade) => trade.sub_variant === "idle-breakout-night");
  return {
    period,
    variant,
    endEquity: round(result.summary.end_equity),
    delta: baseline ? round(result.summary.end_equity - baseline) : 0,
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    penguPnl: round(Number(result.summary.symbol_contribution.PENGU || 0)),
    penguTrades: result.trade_pairs.filter((trade) => trade.symbol === "PENGU").length,
    nightPnl: round(nightTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    nightWins: nightTrades.filter((trade) => trade.net_pnl > 0).length,
    nightLosses: nightTrades.filter((trade) => trade.net_pnl <= 0).length,
    nightTrades: nightTrades.length,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const trades = [];

  for (const period of PERIODS) {
    const base = {
      ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
      backtestStartTs: period.startTs,
      backtestEndTs: period.endTs,
    } satisfies HybridVariantOptions;
    const baseline = await runHybridBacktest("RETQ22", { ...base, label: `${period.key}_current` });
    const baselineSummary = summarize(period.key, "v7_current", baseline);
    rows.push(baselineSummary);
    trades.push(...baseline.trade_pairs.map((trade) => ({ period: period.key, variant: "v7_current", ...trade })));
    for (const variant of ["raw", "path20", "jump18"] as const) {
      const night = await runHybridBacktest("RETQ22", { ...bestNight(base, variant), label: `${period.key}_night_${variant}` });
      const label = variant === "raw"
        ? "night_best_raw"
        : variant === "path20"
          ? "night_best_path20"
          : "night_best_jump18";
      const nightSummary = summarize(period.key, label, night, baseline.summary.end_equity);
      rows.push(nightSummary);
      trades.push(...night.trade_pairs.map((trade) => ({ period: period.key, variant: label, ...trade })));
      console.log(`${period.key} current=${baselineSummary.endEquity.toLocaleString()} ${label}=${nightSummary.endEquity.toLocaleString()} delta=${nightSummary.delta.toLocaleString()} nightTrades=${nightSummary.nightTrades}`);
    }
  }

  const md = [
    "# V7 PENGU Night Sidecar Period Check",
    "",
    "- method: engine-direct period split",
    "- tested condition: JST 22:00-02:00, PENGU 15m, lookback 8, breakout 0.6%, volumeRatio 1.15, momAccel >= 0, efficiency >= 0.08",
    "- variants: raw / min recent path 2% / max one-bar jump 1.8%",
    "",
    "| period | variant | End Equity | delta | MaxDD % | PF | trades | PENGU PnL | PENGU trades | night PnL | night W/L | night trades |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.period} | ${row.variant} | ${row.endEquity.toLocaleString()} | ${row.delta.toLocaleString()} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.penguTrades} | ${row.nightPnl.toLocaleString()} | ${row.nightWins}/${row.nightLosses} | ${row.nightTrades} |`),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "period-check.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "period-check.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "period-trades.json"), JSON.stringify(trades, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
