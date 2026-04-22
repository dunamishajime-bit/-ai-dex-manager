import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "twt-idle-rescue-v2");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

type Window = {
  startTs: number;
  endTs: number;
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

function buildCashOnlyWindows(
  points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>,
) {
  const cashPoints = points
    .filter((point) => point.decision.desiredSymbol === "USDT" && point.decision.desiredSide === "cash")
    .sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const point of cashPoints) {
    if (start == null) {
      start = point.ts;
      prev = point.ts;
      continue;
    }

    if (prev != null && point.ts - prev <= STEP_MS) {
      prev = point.ts;
      continue;
    }

    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
    start = point.ts;
    prev = point.ts;
  }

  if (start != null) {
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  }

  return windows;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = baseOptions();
  const baseline = await runHybridBacktest("RETQ22", {
    ...base,
    label: "base_v7_twt_idle_rescue_v2",
  });
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);

  const shared: HybridVariantOptions = {
    ...base,
    idleBreakoutEntryWhileCash: true,
    idleBreakoutSymbols: ["TWT"],
    idleBreakoutAllowedWindows: cashOnlyWindows,
    idleBreakoutEntryTimeframe: "6h",
    idleBreakoutAllowTradeGateOff: true,
  };

  const variants: VariantSpec[] = [
    {
      key: "twt_idle_rescue_v2_balanced",
      thesis: "6H rescue breakout for TWT during cash-only windows with light gate bypass and short hold.",
      options: {
        ...shared,
        label: "twt_idle_rescue_v2_balanced",
        idleBreakoutBreakoutLookbackBars: 4,
        idleBreakoutBreakoutMinPct: 0.008,
        idleBreakoutMinVolumeRatio: 0.95,
        idleBreakoutMinMomAccel: -0.001,
        idleBreakoutMinEfficiencyRatio: 0.1,
        idleBreakoutProfitTrailActivationPct: 0.1,
        idleBreakoutProfitTrailRetracePct: 0.06,
        idleBreakoutMaxHoldBars: 4,
      },
    },
    {
      key: "twt_idle_rescue_v2_soft",
      thesis: "More permissive TWT rescue that prioritizes capturing short cash-window breakouts.",
      options: {
        ...shared,
        label: "twt_idle_rescue_v2_soft",
        idleBreakoutBreakoutLookbackBars: 3,
        idleBreakoutBreakoutMinPct: 0.006,
        idleBreakoutMinVolumeRatio: 0.9,
        idleBreakoutMinMomAccel: -0.002,
        idleBreakoutMinEfficiencyRatio: 0.08,
        idleBreakoutProfitTrailActivationPct: 0.08,
        idleBreakoutProfitTrailRetracePct: 0.06,
        idleBreakoutMaxHoldBars: 4,
      },
    },
    {
      key: "twt_idle_rescue_v2_confirmed",
      thesis: "More confirmed rescue entry with slightly stronger breakout quality and tighter time stop.",
      options: {
        ...shared,
        label: "twt_idle_rescue_v2_confirmed",
        idleBreakoutBreakoutLookbackBars: 5,
        idleBreakoutBreakoutMinPct: 0.01,
        idleBreakoutMinVolumeRatio: 1,
        idleBreakoutMinMomAccel: 0,
        idleBreakoutMinEfficiencyRatio: 0.12,
        idleBreakoutProfitTrailActivationPct: 0.1,
        idleBreakoutProfitTrailRetracePct: 0.05,
        idleBreakoutMaxHoldBars: 3,
      },
    },
    {
      key: "twt_idle_rescue_v2_fast",
      thesis: "Fast breakout rescue with shallow trail and short max hold to mimic quick TWT bursts.",
      options: {
        ...shared,
        label: "twt_idle_rescue_v2_fast",
        idleBreakoutBreakoutLookbackBars: 4,
        idleBreakoutBreakoutMinPct: 0.007,
        idleBreakoutMinVolumeRatio: 0.95,
        idleBreakoutMinMomAccel: -0.0015,
        idleBreakoutMinEfficiencyRatio: 0.09,
        idleBreakoutProfitTrailActivationPct: 0.07,
        idleBreakoutProfitTrailRetracePct: 0.045,
        idleBreakoutMaxHoldBars: 3,
      },
    },
  ];

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const trades = result.trade_pairs.filter((trade) => trade.symbol === "TWT");
    const wins = trades.filter((trade) => trade.net_pnl > 0).length;
    const losses = trades.filter((trade) => trade.net_pnl <= 0).length;
    const idleBreakoutTrades = trades.filter((trade) => trade.sub_variant === "idle-breakout");

    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      endEquity: round(result.summary.end_equity),
      deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      winRatePct: round(result.summary.win_rate_pct),
      tradeCount: result.summary.trade_count,
      twtTradeCount: trades.length,
      twtWins: wins,
      twtLosses: losses,
      twtPnl: round(result.summary.symbol_contribution.TWT ?? 0),
      idleBreakoutTradeCount: idleBreakoutTrades.length,
      exposurePct: round(result.summary.exposure_pct),
    });
  }

  rows.sort((left, right) => Number(right.deltaEndEquity) - Number(left.deltaEndEquity));

  const md = [
    "# TWT Idle Rescue v2",
    "",
    "## Baseline",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- cash_window_count: ${cashOnlyWindows.length}`,
    `- end_equity: ${round(baseline.summary.end_equity)}`,
    `- cagr_pct: ${round(baseline.summary.cagr_pct)}%`,
    `- max_drawdown_pct: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- profit_factor: ${round(baseline.summary.profit_factor, 3)}`,
    `- trade_count: ${baseline.summary.trade_count}`,
    "",
    "## Variants",
    "",
    "| variant | thesis | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TWT trades | TWT wins | TWT losses | TWT pnl | idle-breakout trades | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.deltaEndEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.twtTradeCount} | ${row.twtWins} | ${row.twtLosses} | ${row.twtPnl} | ${row.idleBreakoutTradeCount} | ${row.exposurePct} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: {
      endEquity: round(baseline.summary.end_equity),
      cagrPct: round(baseline.summary.cagr_pct),
      maxDrawdownPct: round(baseline.summary.max_drawdown_pct),
      profitFactor: round(baseline.summary.profit_factor, 3),
      tradeCount: baseline.summary.trade_count,
      cashWindowCount: cashOnlyWindows.length,
    },
    results: rows,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({
    baseline: {
      endEquity: round(baseline.summary.end_equity),
      cagrPct: round(baseline.summary.cagr_pct),
      maxDrawdownPct: round(baseline.summary.max_drawdown_pct),
      profitFactor: round(baseline.summary.profit_factor, 3),
      tradeCount: baseline.summary.trade_count,
      cashWindowCount: cashOnlyWindows.length,
    },
    results: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
