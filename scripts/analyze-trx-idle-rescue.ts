import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "trx-idle-rescue");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = await runHybridBacktest("RETQ22", {
    ...baseOptions(),
    label: "base_v7_trx_idle_rescue",
  });

  const shared: HybridVariantOptions = {
    ...baseOptions(),
    idleBreakoutEntryWhileCash: true,
    idleBreakoutSymbols: ["TRX"],
    idleBreakoutAllowTradeGateOff: true,
    idleBreakoutEntryTimeframe: "6h",
  };

  const variants: VariantSpec[] = [
    {
      key: "trx_idle_rescue_balanced",
      thesis: "TRX-only cash rescue on 6H with light breakout and efficiency bias.",
      options: {
        ...shared,
        label: "trx_idle_rescue_balanced",
        idleBreakoutBreakoutLookbackBars: 6,
        idleBreakoutBreakoutMinPct: 0.004,
        idleBreakoutMinVolumeRatio: 0.98,
        idleBreakoutMinMomAccel: -0.002,
        idleBreakoutMinEfficiencyRatio: 0.1,
        idleBreakoutMaxHoldBars: 8,
        idleBreakoutProfitTrailActivationPct: 0.1,
        idleBreakoutProfitTrailRetracePct: 0.08,
      },
    },
    {
      key: "trx_idle_rescue_soft",
      thesis: "Softer TRX cash rescue to maximize firing during reserve windows.",
      options: {
        ...shared,
        label: "trx_idle_rescue_soft",
        idleBreakoutBreakoutLookbackBars: 4,
        idleBreakoutBreakoutMinPct: 0.002,
        idleBreakoutMinVolumeRatio: 0.95,
        idleBreakoutMinMomAccel: -0.006,
        idleBreakoutMinEfficiencyRatio: 0.06,
        idleBreakoutMaxHoldBars: 10,
        idleBreakoutProfitTrailActivationPct: 0.08,
        idleBreakoutProfitTrailRetracePct: 0.09,
      },
    },
    {
      key: "trx_idle_rescue_confirmed",
      thesis: "More confirmed TRX rescue with slightly stricter breakout and shorter hold.",
      options: {
        ...shared,
        label: "trx_idle_rescue_confirmed",
        idleBreakoutBreakoutLookbackBars: 8,
        idleBreakoutBreakoutMinPct: 0.006,
        idleBreakoutMinVolumeRatio: 1,
        idleBreakoutMinMomAccel: 0,
        idleBreakoutMinEfficiencyRatio: 0.12,
        idleBreakoutMaxHoldBars: 6,
        idleBreakoutProfitTrailActivationPct: 0.12,
        idleBreakoutProfitTrailRetracePct: 0.07,
      },
    },
  ];

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const trades = result.trade_pairs.filter((trade) => trade.symbol === "TRX");
    const wins = trades.filter((trade) => trade.net_pnl > 0).length;
    const losses = trades.filter((trade) => trade.net_pnl <= 0).length;
    const idleBreakoutTrades = trades.filter((trade) => trade.sub_variant === "idle-breakout");

    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      endEquity: round(result.summary.end_equity),
      deltaEndEquity: round(result.summary.end_equity - base.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      winRatePct: round(result.summary.win_rate_pct),
      tradeCount: result.summary.trade_count,
      trxTradeCount: trades.length,
      trxWins: wins,
      trxLosses: losses,
      trxPnl: round(result.summary.symbol_contribution.TRX ?? 0),
      idleBreakoutTradeCount: idleBreakoutTrades.length,
      exposurePct: round(result.summary.exposure_pct),
    });
  }

  const md = [
    "# TRX Idle Rescue Variants",
    "",
    "## Baseline",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- end_equity: ${round(base.summary.end_equity)}`,
    `- cagr_pct: ${round(base.summary.cagr_pct)}%`,
    `- max_drawdown_pct: ${round(base.summary.max_drawdown_pct)}%`,
    `- profit_factor: ${round(base.summary.profit_factor, 3)}`,
    `- trade_count: ${base.summary.trade_count}`,
    "",
    "## Variants",
    "",
    "| variant | thesis | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TRX trades | TRX wins | TRX losses | TRX pnl | idle-breakout trades | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.deltaEndEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.trxTradeCount} | ${row.trxWins} | ${row.trxLosses} | ${row.trxPnl} | ${row.idleBreakoutTradeCount} | ${row.exposurePct} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: base.summary,
    results: rows,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({
    baseline: {
      endEquity: round(base.summary.end_equity),
      cagrPct: round(base.summary.cagr_pct),
      maxDrawdownPct: round(base.summary.max_drawdown_pct),
      profitFactor: round(base.summary.profit_factor, 3),
      tradeCount: base.summary.trade_count,
    },
    results: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
