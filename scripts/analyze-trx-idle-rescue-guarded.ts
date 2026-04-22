import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "trx-idle-rescue-guarded");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const BAR_MS = 12 * 60 * 60 * 1000;

type IdleWindow = {
  startTs: number;
  endTs: number;
  bars: number;
};

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

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

function buildIdleWindowsFromEquityCurve(
  equityCurve: Awaited<ReturnType<typeof runHybridBacktest>>["equity_curve"],
) {
  const windows: IdleWindow[] = [];
  let windowStartTs: number | null = null;

  for (const point of equityCurve) {
    const isCash = point.position_side === "cash";
    if (isCash && windowStartTs == null) {
      windowStartTs = point.ts;
      continue;
    }

    if (!isCash && windowStartTs != null) {
      const bars = Math.max(1, Math.round((point.ts - windowStartTs) / BAR_MS));
      windows.push({
        startTs: windowStartTs,
        endTs: point.ts,
        bars,
      });
      windowStartTs = null;
    }
  }

  if (windowStartTs != null) {
    const bars = Math.max(1, Math.round((END_TS - windowStartTs) / BAR_MS));
    windows.push({
      startTs: windowStartTs,
      endTs: END_TS,
      bars,
    });
  }

  return windows.filter((window) => window.bars >= 2);
}

function toAllowedWindows(windows: readonly IdleWindow[], minBars: number) {
  return windows
    .filter((window) => window.bars >= minBars)
    .map((window) => ({ startTs: window.startTs, endTs: window.endTs }));
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", {
    ...baseOptions(),
    label: "base_v7_trx_idle_rescue_guarded",
  });
  const idleWindows = buildIdleWindowsFromEquityCurve(baseline.equity_curve);

  const sharedCore: HybridVariantOptions = {
    ...baseOptions(),
    idleBreakoutEntryWhileCash: true,
    idleBreakoutSymbols: ["TRX"],
    idleBreakoutEntryTimeframe: "6h",
    idleBreakoutAllowTradeGateOff: true,
    idleBreakoutBreakoutLookbackBars: 4,
    idleBreakoutBreakoutMinPct: 0.002,
    idleBreakoutMinVolumeRatio: 0.95,
    idleBreakoutMinMomAccel: -0.006,
    idleBreakoutMinEfficiencyRatio: 0.06,
    idleBreakoutProfitTrailActivationPct: 0.08,
    idleBreakoutProfitTrailRetracePct: 0.09,
  };

  const variants: VariantSpec[] = [
    {
      key: "trx_idle_rescue_long_idle_4bars",
      thesis: "Allow TRX rescue only inside baseline idle windows lasting at least 4 decision bars.",
      options: {
        ...sharedCore,
        label: "trx_idle_rescue_long_idle_4bars",
        idleBreakoutAllowedWindows: toAllowedWindows(idleWindows, 4),
        idleBreakoutMaxHoldBars: 6,
      },
    },
    {
      key: "trx_idle_rescue_long_idle_6bars",
      thesis: "Allow TRX rescue only inside longer idle windows lasting at least 6 decision bars.",
      options: {
        ...sharedCore,
        label: "trx_idle_rescue_long_idle_6bars",
        idleBreakoutAllowedWindows: toAllowedWindows(idleWindows, 6),
        idleBreakoutMaxHoldBars: 6,
      },
    },
    {
      key: "trx_idle_rescue_long_idle_4bars_fast",
      thesis: "Long-idle-only TRX rescue with shorter hold to release capital back to main symbols faster.",
      options: {
        ...sharedCore,
        label: "trx_idle_rescue_long_idle_4bars_fast",
        idleBreakoutAllowedWindows: toAllowedWindows(idleWindows, 4),
        idleBreakoutMaxHoldBars: 4,
        idleBreakoutProfitTrailActivationPct: 0.06,
        idleBreakoutProfitTrailRetracePct: 0.08,
      },
    },
  ];

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", {
      ...variant.options,
      label: variant.key,
    });
    const trxTrades = result.trade_pairs.filter((trade) => trade.symbol === "TRX");
    const idleTrades = trxTrades.filter((trade) => trade.sub_variant === "idle-breakout");
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      endEquity: round(result.summary.end_equity),
      deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      tradeCount: result.summary.trade_count,
      trxTradeCount: trxTrades.length,
      trxPnl: round(result.summary.symbol_contribution.TRX ?? 0),
      idleBreakoutTradeCount: idleTrades.length,
      exposurePct: round(result.summary.exposure_pct),
    });
  }

  const md = [
    "# TRX Idle Rescue Guarded Variants",
    "",
    "## Baseline",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- end_equity: ${round(baseline.summary.end_equity)}`,
    `- cagr_pct: ${round(baseline.summary.cagr_pct)}%`,
    `- max_drawdown_pct: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- profit_factor: ${round(baseline.summary.profit_factor, 3)}`,
    `- trade_count: ${baseline.summary.trade_count}`,
    `- idle_window_count: ${idleWindows.length}`,
    "",
    "## Variants",
    "",
    "| variant | thesis | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TRX trades | TRX pnl | idle-breakout trades | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.deltaEndEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.trxTradeCount} | ${row.trxPnl} | ${row.idleBreakoutTradeCount} | ${row.exposurePct} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: baseline.summary,
    results: rows,
    idleWindows,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({
    baseline: {
      endEquity: round(baseline.summary.end_equity),
      cagrPct: round(baseline.summary.cagr_pct),
      maxDrawdownPct: round(baseline.summary.max_drawdown_pct),
      profitFactor: round(baseline.summary.profit_factor, 3),
      tradeCount: baseline.summary.trade_count,
    },
    results: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
