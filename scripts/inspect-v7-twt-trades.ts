import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-next-profit-levers");
const START_TS = Date.UTC(2022, 0, 1);
const END_TS = Date.UTC(2026, 4, 22, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const options: HybridVariantOptions = {
    ...(buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "inspect_twt_trades",
  };
  const result = await runHybridBacktest("RETQ22", options);
  const rows = result.trade_pairs
    .filter((trade) => trade.symbol === "TWT")
    .map((trade) => ({
      entry: trade.entry_time,
      exit: trade.exit_time,
      pnl: round(trade.net_pnl),
      returnPct: round(trade.net_return_pct * 100, 2),
      entryReason: trade.entry_reason,
      exitReason: trade.exit_reason,
      entryPrice: trade.entry_price,
      exitPrice: trade.exit_price,
    }));
  const md = [
    "# V7 TWT Trades",
    "",
    "| entry | exit | pnl | return | exit reason | entry reason |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...rows.map((row) => `| ${row.entry} | ${row.exit} | ${row.pnl.toLocaleString()} | ${row.returnPct}% | ${row.exitReason} | ${row.entryReason} |`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "twt-trades.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "twt-trades.md"), md, "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
