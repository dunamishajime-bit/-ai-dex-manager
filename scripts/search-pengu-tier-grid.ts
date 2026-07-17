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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-tier-grid");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

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

function cashWindowCachePath(baseOptions: HybridVariantOptions) {
  const payload = JSON.stringify({ v: 1, startTs: START_TS, endTs: END_TS, baseOptions });
  const key = crypto.createHash("sha1").update(payload).digest("hex");
  return path.join(process.cwd(), ".cache", "hybrid-live-equivalent-windows", `${key}.json`);
}

async function loadOrBuildNonCashWindows(baseOptions: HybridVariantOptions) {
  const filePath = cashWindowCachePath(baseOptions);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return (JSON.parse(raw) as { nonCashWindows: Window[] }).nonCashWindows;
  } catch {
    const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", baseOptions);
    const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
    const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ cashOnlyWindows, nonCashWindows }), "utf8");
    return nonCashWindows;
  }
}

async function makeLiveEquivalentOptions(rescuePatch: HybridVariantOptions = {}) {
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const rescue = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    ...rescuePatch,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const nonCashWindows = await loadOrBuildNonCashWindows(base);
  return {
    ...rescue,
    trendSymbolBlockWindows: {
      UNI: nonCashWindows,
      TWT: nonCashWindows,
      ...(rescue.trendSymbolBlockWindows ?? {}),
    },
  } satisfies HybridVariantOptions;
}

function toMarkdown(rows: Array<Record<string, number | string>>) {
  return [
    "# V7 PENGU Tier Grid",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "",
    "| key | End Equity | gap to 10M | PF | MaxDD % | trades | PENGU | ETH | DOGE | elapsed s |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => [
      row.key,
      Number(row.endEquity).toLocaleString(),
      Number(row.deltaTo10m).toLocaleString(),
      row.profitFactor,
      row.maxDrawdownPct,
      row.trades,
      Number(row.PENGU).toLocaleString(),
      Number(row.ETH).toLocaleString(),
      Number(row.DOGE).toLocaleString(),
      row.elapsedSec,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows: Array<Record<string, number | string>> = [];
  const firstActivations = [0.05, 0.055, 0.06, 0.065];
  const firstRetraces = [0.025, 0.03, 0.035];
  const secondActivations = [0.18, 0.19];
  const secondRetraces = [0.0475, 0.05, 0.0525];
  const thirdActivations = [0.21, 0.22, 0.23];
  const thirdRetraces = [0.07, 0.075];

  for (const firstActivation of firstActivations) {
    for (const firstRetrace of firstRetraces) {
      for (const secondActivation of secondActivations) {
        for (const secondRetrace of secondRetraces) {
          for (const thirdActivation of thirdActivations) {
            for (const thirdRetrace of thirdRetraces) {
              const key = `tier_${Math.round(firstActivation * 1000)}_${Math.round(firstRetrace * 1000)}_${Math.round(secondActivation * 100)}_${Math.round(secondRetrace * 1000)}_${Math.round(thirdActivation * 100)}_${Math.round(thirdRetrace * 1000)}`;
        const options = await makeLiveEquivalentOptions({
          idleBreakoutTieredTrailBySymbol: {
            PENGU: [
              { activationPct: firstActivation, retracePct: firstRetrace },
              { activationPct: secondActivation, retracePct: secondRetrace },
              { activationPct: thirdActivation, retracePct: thirdRetrace },
              { activationPct: 0.6, retracePct: 0.16 },
            ],
          },
        });
        const started = Date.now();
        const result = await runHybridBacktest("RETQ22", { ...options, label: key });
        const row = {
          key,
          elapsedSec: round((Date.now() - started) / 1000, 1),
          endEquity: round(result.summary.end_equity),
          deltaTo10m: round(10_000_000 - result.summary.end_equity),
          profitFactor: round(result.summary.profit_factor, 3),
          maxDrawdownPct: round(result.summary.max_drawdown_pct),
          trades: result.summary.trade_count,
          PENGU: round(result.summary.symbol_contribution.PENGU ?? 0),
          ETH: round(result.summary.symbol_contribution.ETH ?? 0),
          DOGE: round(result.summary.symbol_contribution.DOGE ?? 0),
        };
        rows.push(row);
        rows.sort((left, right) => Number(right.endEquity) - Number(left.endEquity));
        await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows.slice(0, 30)), "utf8");
        await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
        console.log(`${key}: ${row.endEquity.toLocaleString()}`);
      }
    }
    }
      }
    }
  }
  console.log(toMarkdown(rows.slice(0, 30)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
