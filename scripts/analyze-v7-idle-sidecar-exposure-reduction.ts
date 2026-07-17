import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-idle-1h-breakout-shortlist");
const STEP_MS = 12 * 60 * 60 * 1000;
const SYMBOLS = ["BIO", "PROVE", "ALLO"] as const;

const PERIODS = [
  { key: "2025", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 3, 23, 23, 59, 59, 999) },
];

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
  return windows.filter((window) => window.endTs > window.startTs);
}

function sidecarOptions(base: HybridVariantOptions, windows: readonly Window[]) {
  return {
    ...base,
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "1h",
    idleBreakoutSymbols: SYMBOLS,
    idleBreakoutAllowedWindows: windows,
    idleBreakoutAllowTradeGateOff: false,
    idleBreakoutBreakoutLookbackBars: 4,
    idleBreakoutBreakoutMinPct: 0.006,
    idleBreakoutMinVolumeRatio: 1.03,
    idleBreakoutMinMomAccel: 0.0003,
    idleBreakoutMinEfficiencyRatio: 0.1,
    idleBreakoutProfitTrailActivationPct: 0.04,
    idleBreakoutProfitTrailRetracePct: 0.025,
    idleBreakoutMaxHoldBars: 4,
    idleBreakoutWeakExitMom20Below: 0.015,
    idleBreakoutWeakExitMomAccelBelow: -0.005,
    idleBreakoutWeakExitMinHoldBars: 2,
    idleBreakoutWeakExitRequireCloseBelowSma40: true,
  } satisfies HybridVariantOptions;
}

function totalHours(startTs: number, endTs: number) {
  return (endTs - startTs + 1) / 3_600_000;
}

function tradeHours(trade: { entry_time: string; exit_time: string }) {
  return Math.max(0, Date.parse(trade.exit_time) - Date.parse(trade.entry_time)) / 3_600_000;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];

  for (const period of PERIODS) {
    const base = baseOptions(period);
    const baseline = await runHybridBacktest("RETQ22", { ...base, label: `v7_base_${period.key}` });
    const windows = cashWindowsFromBaseline(baseline);
    const sidecar = await runHybridBacktest("RETQ22", {
      ...sidecarOptions(base, windows),
      label: `v7_sidecar_bio_prove_allo_scalp_${period.key}`,
    });
    const trades = sidecar.trade_pairs.filter((trade) => SYMBOLS.includes(trade.symbol as typeof SYMBOLS[number]));
    const addedExposureHours = trades.reduce((sum, trade) => sum + tradeHours(trade), 0);
    const periodHours = totalHours(period.startTs, period.endTs);
    const baseCashPct = 100 - baseline.summary.exposure_pct;
    const reducedCashPct = Math.max(0, baseCashPct - (addedExposureHours / periodHours) * 100);
    rows.push({
      period: period.key,
      baselineExposurePct: round(baseline.summary.exposure_pct),
      baselineCashPct: round(baseCashPct),
      sidecarTrades: trades.length,
      addedExposureHours: round(addedExposureHours),
      addedExposureDays: round(addedExposureHours / 24),
      addedExposurePct: round((addedExposureHours / periodHours) * 100, 3),
      estimatedCashPctAfterSidecar: round(reducedCashPct),
      cashPctReductionPoint: round(baseCashPct - reducedCashPct, 3),
      bySymbol: Object.fromEntries(SYMBOLS.map((symbol) => [
        symbol,
        {
          trades: trades.filter((trade) => trade.symbol === symbol).length,
          hours: round(trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + tradeHours(trade), 0)),
        },
      ])),
    });
    console.log(`${period.key}: cash ${round(baseCashPct)}% -> ${round(reducedCashPct)}%, reduction=${round(baseCashPct - reducedCashPct, 3)}pt, trades=${trades.length}`);
  }

  const md = [
    "# V7 BIO/PROVE/ALLO Sidecar Exposure Reduction",
    "",
    "- method: engine-direct trade extraction for BIO + PROVE + ALLO 1h scalp sidecar",
    "- assumption: V7 production logic remains unchanged; sidecar only uses periods that V7 is in cash/USDT",
    "- sidecar: 1h, lookback 4, breakout 0.6%, volume 1.03, trail 4%/2.5%, max hold 4h",
    "",
    "| period | V7 exposure % | V7 USDT % | sidecar trades | added days | added exposure % | estimated USDT % after | USDT reduction pt |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.period} | ${row.baselineExposurePct} | ${row.baselineCashPct} | ${row.sidecarTrades} | ${row.addedExposureDays} | ${row.addedExposurePct} | ${row.estimatedCashPctAfterSidecar} | ${row.cashPctReductionPoint} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "sidecar-exposure-reduction.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "sidecar-exposure-reduction.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
