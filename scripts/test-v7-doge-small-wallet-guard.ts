import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import type { HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-doge-small-wallet-guard");
const START_TS = process.env.START
  ? Date.parse(`${process.env.START}T00:00:00.000Z`)
  : Date.UTC(2026, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.END
  ? Date.parse(`${process.env.END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 15, 23, 59, 59, 999);
const INITIAL_EQUITY = Number(process.env.INITIAL_EQUITY || 138.68);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function symbolPnl(trades: Array<{ symbol: string; net_pnl: number }>, symbol: string) {
  return round(trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.net_pnl, 0));
}

function summarize(label: string, result: Awaited<ReturnType<typeof runHybridBacktest>>, elapsedMs: number) {
  const trades = result.trade_pairs;
  return {
    label,
    start: new Date(START_TS).toISOString(),
    end: new Date(END_TS).toISOString(),
    initialEquity: INITIAL_EQUITY,
    elapsedSec: round(elapsedMs / 1000, 1),
    endEquity: round(result.summary.end_equity),
    returnPct: round(((result.summary.end_equity / INITIAL_EQUITY) - 1) * 100, 2),
    maxDrawdownPct: round(result.summary.max_drawdown_pct, 2),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct, 2),
    dogePnl: symbolPnl(trades, "DOGE"),
    dogeTrades: trades.filter((trade) => trade.symbol === "DOGE").length,
    penguPnl: symbolPnl(trades, "PENGU"),
    penguTrades: trades.filter((trade) => trade.symbol === "PENGU").length,
    twtPnl: symbolPnl(trades, "TWT"),
    twtTrades: trades.filter((trade) => trade.symbol === "TWT").length,
    symbols: Object.entries(result.summary.symbol_contribution)
      .map(([symbol, pnl]) => ({
        symbol,
        pnl: round(Number(pnl)),
        trades: trades.filter((trade) => trade.symbol === symbol).length,
      }))
      .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl)),
  };
}

function toMarkdown(rows: ReturnType<typeof summarize>[]) {
  const base = rows.find((row) => row.label === "doge_guard_on") ?? rows[0];
  return [
    "# V7 DOGE Small Wallet Guard",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- guard on: 300未満はPENGUのみ許可",
    "- doge allowed: 300未満でもPENGU/DOGEを許可",
    "- guard off: 小口ガードなし",
    `- initial equity: ${INITIAL_EQUITY.toLocaleString()}`,
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "",
    "| pattern | End Equity | diff vs guard | return | MaxDD | PF | trades | exposure | DOGE PnL/trades | PENGU PnL/trades | TWT PnL/trades | elapsed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => [
      `| ${row.label}`,
      row.endEquity.toLocaleString(),
      round(row.endEquity - base.endEquity).toLocaleString(),
      `${row.returnPct}%`,
      `${row.maxDrawdownPct}%`,
      row.profitFactor,
      row.trades,
      `${row.exposurePct}%`,
      `${row.dogePnl.toLocaleString()} / ${row.dogeTrades}`,
      `${row.penguPnl.toLocaleString()} / ${row.penguTrades}`,
      `${row.twtPnl.toLocaleString()} / ${row.twtTrades}`,
      `${row.elapsedSec}s |`,
    ].join(" | ")),
    "",
    "## Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.label}`,
      "",
      "| symbol | PnL | trades |",
      "| --- | ---: | ---: |",
      ...row.symbols.map((item) => `| ${item.symbol} | ${item.pnl.toLocaleString()} | ${item.trades} |`),
      "",
    ]),
  ].join("\n");
}

async function runCase(label: string, extra: Partial<HybridVariantOptions>) {
  const started = Date.now();
  const baseOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  const options: HybridVariantOptions = {
    ...baseOptions,
    initialEquity: INITIAL_EQUITY,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label,
    ...extra,
    trendAllocBySymbol: {
      ...(baseOptions.trendAllocBySymbol ?? {}),
      ...(extra.trendAllocBySymbol ?? {}),
    },
  };
  const result = await runHybridBacktest("RETQ22", options);
  return {
    summary: summarize(label, result, Date.now() - started),
    trades: result.trade_pairs,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const cases: Array<[string, Partial<HybridVariantOptions>]> = [
    ["doge_guard_on", { smallWalletEntryGuardMinEquity: 300, smallWalletEntryGuardAllowedSymbols: ["PENGU"] }],
    ["doge_allowed", { smallWalletEntryGuardMinEquity: 300, smallWalletEntryGuardAllowedSymbols: ["PENGU", "DOGE"] }],
    ["doge_guard_off", {}],
  ];
  const rows = [];
  for (const [label, extra] of cases) {
    console.log(`running ${label}`);
    const result = await runCase(label, extra);
    rows.push(result.summary);
    await fs.writeFile(path.join(REPORT_DIR, `${label}-trades.json`), JSON.stringify(result.trades, null, 2), "utf8");
  }
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
