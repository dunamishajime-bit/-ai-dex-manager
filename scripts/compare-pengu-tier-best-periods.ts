import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";

type Window = { startTs: number; endTs: number };
type Period = { key: string; start: string; end: string };

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-tier-best-periods");
const STEP_MS = 12 * 60 * 60 * 1000;

const PERIODS: Period[] = [
  { key: "2022", start: "2022-01-01", end: "2022-12-31" },
  { key: "2023", start: "2023-01-01", end: "2023-12-31" },
  { key: "2024_H1", start: "2024-01-01", end: "2024-06-30" },
  { key: "2024_H2", start: "2024-07-01", end: "2024-12-31" },
  { key: "2025_H1", start: "2025-01-01", end: "2025-06-30" },
  { key: "2025_H2", start: "2025-07-01", end: "2025-12-31" },
  { key: "2026_YTD", start: "2026-01-01", end: "2026-04-23" },
  { key: "full", start: "2022-01-01", end: "2026-04-23" },
];

const CUMULATIVE_PERIODS: Period[] = [
  { key: "cum_to_2023", start: "2022-01-01", end: "2023-12-31" },
  { key: "cum_to_2024_H1", start: "2022-01-01", end: "2024-06-30" },
  { key: "cum_to_2024_H2", start: "2022-01-01", end: "2024-12-31" },
  { key: "cum_to_2025_H1", start: "2022-01-01", end: "2025-06-30" },
  { key: "cum_to_2025_H2", start: "2022-01-01", end: "2025-12-31" },
  { key: "cum_to_2026_YTD", start: "2022-01-01", end: "2026-04-23" },
];

const BEST_PENGU_TIER: HybridVariantOptions = {
  idleBreakoutTieredTrailBySymbol: {
    PENGU: [
      { activationPct: 0.05, retracePct: 0.025 },
      { activationPct: 0.18, retracePct: 0.0475 },
      { activationPct: 0.21, retracePct: 0.07 },
      { activationPct: 0.6, retracePct: 0.16 },
    ],
  },
};

function tsStart(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function tsEnd(date: string) {
  return Date.parse(`${date}T23:59:59.999Z`);
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildCashOnlyWindows(points: Array<{ ts: number; decision: { desiredSymbol: string; desiredSide: string } }>) {
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

  if (start != null) windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  return windows;
}

function invertWindows(windows: readonly Window[], startTs: number, endTs: number) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
  let cursor = startTs;
  for (const window of sorted) {
    if (window.startTs > cursor) inverted.push({ startTs: cursor, endTs: window.startTs });
    cursor = Math.max(cursor, window.endTs);
  }
  if (cursor < endTs) inverted.push({ startTs: cursor, endTs });
  return inverted.filter((window) => window.endTs > window.startTs);
}

function cashWindowCachePath(startTs: number, endTs: number, baseOptions: HybridVariantOptions) {
  const payload = JSON.stringify({ v: 1, startTs, endTs, baseOptions });
  const key = crypto.createHash("sha1").update(payload).digest("hex");
  return path.join(process.cwd(), ".cache", "hybrid-live-equivalent-windows", `${key}.json`);
}

async function loadOrBuildNonCashWindows(startTs: number, endTs: number, baseOptions: HybridVariantOptions) {
  const filePath = cashWindowCachePath(startTs, endTs, baseOptions);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return (JSON.parse(raw) as { nonCashWindows: Window[] }).nonCashWindows;
  } catch {
    const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", baseOptions);
    const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
    const nonCashWindows = invertWindows(cashOnlyWindows, startTs, endTs);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ cashOnlyWindows, nonCashWindows }), "utf8");
    return nonCashWindows;
  }
}

async function makeLiveEquivalentOptions(period: Period, rescuePatch: HybridVariantOptions = {}) {
  const startTs = tsStart(period.start);
  const endTs = tsEnd(period.end);
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: startTs,
    backtestEndTs: endTs,
  } satisfies HybridVariantOptions;
  const rescue = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    ...rescuePatch,
    backtestStartTs: startTs,
    backtestEndTs: endTs,
  } satisfies HybridVariantOptions;
  const nonCashWindows = await loadOrBuildNonCashWindows(startTs, endTs, base);
  return {
    ...rescue,
    trendSymbolBlockWindows: {
      UNI: nonCashWindows,
      TWT: nonCashWindows,
      ...(rescue.trendSymbolBlockWindows ?? {}),
    },
  } satisfies HybridVariantOptions;
}

