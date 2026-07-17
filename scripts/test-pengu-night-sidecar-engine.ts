import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-night-sidecar-engine");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 5, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(key: string, result: Awaited<ReturnType<typeof runHybridBacktest>>, elapsedMs: number, baseline = 0) {
  const penguTrades = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
  const nightTrades = result.trade_pairs.filter((trade) => trade.sub_variant === "idle-breakout-night");
  return {
    key,
    endEquity: round(result.summary.end_equity),
    delta: baseline ? round(result.summary.end_equity - baseline) : 0,
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    penguPnl: round(Number(result.summary.symbol_contribution.PENGU || 0)),
    penguTrades: penguTrades.length,
    nightPnl: round(nightTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    nightTrades: nightTrades.length,
    nightWins: nightTrades.filter((trade) => trade.net_pnl > 0).length,
    nightLosses: nightTrades.filter((trade) => trade.net_pnl <= 0).length,
    elapsedSec: round(elapsedMs / 1000, 1),
  };
}

function nightSidecar(base: HybridVariantOptions, overrides: Partial<HybridVariantOptions>): HybridVariantOptions {
  return {
    ...base,
    idleNightBreakoutEntryWhileCash: true,
    idleNightBreakoutEntryTimeframe: "15m",
    idleNightBreakoutSymbols: ["PENGU"],
    idleNightBreakoutJstStartHour: 22,
    idleNightBreakoutJstEndHour: 2,
    idleNightBreakoutAllowTradeGateOff: false,
    ...overrides,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;

  const variants: Array<{ key: string; options: HybridVariantOptions }> = [
    { key: "v7_current", options: { ...base, label: "v7_current" } },
    {
      key: "night_add_current_filters",
      options: nightSidecar(base, {
        label: "night_add_current_filters",
        idleNightBreakoutMinVolumeRatio: 1.15,
        idleNightBreakoutMinMomAccel: 0.0015,
        idleNightBreakoutBreakoutLookbackBars: 16,
        idleNightBreakoutBreakoutMinPct: 0.006,
        idleNightBreakoutMinEfficiencyRatio: 0.18,
      }),
    },
  ];

  for (const lookback of [8, 12, 16]) {
    for (const breakout of [0.003, 0.0045, 0.006]) {
      for (const volume of [0.95, 1.05, 1.15]) {
        for (const momAccel of [0, 0.0008, 0.0015]) {
          for (const efficiency of [0.08, 0.12, 0.18]) {
            variants.push({
              key: `night_add_lb${lookback}_bo${Math.round(breakout * 10000)}_vol${Math.round(volume * 100)}_mom${Math.round(momAccel * 10000)}_er${Math.round(efficiency * 100)}`,
              options: nightSidecar(base, {
                idleNightBreakoutMinVolumeRatio: volume,
                idleNightBreakoutMinMomAccel: momAccel,
                idleNightBreakoutBreakoutLookbackBars: lookback,
                idleNightBreakoutBreakoutMinPct: breakout,
                idleNightBreakoutMinEfficiencyRatio: efficiency,
              }),
            });
          }
        }
      }
    }
  }

  const rows = [];
  let baselineEquity = 0;
  const tradeRows = [];
  for (const variant of variants) {
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", variant.options);
    if (variant.key === "v7_current") baselineEquity = result.summary.end_equity;
    const row = summarize(variant.key, result, Date.now() - started, baselineEquity);
    rows.push(row);
    tradeRows.push(...result.trade_pairs.map((trade) => ({ variant: variant.key, ...trade })));
    console.log(`${variant.key} end=${row.endEquity.toLocaleString()} delta=${row.delta.toLocaleString()} night=${row.nightTrades}/${row.nightPnl.toLocaleString()} elapsed=${row.elapsedSec}s`);
  }
  const sorted = rows.sort((left, right) => right.endEquity - left.endEquity);

  const md = [
    "# V7 PENGU Night Sidecar Engine Test",
    "",
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", options)`",
    "- base: V7 live-equivalent cash rescue profile",
    "- added logic: keep current PENGU idle breakout, add PENGU-only 15m idle-night breakout during JST 22:00-02:00 while cash",
    `- period: ${new Date(START_TS).toISOString()} ～ ${new Date(END_TS).toISOString()}`,
    "",
    "| rank | variant | End Equity | delta | MaxDD % | PF | trades | PENGU PnL | PENGU trades | night PnL | night W/L | night trades | elapsed |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...sorted.slice(0, 30).map((row, index) => `| ${index + 1} | ${row.key} | ${row.endEquity.toLocaleString()} | ${row.delta.toLocaleString()} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.penguTrades} | ${row.nightPnl.toLocaleString()} | ${row.nightWins}/${row.nightLosses} | ${row.nightTrades} | ${row.elapsedSec}s |`),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(sorted, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
