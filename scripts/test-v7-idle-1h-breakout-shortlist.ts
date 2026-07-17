import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-idle-1h-breakout-shortlist");
const STEP_MS = 12 * 60 * 60 * 1000;
const CANDIDATES = ["ZBT", "BIO", "ALLO", "PROVE"] as const;

const PERIODS = [
  { key: "2024-H1", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 5, 30, 23, 59, 59, 999) },
  { key: "2024-H2", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 3, 23, 23, 59, 59, 999) },
];

const VARIANTS = [
  {
    key: "scalp_4hld",
    lookback: 4,
    breakout: 0.006,
    volume: 1.03,
    momAccel: 0.0003,
    efficiency: 0.1,
    trailActivation: 0.04,
    trailRetrace: 0.025,
    maxHold: 4,
  },
  {
    key: "fast_8hld",
    lookback: 6,
    breakout: 0.008,
    volume: 1.05,
    momAccel: 0.0005,
    efficiency: 0.12,
    trailActivation: 0.06,
    trailRetrace: 0.035,
    maxHold: 8,
  },
  {
    key: "balanced_12hld",
    lookback: 8,
    breakout: 0.01,
    volume: 1.08,
    momAccel: 0.0008,
    efficiency: 0.16,
    trailActivation: 0.08,
    trailRetrace: 0.04,
    maxHold: 12,
  },
  {
    key: "quality_16hld",
    lookback: 10,
    breakout: 0.012,
    volume: 1.12,
    momAccel: 0.001,
    efficiency: 0.2,
    trailActivation: 0.1,
    trailRetrace: 0.05,
    maxHold: 16,
  },
] as const;

type Window = { startTs: number; endTs: number };

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(period: typeof PERIODS[number]): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: period.startTs,
    backtestEndTs: period.endTs,
  };
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const points = result.equity_curve.sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const point of points) {
    if (point.position_side === "cash") {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) {
      windows.push({ startTs: start, endTs: prev + STEP_MS });
      start = null;
      prev = null;
    }
  }
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS });
  return windows.filter((window) => window.endTs - window.startTs >= 60 * 60 * 1000);
}

function variantOptions(
  base: HybridVariantOptions,
  windows: readonly Window[],
  variant: typeof VARIANTS[number],
  symbols: readonly string[],
) {
  return {
    ...base,
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "1h",
    idleBreakoutSymbols: symbols,
    idleBreakoutAllowedWindows: windows,
    idleBreakoutAllowTradeGateOff: false,
    idleBreakoutBreakoutLookbackBars: variant.lookback,
    idleBreakoutBreakoutMinPct: variant.breakout,
    idleBreakoutMinVolumeRatio: variant.volume,
    idleBreakoutMinMomAccel: variant.momAccel,
    idleBreakoutMinEfficiencyRatio: variant.efficiency,
    idleBreakoutProfitTrailActivationPct: variant.trailActivation,
    idleBreakoutProfitTrailRetracePct: variant.trailRetrace,
    idleBreakoutMaxHoldBars: variant.maxHold,
    idleBreakoutWeakExitMom20Below: 0.015,
    idleBreakoutWeakExitMomAccelBelow: -0.005,
    idleBreakoutWeakExitMinHoldBars: 2,
    idleBreakoutWeakExitRequireCloseBelowSma40: true,
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>, symbols: readonly string[]) {
  return {
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    candidatePnl: round(symbols.reduce((total, symbol) => total + (result.summary.symbol_contribution[symbol] ?? 0), 0)),
    candidateTrades: result.trade_pairs.filter((trade) => symbols.includes(trade.symbol)).length,
    bySymbol: Object.fromEntries(symbols.map((symbol) => [
      symbol,
      {
        pnl: round(result.summary.symbol_contribution[symbol] ?? 0),
        trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
      },
    ])),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];

  for (const period of PERIODS) {
    const base = baseOptions(period);
    const baseline = await runHybridBacktest("RETQ22", { ...base, label: `v7_base_${period.key}` });
    const windows = cashWindowsFromBaseline(baseline);
    rows.push({
      period: period.key,
      variant: "v7_current",
      symbols: [],
      windows: windows.length,
      summary: summarize(baseline, []),
    });

    for (const variant of VARIANTS) {
      const basket = await runHybridBacktest("RETQ22", {
        ...variantOptions(base, windows, variant, CANDIDATES),
        label: `v7_idle_1h_${variant.key}_${period.key}`,
      });
      rows.push({
        period: period.key,
        variant: `basket_${variant.key}`,
        symbols: [...CANDIDATES],
        windows: windows.length,
        deltaEndEquity: round(basket.summary.end_equity - baseline.summary.end_equity),
        summary: summarize(basket, CANDIDATES),
      });
      console.log(`${period.key} basket ${variant.key}: end=${round(basket.summary.end_equity)} delta=${round(basket.summary.end_equity - baseline.summary.end_equity)} pnl=${round(summarize(basket, CANDIDATES).candidatePnl)}`);

      for (const symbol of CANDIDATES) {
        const result = await runHybridBacktest("RETQ22", {
          ...variantOptions(base, windows, variant, [symbol]),
          label: `v7_idle_1h_${symbol.toLowerCase()}_${variant.key}_${period.key}`,
        });
        rows.push({
          period: period.key,
          variant: `${symbol}_${variant.key}`,
          symbols: [symbol],
          windows: windows.length,
          deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
          summary: summarize(result, [symbol]),
        });
        console.log(`${period.key} ${symbol} ${variant.key}: end=${round(result.summary.end_equity)} delta=${round(result.summary.end_equity - baseline.summary.end_equity)} pnl=${round(result.summary.symbol_contribution[symbol] ?? 0)}`);
      }
    }
  }

  const md = [
    "# V7 Idle 1h Breakout Shortlist",
    "",
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", options)`",
    "- candidates: ZBT / BIO / ALLO / PROVE",
    "- scope: V7 cash windows only",
    "- note: this tests a sidecar 1h idle-breakout profile. Current engine has one idleBreakout slot, so this is candidate-edge testing before production integration design.",
    "",
    "| period | variant | end equity | delta | MaxDD % | PF | trades | exposure % | candidate PnL | candidate trades |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row: any) => `| ${row.period} | ${row.variant} | ${row.summary.endEquity} | ${row.deltaEndEquity ?? 0} | ${row.summary.maxDrawdownPct} | ${row.summary.profitFactor} | ${row.summary.trades} | ${row.summary.exposurePct} | ${row.summary.candidatePnl} | ${row.summary.candidateTrades} |`),
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
