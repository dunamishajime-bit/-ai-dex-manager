import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-idle-partial-engine");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
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

function cashWindowCachePath(baseOptions: unknown) {
  const payload = JSON.stringify({ v: 1, startTs: START_TS, endTs: END_TS, baseOptions });
  const key = crypto.createHash("sha1").update(payload).digest("hex");
  return path.join(process.cwd(), ".cache", "hybrid-live-equivalent-windows", `${key}.json`);
}

async function loadCashWindowSnapshot(baseOptions: HybridVariantOptions) {
  try {
    const raw = await fs.readFile(cashWindowCachePath(baseOptions), "utf8");
    return JSON.parse(raw) as { cashOnlyWindows: Window[]; nonCashWindows: Window[] };
  } catch {
    const cashOnlyWindows = buildCashOnlyWindows(await analyzeHybridDecisionWindow("RETQ22", baseOptions));
    const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
    await fs.mkdir(path.dirname(cashWindowCachePath(baseOptions)), { recursive: true });
    await fs.writeFile(cashWindowCachePath(baseOptions), JSON.stringify({ cashOnlyWindows, nonCashWindows }), "utf8");
    return { cashOnlyWindows, nonCashWindows };
  }
}

function summarize(label: string, result: Awaited<ReturnType<typeof runHybridBacktest>>, elapsedMs: number) {
  const pengu = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
  const partial = result.trade_pairs.filter((trade) => trade.exit_reason.includes("partial"));
  return {
    label,
    elapsedSec: round(elapsedMs / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    penguPnl: round(Number(result.summary.symbol_contribution.PENGU ?? 0)),
    penguTrades: pengu.length,
    penguWins: pengu.filter((trade) => trade.net_pnl > 0).length,
    penguLosses: pengu.filter((trade) => trade.net_pnl <= 0).length,
    partialTrades: partial.length,
    buybacks: result.trade_events.filter((trade) => trade.reason === "idle-breakout-partial-buyback").length,
  };
}

function toMarkdown(rows: ReturnType<typeof summarize>[]) {
  return [
    "# V7 PENGU Idle Partial Engine Backtest",
    "",
    "- method: engine-direct live-equivalent V7",
    "- cash rescue: live equivalent, UNI/TWT only during base USDT/cash windows",
    "- partial: PENGU idle-breakout partial close / runner / optional buyback",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | End Equity | delta vs base | MaxDD | PF | trades | PENGU PnL | PENGU trades | PENGU W/L | partial | buyback | elapsed |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row, index) => {
      const base = rows[0]?.endEquity ?? row.endEquity;
      return [
        row.label,
        row.endEquity.toLocaleString(),
        round(row.endEquity - base).toLocaleString(),
        `${row.maxDrawdownPct}%`,
        row.profitFactor,
        row.trades,
        row.penguPnl.toLocaleString(),
        row.penguTrades,
        `${row.penguWins}/${row.penguLosses}`,
        row.partialTrades,
        row.buybacks,
        `${row.elapsedSec}s`,
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |");
    }),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const rescue = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const { nonCashWindows } = await loadCashWindowSnapshot(base);
  const liveBase: HybridVariantOptions = {
    ...rescue,
    trendSymbolBlockWindows: {
      ...(rescue.trendSymbolBlockWindows ?? {}),
      UNI: nonCashWindows,
      TWT: nonCashWindows,
    },
  };
  const liveBaseNoPartial: HybridVariantOptions = {
    ...liveBase,
    partialExitBySymbol: undefined,
  };
  const variants: Array<{ label: string; options: HybridVariantOptions }> = [
    { label: "v7_current", options: liveBase },
    { label: "v7_no_partial", options: liveBaseNoPartial },
    {
      label: "best_combo4_from_no_partial_base",
      options: {
        ...liveBaseNoPartial,
        partialExitBySymbol: Object.fromEntries(
          ["DOGE", "TWT", "INJ", "AVAX"].map((symbol) => [
            symbol,
            {
              fraction: 0.5,
              baseTakeProfitPct: 0.12,
              strongTakeProfitPct: 0.22,
              strongMinMomAccel: 0.02,
              strongMinVolumeRatio: 1.25,
              stopAfterPartialPct: 0.04,
              runnerTrailActivationPct: 0.22,
              runnerTrailRetracePct: 0.08,
            },
          ]),
        ),
      },
    },
    ...[0.1, 0.12, 0.15, 0.18].flatMap((baseTakeProfitPct) =>
      [0.18, 0.22, 0.28, 0.35].flatMap((runnerTrailActivationPct) =>
        [0.08, 0.1, 0.12].map((runnerTrailRetracePct) => ({
          label: `combo4_grid_tp${Math.round(baseTakeProfitPct * 100)}_act${Math.round(runnerTrailActivationPct * 100)}_rt${Math.round(runnerTrailRetracePct * 100)}`,
          options: {
            ...liveBase,
            partialExitBySymbol: Object.fromEntries(
              ["DOGE", "TWT", "INJ", "AVAX"].map((symbol) => [
                symbol,
                {
                  fraction: 0.5,
                  baseTakeProfitPct,
                  strongTakeProfitPct: Math.max(baseTakeProfitPct + 0.08, runnerTrailActivationPct),
                  strongMinMomAccel: 0.02,
                  strongMinVolumeRatio: 1.25,
                  stopAfterPartialPct: Math.max(0.025, baseTakeProfitPct / 3),
                  runnerTrailActivationPct,
                  runnerTrailRetracePct,
                },
              ]),
            ),
          },
        })),
      ),
    ),
    {
      label: "non_pengu_partial_8pct_runner",
      options: {
        ...liveBase,
        partialExitBySymbol: Object.fromEntries(
          ["ETH", "SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT"].map((symbol) => [
            symbol,
            {
              fraction: 0.5,
              baseTakeProfitPct: 0.08,
              strongTakeProfitPct: 0.14,
              strongMinMomAccel: 0.015,
              strongMinVolumeRatio: 1.2,
              stopAfterPartialPct: 0.025,
              runnerTrailActivationPct: 0.16,
              runnerTrailRetracePct: 0.08,
            },
          ]),
        ),
      },
    },
    {
      label: "non_pengu_partial_12pct_runner",
      options: {
        ...liveBase,
        partialExitBySymbol: Object.fromEntries(
          ["ETH", "SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT"].map((symbol) => [
            symbol,
            {
              fraction: 0.5,
              baseTakeProfitPct: 0.12,
              strongTakeProfitPct: 0.2,
              strongMinMomAccel: 0.02,
              strongMinVolumeRatio: 1.25,
              stopAfterPartialPct: 0.04,
              runnerTrailActivationPct: 0.22,
              runnerTrailRetracePct: 0.1,
            },
          ]),
        ),
      },
    },
    {
      label: "non_pengu_partial_only_losers",
      options: {
        ...liveBase,
        partialExitBySymbol: Object.fromEntries(
          ["ETH", "AVAX", "INJ", "UNI", "TWT"].map((symbol) => [
            symbol,
            {
              fraction: 0.5,
              baseTakeProfitPct: 0.08,
              strongTakeProfitPct: 0.14,
              strongMinMomAccel: 0.015,
              strongMinVolumeRatio: 1.2,
              stopAfterPartialPct: 0.025,
              runnerTrailActivationPct: 0.16,
              runnerTrailRetracePct: 0.08,
            },
          ]),
        ),
      },
    },
    {
      label: "non_pengu_partial_sol_doge",
      options: {
        ...liveBase,
        partialExitBySymbol: Object.fromEntries(
          ["SOL", "DOGE"].map((symbol) => [
            symbol,
            {
              fraction: 0.5,
              baseTakeProfitPct: 0.12,
              strongTakeProfitPct: 0.22,
              strongMinMomAccel: 0.02,
              strongMinVolumeRatio: 1.25,
              stopAfterPartialPct: 0.04,
              runnerTrailActivationPct: 0.24,
              runnerTrailRetracePct: 0.11,
            },
          ]),
        ),
      },
    },
    ...[
      ["DOGE", "TWT"],
      ["DOGE", "INJ"],
      ["DOGE", "AVAX"],
      ["DOGE", "TWT", "INJ"],
      ["DOGE", "TWT", "AVAX"],
      ["DOGE", "INJ", "AVAX"],
      ["TWT", "INJ", "AVAX"],
      ["DOGE", "TWT", "INJ", "AVAX"],
    ].map((symbols) => ({
      label: `partial_combo_${symbols.map((symbol) => symbol.toLowerCase()).join("_")}`,
      options: {
        ...liveBase,
        partialExitBySymbol: Object.fromEntries(
          symbols.map((symbol) => [
            symbol,
            {
              fraction: 0.5,
              baseTakeProfitPct: 0.12,
              strongTakeProfitPct: 0.2,
              strongMinMomAccel: 0.02,
              strongMinVolumeRatio: 1.25,
              stopAfterPartialPct: 0.04,
              runnerTrailActivationPct: 0.22,
              runnerTrailRetracePct: 0.1,
            },
          ]),
        ),
      },
    })),
    ...["ETH", "SOL", "AVAX", "INJ", "DOGE", "UNI", "TWT"].map((symbol) => ({
      label: `partial_${symbol.toLowerCase()}_12pct_runner`,
      options: {
        ...liveBase,
        partialExitBySymbol: {
          [symbol]: {
            fraction: 0.5,
            baseTakeProfitPct: 0.12,
            strongTakeProfitPct: 0.2,
            strongMinMomAccel: 0.02,
            strongMinVolumeRatio: 1.25,
            stopAfterPartialPct: 0.04,
            runnerTrailActivationPct: 0.22,
            runnerTrailRetracePct: 0.1,
          },
        },
      },
    })),
    {
      label: "partial_fixed_2pct_runner",
      options: {
        ...liveBase,
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.02,
            stopAfterPartialPct: 0.006,
            runnerTrailActivationPct: 0.03,
            runnerTrailRetracePct: 0.018,
          },
        },
      },
    },
    {
      label: "partial_dynamic_volume_momentum",
      options: {
        ...liveBase,
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.016,
            strongTakeProfitPct: 0.028,
            strongMinMomAccel: 0.018,
            strongMinVolumeRatio: 1.35,
            stopAfterPartialPct: 0.006,
            runnerTrailActivationPct: 0.035,
            runnerTrailRetracePct: 0.02,
          },
        },
      },
    },
    {
      label: "partial_dynamic_buyback",
      options: {
        ...liveBase,
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.016,
            strongTakeProfitPct: 0.03,
            strongMinMomAccel: 0.018,
            strongMinVolumeRatio: 1.35,
            stopAfterPartialPct: 0.006,
            runnerTrailActivationPct: 0.035,
            runnerTrailRetracePct: 0.02,
            buybackBreakoutPct: 0.006,
            buybackMaxBarsAfterPartial: 12,
            buybackMinMomAccel: 0.018,
            buybackMinVolumeRatio: 1.25,
          },
        },
      },
    },
    {
      label: "partial_dynamic_buyback_aggressive",
      options: {
        ...liveBase,
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.016,
            strongTakeProfitPct: 0.035,
            strongMinMomAccel: 0.018,
            strongMinVolumeRatio: 1.35,
            stopAfterPartialPct: 0.006,
            runnerTrailActivationPct: 0.05,
            runnerTrailRetracePct: 0.028,
            buybackBreakoutPct: 0.001,
            buybackMaxBarsAfterPartial: 24,
            buybackMinMomAccel: 0.0015,
            buybackMinVolumeRatio: 1.05,
          },
        },
      },
    },
    {
      label: "partial_late_dynamic_buyback",
      options: {
        ...liveBase,
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.035,
            strongTakeProfitPct: 0.06,
            strongMinMomAccel: 0.018,
            strongMinVolumeRatio: 1.35,
            stopAfterPartialPct: 0.012,
            runnerTrailActivationPct: 0.08,
            runnerTrailRetracePct: 0.035,
            buybackBreakoutPct: 0.002,
            buybackMaxBarsAfterPartial: 24,
            buybackMinMomAccel: 0.0015,
            buybackMinVolumeRatio: 1.05,
          },
        },
      },
    },
    {
      label: "partial_profit_protect_18_30_wide",
      options: {
        ...liveBase,
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.18, retracePct: 0.08 },
            { activationPct: 0.3, retracePct: 0.12 },
            { activationPct: 0.6, retracePct: 0.18 },
          ],
        },
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.18,
            strongTakeProfitPct: 0.3,
            strongMinMomAccel: 0.018,
            strongMinVolumeRatio: 1.35,
            stopAfterPartialPct: 0.06,
            runnerTrailActivationPct: 0.3,
            runnerTrailRetracePct: 0.12,
            buybackBreakoutPct: 0.004,
            buybackMaxBarsAfterPartial: 24,
            buybackMinMomAccel: 0.0015,
            buybackMinVolumeRatio: 1.05,
          },
        },
      },
    },
    {
      label: "partial_profit_protect_30_60_wide",
      options: {
        ...liveBase,
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.21, retracePct: 0.09 },
            { activationPct: 0.45, retracePct: 0.14 },
            { activationPct: 0.75, retracePct: 0.2 },
          ],
        },
        idleBreakoutPartialExitBySymbol: {
          PENGU: {
            fraction: 0.5,
            baseTakeProfitPct: 0.3,
            strongTakeProfitPct: 0.6,
            strongMinMomAccel: 0.02,
            strongMinVolumeRatio: 1.4,
            stopAfterPartialPct: 0.12,
            runnerTrailActivationPct: 0.45,
            runnerTrailRetracePct: 0.16,
            buybackBreakoutPct: 0.004,
            buybackMaxBarsAfterPartial: 24,
            buybackMinMomAccel: 0.0015,
            buybackMinVolumeRatio: 1.05,
          },
        },
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...variant.options,
      label: variant.label,
    });
    const summary = summarize(variant.label, result, Date.now() - started);
    rows.push(summary);
    await fs.writeFile(path.join(REPORT_DIR, `${variant.label}.json`), JSON.stringify(summary, null, 2), "utf8");
    console.log(`${variant.label}: ${summary.endEquity.toLocaleString()} PF ${summary.profitFactor}`);
  }
  const markdown = toMarkdown(rows);
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
