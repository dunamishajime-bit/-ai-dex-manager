import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-new-pengu-replacement-candidates");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 4, 22, 23, 59, 59, 999);

type Case = {
  key: string;
  symbols: string[];
  opts: Partial<HybridVariantOptions>;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_new_pengu_engine_direct",
    ...extra,
  };
}

const runner72: Partial<HybridVariantOptions> = {
  idleBreakoutEntryWhileCash: true,
  idleBreakoutEntryTimeframe: "1h",
  idleBreakoutAllowTradeGateOff: true,
  idleBreakoutBreakoutLookbackBars: 12,
  idleBreakoutBreakoutMinPct: 0.02,
  idleBreakoutMinVolumeRatio: 1.2,
  idleBreakoutMinMomAccel: -0.002,
  idleBreakoutMinEfficiencyRatio: 0.12,
  idleBreakoutProfitTrailActivationPct: 0.26,
  idleBreakoutProfitTrailRetracePct: 0.12,
  idleBreakoutMaxHoldBars: 72,
  idleBreakoutWeakExitMom20Below: 0.02,
  idleBreakoutWeakExitMomAccelBelow: -0.01,
  idleBreakoutWeakExitMinHoldBars: 10,
  idleBreakoutWeakExitRequireCloseBelowSma40: true,
};

const cases: Case[] = [
  { key: "current_v7", symbols: [], opts: {} },
  { key: "pengu_runner72_idle", symbols: ["PENGU"], opts: runner72 },
  { key: "ape_runner72_idle", symbols: ["APE"], opts: runner72 },
  { key: "cos_runner72_idle", symbols: ["COS"], opts: runner72 },
  { key: "ape_cos_runner72_idle", symbols: ["APE", "COS"], opts: runner72 },
  { key: "pengu_ape_runner72_idle", symbols: ["PENGU", "APE"], opts: runner72 },
  { key: "pengu_cos_runner72_idle", symbols: ["PENGU", "COS"], opts: runner72 },
  { key: "pengu_ape_cos_runner72_idle", symbols: ["PENGU", "APE", "COS"], opts: runner72 },
];

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  for (const testCase of cases) {
    console.log(`running ${testCase.key}`);
    const result = await runHybridBacktest("RETQ22", baseOptions({
      ...testCase.opts,
      idleBreakoutSymbols: testCase.symbols.length ? testCase.symbols : RECLAIM_HYBRID_EXECUTION_PROFILE.idleBreakoutSymbols,
      label: testCase.key,
    }));
    rows.push({
      key: testCase.key,
      endEquity: result.summary.end_equity,
      maxDd: result.summary.max_drawdown_pct,
      pf: result.summary.profit_factor,
      trades: result.summary.trade_count,
      apePnl: result.trade_pairs.filter((trade) => trade.symbol === "APE").reduce((sum, trade) => sum + trade.net_pnl, 0),
      cosPnl: result.trade_pairs.filter((trade) => trade.symbol === "COS").reduce((sum, trade) => sum + trade.net_pnl, 0),
      penguPnl: result.trade_pairs.filter((trade) => trade.symbol === "PENGU").reduce((sum, trade) => sum + trade.net_pnl, 0),
      symbols: Object.fromEntries(["APE", "COS", "PENGU", "TWT", "ETH", "DOGE"].map((symbol) => [
        symbol,
        {
          trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
          pnl: round(result.trade_pairs.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.net_pnl, 0)),
        },
      ])),
    });
  }
  const base = rows[0].endEquity;
  const md = [
    "# V7 New PENGU Replacement Engine-Direct Backtest",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: runHybridBacktest engine-direct, idleBreakoutSymbols swapped to APE/COS where applicable",
    "- note: this does not add live token config or deploy; validation only.",
    "",
    "| case | End Equity | vs current | MaxDD | PF | trades | APE PnL | COS PnL | PENGU PnL | symbols |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.key} | ${round(row.endEquity)} | ${round(row.endEquity - base)} | ${round(row.maxDd)}% | ${round(row.pf, 3)} | ${row.trades} | ${round(row.apePnl)} | ${round(row.cosPnl)} | ${round(row.penguPnl)} | ${JSON.stringify(row.symbols)} |`),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "engine-direct.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "engine-direct.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
