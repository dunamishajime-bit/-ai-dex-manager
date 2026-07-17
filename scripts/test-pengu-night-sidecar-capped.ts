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
  { key: "full", startTs: Date.UTC(2022, 0, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
  { key: "2024-2026", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
];

const CAPS = [100, 300, 500, 1000, 2500] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(period: typeof PERIODS[number]): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: period.startTs,
    backtestEndTs: period.endTs,
  };
}

function nightOptions(base: HybridVariantOptions, cap: number): HybridVariantOptions {
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
    idleNightBreakoutMaxNotionalUsd: cap,
  };
}

function summarize(
  period: string,
  variant: string,
  cap: number | null,
  result: Awaited<ReturnType<typeof runHybridBacktest>>,
  baseline = 0,
) {
  const nightTrades = result.trade_pairs.filter((trade) => trade.sub_variant === "idle-breakout-night");
  const nightWins = nightTrades.filter((trade) => trade.net_pnl > 0).length;
  return {
    period,
    variant,
    cap,
    endEquity: round(result.summary.end_equity),
    delta: baseline ? round(result.summary.end_equity - baseline) : 0,
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    penguPnl: round(Number(result.summary.symbol_contribution.PENGU || 0)),
    penguTrades: result.trade_pairs.filter((trade) => trade.symbol === "PENGU").length,
    nightPnl: round(nightTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    nightTrades: nightTrades.length,
    nightWins,
    nightLosses: nightTrades.length - nightWins,
    avgNightNotional: nightTrades.length
      ? round(nightTrades.reduce((sum, trade) => sum + trade.entry_price * trade.qty, 0) / nightTrades.length)
      : 0,
    maxNightNotional: nightTrades.length
      ? round(Math.max(...nightTrades.map((trade) => trade.entry_price * trade.qty)))
      : 0,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const tradeRows = [];

  for (const period of PERIODS) {
    const base = baseOptions(period);
    const baseline = await runHybridBacktest("RETQ22", { ...base, label: `${period.key}_current` });
    rows.push(summarize(period.key, "v7_current", null, baseline));
    tradeRows.push(...baseline.trade_pairs.map((trade) => ({ period: period.key, variant: "v7_current", cap: null, ...trade })));
    for (const cap of CAPS) {
      const result = await runHybridBacktest("RETQ22", {
        ...nightOptions(base, cap),
        label: `${period.key}_night_cap_${cap}`,
      });
      const row = summarize(period.key, `night_cap_${cap}`, cap, result, baseline.summary.end_equity);
      rows.push(row);
      tradeRows.push(...result.trade_pairs.map((trade) => ({ period: period.key, variant: `night_cap_${cap}`, cap, ...trade })));
      console.log(`${period.key} cap=${cap} end=${row.endEquity.toLocaleString()} delta=${row.delta.toLocaleString()} night=${row.nightWins}/${row.nightLosses} pnl=${row.nightPnl.toLocaleString()} maxNotional=${row.maxNightNotional}`);
    }
  }

  const md = [
    "# V7 PENGU Night Sidecar Capped",
    "",
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", options)`",
    "- logic: PENGU only, USDT wait only, JST 22:00-02:00, 15m, lookback 8, breakout 0.6%, volumeRatio 1.15, momAccel >= 0, efficiency >= 0.08",
    "- cap: fixed max notional per entry",
    "",
    "| period | variant | cap | End Equity | delta | MaxDD % | PF | trades | PENGU PnL | PENGU trades | night PnL | night W/L | night trades | avg notional | max notional |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.period} | ${row.variant} | ${row.cap ?? ""} | ${row.endEquity.toLocaleString()} | ${row.delta.toLocaleString()} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.penguTrades} | ${row.nightPnl.toLocaleString()} | ${row.nightWins}/${row.nightLosses} | ${row.nightTrades} | ${row.avgNightNotional.toLocaleString()} | ${row.maxNightNotional.toLocaleString()} |`),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "capped-summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "capped-summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "capped-trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
