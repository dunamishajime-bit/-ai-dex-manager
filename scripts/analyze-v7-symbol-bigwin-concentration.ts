import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-symbol-bigwin-concentration");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 22, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value: number) {
  return `${round(value * 100, 1)}%`;
}

function options(): HybridVariantOptions {
  return {
    ...(buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_symbol_bigwin_concentration",
  };
}

function classify(row: {
  trades: number;
  pnl: number;
  topPnl: number;
  topShareOfPositive: number;
  pnlWithoutTop: number;
}) {
  if (row.trades < 2 || row.pnl <= 0 || row.topPnl <= 0) return "not_positive_or_too_few";
  if (row.topShareOfPositive >= 0.7 && row.pnlWithoutTop <= row.pnl * 0.25) return "one_big_win_dependent";
  if (row.topShareOfPositive >= 0.55 && row.pnlWithoutTop <= row.pnl * 0.5) return "big_win_heavy";
  return "distributed";
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const result = await runHybridBacktest("RETQ22", options());
  const rows = new Map<string, typeof result.trade_pairs>();
  for (const trade of result.trade_pairs) {
    const symbol = trade.symbol.toUpperCase();
    if (symbol === "PENGU") continue;
    rows.set(symbol, [...(rows.get(symbol) ?? []), trade]);
  }

  const summary = [...rows.entries()].map(([symbol, trades]) => {
    const sortedByPnl = [...trades].sort((left, right) => right.net_pnl - left.net_pnl);
    const positives = trades.filter((trade) => trade.net_pnl > 0);
    const pnl = trades.reduce((sum, trade) => sum + trade.net_pnl, 0);
    const positivePnl = positives.reduce((sum, trade) => sum + trade.net_pnl, 0);
    const top = sortedByPnl[0] ?? null;
    const topPnl = top?.net_pnl ?? 0;
    const topShareOfPositive = positivePnl > 0 ? topPnl / positivePnl : 0;
    const topShareOfTotal = pnl > 0 ? topPnl / pnl : 0;
    const pnlWithoutTop = pnl - topPnl;
    const wins = positives.length;
    const losses = trades.length - wins;
    const avgPnl = pnl / Math.max(1, trades.length);
    return {
      symbol,
      trades: trades.length,
      wins,
      losses,
      winRate: wins / Math.max(1, trades.length),
      pnl: round(pnl),
      positivePnl: round(positivePnl),
      topPnl: round(topPnl),
      topShareOfPositive,
      topShareOfTotal,
      pnlWithoutTop: round(pnlWithoutTop),
      avgPnl: round(avgPnl),
      topTrade: top ? {
        entry: top.entry_time,
        exit: top.exit_time,
        pnl: round(top.net_pnl),
        movePct: round(((top.exit_price / top.entry_price) - 1) * 100, 2),
        entryReason: top.entry_reason,
        exitReason: top.exit_reason,
      } : null,
      classification: classify({
        trades: trades.length,
        pnl,
        topPnl,
        topShareOfPositive,
        pnlWithoutTop,
      }),
    };
  }).sort((left, right) =>
    Number(right.classification === "one_big_win_dependent") - Number(left.classification === "one_big_win_dependent")
    || right.topShareOfPositive - left.topShareOfPositive
  );

  const md = [
    "# V7 Symbol Big Win Concentration",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: current V7 cash-rescue profile, RETQ22",
    "- excluded: PENGU",
    "",
    "| symbol | class | trades | W/L | win rate | PnL | top PnL | top / positive | PnL w/o top | top trade |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...summary.map((row) => `| ${row.symbol} | ${row.classification} | ${row.trades} | ${row.wins}/${row.losses} | ${pct(row.winRate)} | ${row.pnl.toLocaleString()} | ${row.topPnl.toLocaleString()} | ${pct(row.topShareOfPositive)} | ${row.pnlWithoutTop.toLocaleString()} | ${row.topTrade ? `${row.topTrade.entry} -> ${row.topTrade.exit} (${row.topTrade.movePct}%)` : "-"} |`),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
