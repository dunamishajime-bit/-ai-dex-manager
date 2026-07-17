import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-night-sidecar-engine");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 4, 5, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nightOptions(base: HybridVariantOptions, overrides: Partial<HybridVariantOptions>): HybridVariantOptions {
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
    ...overrides,
  };
}

function summarize(key: string, result: Awaited<ReturnType<typeof runHybridBacktest>>, baseline = 0) {
  const nightTrades = result.trade_pairs.filter((trade) => trade.sub_variant === "idle-breakout-night");
  const nightLosses = nightTrades.filter((trade) => trade.net_pnl <= 0);
  return {
    key,
    endEquity: round(result.summary.end_equity),
    delta: baseline ? round(result.summary.end_equity - baseline) : 0,
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    penguPnl: round(Number(result.summary.symbol_contribution.PENGU || 0)),
    penguTrades: result.trade_pairs.filter((trade) => trade.symbol === "PENGU").length,
    nightPnl: round(nightTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    nightTrades: nightTrades.length,
    nightWins: nightTrades.length - nightLosses.length,
    nightLosses: nightLosses.length,
    worstNightPnl: nightTrades.length ? round(Math.min(...nightTrades.map((trade) => trade.net_pnl))) : 0,
  };
}

async function runOne(label: string, options: HybridVariantOptions, baselineEquity: number) {
  const result = await runHybridBacktest("RETQ22", { ...options, label });
  const summary = summarize(label, result, baselineEquity);
  console.log(`${label} end=${summary.endEquity.toLocaleString()} delta=${summary.delta.toLocaleString()} night=${summary.nightWins}/${summary.nightLosses} pnl=${summary.nightPnl.toLocaleString()}`);
  return { summary, trades: result.trade_pairs.map((trade) => ({ variant: label, ...trade })) };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;

  const baseline = await runHybridBacktest("RETQ22", { ...base, label: "v7_current" });
  const baselineSummary = summarize("v7_current", baseline);
  console.log(`v7_current end=${baselineSummary.endEquity.toLocaleString()}`);

  const variants: Array<{ key: string; options: HybridVariantOptions }> = [];
  for (const maxOneBar of [null, 0.018, 0.025, 0.035, 0.05]) {
    for (const minRange of [null, 0.018, 0.025, 0.035]) {
      for (const maxRange of [null, 0.08, 0.12, 0.18]) {
        for (const minPath of [null, 0.02, 0.035, 0.05]) {
          const suffix = [
            maxOneBar == null ? "jumpAny" : `jump${Math.round(maxOneBar * 1000)}`,
            minRange == null ? "minRAny" : `minR${Math.round(minRange * 1000)}`,
            maxRange == null ? "maxRAny" : `maxR${Math.round(maxRange * 1000)}`,
            minPath == null ? "pathAny" : `path${Math.round(minPath * 1000)}`,
          ].join("_");
          variants.push({
            key: `night_refined_${suffix}`,
            options: nightOptions(base, {
              idleNightBreakoutMaxOneBarMovePct: maxOneBar,
              idleNightBreakoutMinRecentRangePct: minRange,
              idleNightBreakoutMaxRecentRangePct: maxRange,
              idleNightBreakoutMinRecentPathPct: minPath,
            }),
          });
        }
      }
    }
  }

  const rows = [baselineSummary];
  const tradeRows = [baseline.trade_pairs.map((trade) => ({ variant: "v7_current", ...trade }))].flat();
  for (const variant of variants) {
    const { summary, trades } = await runOne(variant.key, variant.options, baseline.summary.end_equity);
    rows.push(summary);
    tradeRows.push(...trades);
  }
  const sorted = rows.sort((left, right) => right.endEquity - left.endEquity);

  const md = [
    "# V7 PENGU Night Sidecar Refined",
    "",
    "- method: engine-direct full period",
    "- base night condition: JST 22:00-02:00, PENGU 15m, lookback 8, breakout 0.6%, volumeRatio 1.15, momAccel >= 0, efficiency >= 0.08",
    "- added filters: max one-bar jump, recent range min/max, recent path min",
    "",
    "| rank | variant | End Equity | delta | MaxDD % | PF | trades | PENGU PnL | PENGU trades | night PnL | night W/L | night trades | worst night PnL |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...sorted.slice(0, 40).map((row, index) => `| ${index + 1} | ${row.key} | ${row.endEquity.toLocaleString()} | ${row.delta.toLocaleString()} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.penguTrades} | ${row.nightPnl.toLocaleString()} | ${row.nightWins}/${row.nightLosses} | ${row.nightTrades} | ${row.worstNightPnl.toLocaleString()} |`),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "refined-summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "refined-summary.json"), JSON.stringify(sorted, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "refined-trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