function summarize(period: Period, variant: string, result: Awaited<ReturnType<typeof runHybridBacktest>>, elapsedMs: number) {
  return {
    period: period.key,
    variant,
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    PENGU: round(result.summary.symbol_contribution.PENGU ?? 0),
    ETH: round(result.summary.symbol_contribution.ETH ?? 0),
    DOGE: round(result.summary.symbol_contribution.DOGE ?? 0),
    elapsedSec: round(elapsedMs / 1000, 1),
  };
}

function toMarkdown(rows: ReturnType<typeof summarize>[]) {
  const deltas = PERIODS.map((period) => {
    const base = rows.find((row) => row.period === period.key && row.variant === "baseline");
    const best = rows.find((row) => row.period === period.key && row.variant === "pengu_tier_best");
    if (!base || !best) return null;
    return {
      period: period.key,
      baseline: base.endEquity,
      best: best.endEquity,
      delta: round(best.endEquity - base.endEquity),
      basePf: base.profitFactor,
      bestPf: best.profitFactor,
      baseDd: base.maxDrawdownPct,
      bestDd: best.maxDrawdownPct,
      baseTrades: base.trades,
      bestTrades: best.trades,
    };
  }).filter((row): row is NonNullable<typeof row> => row != null);
  const cumulativeDeltas = CUMULATIVE_PERIODS.map((period) => {
    const base = rows.find((row) => row.period === period.key && row.variant === "baseline");
    const best = rows.find((row) => row.period === period.key && row.variant === "pengu_tier_best");
    if (!base || !best) return null;
    return {
      period: period.key,
      baseline: base.endEquity,
      best: best.endEquity,
      delta: round(best.endEquity - base.endEquity),
      deltaPct: round(((best.endEquity / base.endEquity) - 1) * 100),
      basePf: base.profitFactor,
      bestPf: best.profitFactor,
      baseDd: base.maxDrawdownPct,
      bestDd: best.maxDrawdownPct,
    };
  }).filter((row): row is NonNullable<typeof row> => row != null);

  return [
    "# V7 PENGU Tier Best Period Compare",
    "",
    "- Method: engine-direct live-equivalent V7 cash rescue.",
    "- Candidate: PENGU tiered trail 5%/2.5%, 18%/4.75%, 21%/7%, 60%/16%.",
    "",
    "## Delta",
    "",
    "| period | baseline End | candidate End | delta | baseline PF | candidate PF | baseline MaxDD % | candidate MaxDD % | trades base/candidate |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...deltas.map((row) => [
      row.period,
      row.baseline.toLocaleString(),
      row.best.toLocaleString(),
      row.delta.toLocaleString(),
      row.basePf,
      row.bestPf,
      row.baseDd,
      row.bestDd,
      `${row.baseTrades}/${row.bestTrades}`,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## Cumulative From 2022",
    "",
    "| period | baseline End | candidate End | delta | delta % | baseline PF | candidate PF | baseline MaxDD % | candidate MaxDD % |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...cumulativeDeltas.map((row) => [
      row.period,
      row.baseline.toLocaleString(),
      row.best.toLocaleString(),
      row.delta.toLocaleString(),
      row.deltaPct,
      row.basePf,
      row.bestPf,
      row.baseDd,
      row.bestDd,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## Raw",
    "",
    "| period | variant | End Equity | PF | MaxDD % | trades | exposure % | PENGU | ETH | DOGE | elapsed s |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => [
      row.period,
      row.variant,
      row.endEquity.toLocaleString(),
      row.profitFactor,
      row.maxDrawdownPct,
      row.trades,
      row.exposurePct,
      row.PENGU.toLocaleString(),
      row.ETH.toLocaleString(),
      row.DOGE.toLocaleString(),
      row.elapsedSec,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows: ReturnType<typeof summarize>[] = [];
  for (const period of [...PERIODS, ...CUMULATIVE_PERIODS]) {
    for (const variant of ["baseline", "pengu_tier_best"] as const) {
      const options = await makeLiveEquivalentOptions(period, variant === "pengu_tier_best" ? BEST_PENGU_TIER : {});
      const started = Date.now();
      const result = await runHybridBacktest("RETQ22", {
        ...options,
        label: `${period.key}_${variant}`,
      });
      const row = summarize(period, variant, result, Date.now() - started);
      rows.push(row);
      console.log(`${period.key} ${variant}: ${row.endEquity.toLocaleString()}`);
      await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
      await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
    }
  }
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
