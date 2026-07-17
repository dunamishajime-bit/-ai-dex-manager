import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-tiered-trail-focused");

const PERIODS = [
  { key: "2024-H1", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 5, 30, 23, 59, 59, 999) },
  { key: "2024-H2", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 3, 23, 23, 59, 59, 999) },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2026, 3, 23, 23, 59, 59, 999) },
  { key: "2024-2026", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2026, 3, 23, 23, 59, 59, 999) },
] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function withPenguTieredTrail(base: HybridVariantOptions) {
  const mode = process.env.TIER_MODE || "wide";
  const tiers = mode === "mild"
    ? [
        { activationPct: 0.06, retracePct: 0.03 },
        { activationPct: 0.3, retracePct: 0.05 },
      ]
    : mode === "late"
      ? [
          { activationPct: 0.06, retracePct: 0.03 },
          { activationPct: 0.45, retracePct: 0.08 },
        ]
      : [
          { activationPct: 0.06, retracePct: 0.03 },
          { activationPct: 0.15, retracePct: 0.05 },
          { activationPct: 0.3, retracePct: 0.08 },
        ];
  return {
    ...base,
    idleBreakoutTieredTrailBySymbol: {
      ...(base.idleBreakoutTieredTrailBySymbol ?? {}),
      PENGU: tiers,
    },
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((trade) => trade.symbol === symbol).length;
  return {
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguPnl: symbolPnl("PENGU"),
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    dogePnl: symbolPnl("DOGE"),
    penguTrades: symbolTrades("PENGU"),
    ethTrades: symbolTrades("ETH"),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const tradeRows = [];

  const periodFilter = process.env.PERIOD?.trim();
  for (const period of PERIODS.filter((item) => !periodFilter || item.key === periodFilter)) {
    const base = {
      ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
      backtestStartTs: period.startTs,
      backtestEndTs: period.endTs,
    } satisfies HybridVariantOptions;
    const variants = [
      { key: "v7_current", options: { ...base, label: "v7_current" } },
      { key: `pengu_tiered_trail_${process.env.TIER_MODE || "wide"}`, options: { ...withPenguTieredTrail(base), label: `pengu_tiered_trail_${process.env.TIER_MODE || "wide"}` } },
    ] as const;

    const baseline = await runHybridBacktest("RETQ22", variants[0].options);
    const baselineSummary = summarize(baseline);
    rows.push({ period: period.key, variant: variants[0].key, delta: 0, ...baselineSummary });
    tradeRows.push(...baseline.trade_pairs.map((trade) => ({ period: period.key, variant: variants[0].key, ...trade })));
    console.log(`${period.key} v7_current end=${baselineSummary.endEquity}`);

    const result = await runHybridBacktest("RETQ22", variants[1].options);
    const summary = summarize(result);
    rows.push({
      period: period.key,
      variant: variants[1].key,
      delta: round(summary.endEquity - baselineSummary.endEquity),
      ...summary,
    });
    tradeRows.push(...result.trade_pairs.map((trade) => ({ period: period.key, variant: variants[1].key, ...trade })));
    console.log(`${period.key} pengu_tiered_trail end=${summary.endEquity} delta=${round(summary.endEquity - baselineSummary.endEquity)}`);
  }

  const md = [
    "# V7 PENGU Tiered Trail Focused",
    "",
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", options)`",
    `- tier_mode: ${process.env.TIER_MODE || "wide"}`,
    "- wide: 6%/3%, 15%/5%, 30%/8%",
    "- mild: 6%/3%, 30%/5%",
    "- late: 6%/3%, 45%/8%",
    "",
    "| period | variant | End Equity | delta | MaxDD % | PF | trades | exposure % | PENGU PnL | ETH PnL | PENGU trades |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.period} | ${row.variant} | ${row.endEquity.toLocaleString()} | ${row.delta.toLocaleString()} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.exposurePct} | ${row.penguPnl.toLocaleString()} | ${row.ethPnl.toLocaleString()} | ${row.penguTrades} |`),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
