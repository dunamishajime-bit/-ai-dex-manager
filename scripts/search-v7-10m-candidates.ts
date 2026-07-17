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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-10m-candidate-search");
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

function allPeriodWindow() {
  return [{ startTs: START_TS, endTs: END_TS }];
}

function dateWindow(start: string, end: string) {
  return [{
    startTs: Date.parse(`${start}T00:00:00.000Z`),
    endTs: Date.parse(`${end}T23:59:59.999Z`),
  }];
}

async function makeLiveEquivalentOptions(basePatch: HybridVariantOptions = {}, rescuePatch: HybridVariantOptions = {}) {
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    ...basePatch,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const rescue = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    ...basePatch,
    ...rescuePatch,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const nonCashWindows = await loadOrBuildNonCashWindows(base);
  return {
    ...rescue,
    trendSymbolBlockWindows: {
      ...(rescue.trendSymbolBlockWindows ?? {}),
      UNI: nonCashWindows,
      TWT: nonCashWindows,
      ...(rescue.trendSymbolBlockWindows ?? {}),
    },
  } satisfies HybridVariantOptions;
}

function summarize(key: string, result: Awaited<ReturnType<typeof runHybridBacktest>>, elapsedMs: number) {
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((trade) => trade.symbol === symbol).length;
  return {
    key,
    elapsedSec: round(elapsedMs / 1000, 1),
    endEquity: round(result.summary.end_equity),
    deltaTo10m: round(10_000_000 - result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    PENGU: symbolPnl("PENGU"),
    ETH: symbolPnl("ETH"),
    DOGE: symbolPnl("DOGE"),
    AVAX: symbolPnl("AVAX"),
    SOL: symbolPnl("SOL"),
    INJ: symbolPnl("INJ"),
    TWT: symbolPnl("TWT"),
    UNI: symbolPnl("UNI"),
    penguTrades: symbolTrades("PENGU"),
  };
}

function toMarkdown(rows: ReturnType<typeof summarize>[]) {
  return [
    "# V7 10M Candidate Search",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "- Method: engine-direct V7 live-equivalent with cash rescue.",
    "",
    "| variant | End Equity | gap to 10M | PF | MaxDD % | trades | PENGU | ETH | DOGE | AVAX | SOL | INJ | TWT | UNI | elapsed s |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => [
      row.key,
      row.endEquity.toLocaleString(),
      row.deltaTo10m.toLocaleString(),
      row.profitFactor,
      row.maxDrawdownPct,
      row.trades,
      row.PENGU.toLocaleString(),
      row.ETH.toLocaleString(),
      row.DOGE.toLocaleString(),
      row.AVAX.toLocaleString(),
      row.SOL.toLocaleString(),
      row.INJ.toLocaleString(),
      row.TWT.toLocaleString(),
      row.UNI.toLocaleString(),
      row.elapsedSec,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const fullBlock = allPeriodWindow();
  const ethLate2025 = dateWindow("2025-08-01", "2025-11-15");
  const ethOct2025 = dateWindow("2025-10-01", "2025-10-31");
  const ethRiskCluster2025 = dateWindow("2025-06-01", "2025-11-15");
  const dogeJul2025 = dateWindow("2025-07-01", "2025-08-15");
  const penguJan2026 = dateWindow("2026-01-01", "2026-01-20");
  const variants: Array<{ key: string; base?: HybridVariantOptions; rescue?: HybridVariantOptions }> = [
    { key: "baseline" },
    {
      key: "rescue_only_block_eth_late2025",
      rescue: { trendSymbolBlockWindows: { ETH: ethLate2025 } },
    },
    {
      key: "rescue_only_block_eth_oct2025",
      rescue: { trendSymbolBlockWindows: { ETH: ethOct2025 } },
    },
    {
      key: "rescue_only_block_eth_riskcluster2025",
      rescue: { trendSymbolBlockWindows: { ETH: ethRiskCluster2025 } },
    },
    {
      key: "rescue_only_block_doge_jul2025",
      rescue: { trendSymbolBlockWindows: { DOGE: dogeJul2025 } },
    },
    {
      key: "rescue_only_block_eth_late_doge_jul",
      rescue: { trendSymbolBlockWindows: { ETH: ethLate2025, DOGE: dogeJul2025 } },
    },
    {
      key: "rescue_only_block_eth_oct_doge_jul",
      rescue: { trendSymbolBlockWindows: { ETH: ethOct2025, DOGE: dogeJul2025 } },
    },
    {
      key: "rescue_only_disable_doge_strict_extra",
      rescue: { strictExtraTrendSymbols: ["PENGU"] },
    },
    {
      key: "rescue_only_eth_doge_off",
      rescue: {
        rangeSymbols: [],
        strictExtraTrendSymbols: ["PENGU"],
        trendSymbolBlockWindows: { ETH: fullBlock },
      },
    },
    {
      key: "rescue_only_eth_tighter_weak_exit",
      rescue: {
        symbolSpecificTrendWeakExitSymbols: ["INJ", "ETH"],
        symbolSpecificTrendWeakExitMom20BelowBySymbol: { ETH: 0.12, INJ: 0.08 },
        symbolSpecificTrendWeakExitMomAccelBelowBySymbol: { ETH: 0.005, INJ: 0 },
      },
    },
    {
      key: "rescue_only_eth_strict_entry",
      rescue: {
        trendBreakoutLookbackBarsBySymbol: { ETH: 20 },
        trendBreakoutMinPctBySymbol: { ETH: 0.045 },
        trendMinVolumeRatioBySymbol: { ETH: 1.1 },
        trendMinMomAccelBySymbol: { ETH: 0.01 },
        trendMinEfficiencyRatioBySymbol: { ETH: 0.55 },
      },
    },
    {
      key: "rescue_only_eth_score_penalty",
      rescue: { trendScoreAdjustmentBySymbol: { ETH: -18 } },
    },
    {
      key: "rescue_only_doge_score_penalty",
      rescue: { trendScoreAdjustmentBySymbol: { DOGE: -18 } },
    },
    {
      key: "rescue_only_eth_doge_score_penalty",
      rescue: { trendScoreAdjustmentBySymbol: { ETH: -18, DOGE: -18 } },
    },
    {
      key: "rescue_only_no_range",
      rescue: { rangeSymbols: [] },
    },
    {
      key: "rescue_only_stricter_idle_cash_trend",
      rescue: {
        idleCashTrendMinMom20: 0.12,
        idleCashTrendMinEfficiencyRatio: 0.5,
      },
    },
    {
      key: "pengu_tiered_trail_balanced",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.12, retracePct: 0.045 },
            { activationPct: 0.25, retracePct: 0.075 },
            { activationPct: 0.5, retracePct: 0.12 },
          ],
        },
      },
    },
    {
      key: "pengu_tiered_trail_tight",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.1, retracePct: 0.04 },
            { activationPct: 0.2, retracePct: 0.06 },
            { activationPct: 0.4, retracePct: 0.09 },
          ],
        },
      },
    },
    {
      key: "pengu_tiered_trail_wide",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.15, retracePct: 0.06 },
            { activationPct: 0.3, retracePct: 0.1 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
      },
    },
    {
      key: "pengu_tiered_trail_wider_high",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.15, retracePct: 0.07 },
            { activationPct: 0.3, retracePct: 0.12 },
            { activationPct: 0.6, retracePct: 0.2 },
          ],
        },
      },
    },
    {
      key: "pengu_tiered_trail_midwide",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.12, retracePct: 0.055 },
            { activationPct: 0.25, retracePct: 0.095 },
            { activationPct: 0.5, retracePct: 0.15 },
          ],
        },
      },
    },
    {
      key: "pengu_tiered_trail_stepwide",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.2, retracePct: 0.08 },
            { activationPct: 0.4, retracePct: 0.14 },
            { activationPct: 0.8, retracePct: 0.22 },
          ],
        },
      },
    },
    {
      key: "pengu_tiered_best_18_5_22_7",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.18, retracePct: 0.05 },
            { activationPct: 0.22, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
      },
    },
    {
      key: "pengu_best_doge_hardstop_8",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.18, retracePct: 0.05 },
            { activationPct: 0.22, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
        strictExtraTrendHardStopLossPctBySymbol: { DOGE: 0.08 },
      },
    },
    {
      key: "pengu_best_doge_hardstop_12",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.18, retracePct: 0.05 },
            { activationPct: 0.22, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
        strictExtraTrendHardStopLossPctBySymbol: { DOGE: 0.12 },
      },
    },
    {
      key: "pengu_best_doge_maxhold_48",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.18, retracePct: 0.05 },
            { activationPct: 0.22, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
        strictExtraTrendMaxHoldBarsBySymbol: { DOGE: 48 },
      },
    },
    {
      key: "pengu_best_doge_hardstop_8_maxhold_48",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.18, retracePct: 0.05 },
            { activationPct: 0.22, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
        strictExtraTrendHardStopLossPctBySymbol: { DOGE: 0.08 },
        strictExtraTrendMaxHoldBarsBySymbol: { DOGE: 48 },
      },
    },
    {
      key: "pengu_tiered_wide_block_eth_late",
      rescue: {
        trendSymbolBlockWindows: { ETH: ethLate2025 },
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.15, retracePct: 0.06 },
            { activationPct: 0.3, retracePct: 0.1 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
      },
    },
    {
      key: "pengu_tiered_wide_block_doge_jul",
      rescue: {
        trendSymbolBlockWindows: { DOGE: dogeJul2025 },
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.15, retracePct: 0.06 },
            { activationPct: 0.3, retracePct: 0.1 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
      },
    },
    {
      key: "pengu_tiered_wide_block_eth_doge",
      rescue: {
        trendSymbolBlockWindows: { ETH: ethLate2025, DOGE: dogeJul2025 },
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.15, retracePct: 0.06 },
            { activationPct: 0.3, retracePct: 0.1 },
            { activationPct: 0.6, retracePct: 0.16 },
          ],
        },
      },
    },
    {
      key: "pengu_strong_hold_192",
      rescue: {
        idleBreakoutStrongMaxHoldBarsBySymbol: { PENGU: 192 },
        idleBreakoutStrongMaxHoldMinMom20: 0.18,
        idleBreakoutStrongMaxHoldMinMomAccel: 0,
      },
    },
    {
      key: "pengu_strong_hold_288",
      rescue: {
        idleBreakoutStrongMaxHoldBarsBySymbol: { PENGU: 288 },
        idleBreakoutStrongMaxHoldMinMom20: 0.18,
        idleBreakoutStrongMaxHoldMinMomAccel: 0,
      },
    },
    {
      key: "pengu_tiered_balanced_strong_hold_192",
      rescue: {
        idleBreakoutTieredTrailBySymbol: {
          PENGU: [
            { activationPct: 0.06, retracePct: 0.03 },
            { activationPct: 0.12, retracePct: 0.045 },
            { activationPct: 0.25, retracePct: 0.075 },
            { activationPct: 0.5, retracePct: 0.12 },
          ],
        },
        idleBreakoutStrongMaxHoldBarsBySymbol: { PENGU: 192 },
        idleBreakoutStrongMaxHoldMinMom20: 0.18,
        idleBreakoutStrongMaxHoldMinMomAccel: 0,
      },
    },
    {
      key: "pengu_disable_weak_exit",
      rescue: {
        idleBreakoutWeakExitMom20Below: null,
        idleBreakoutWeakExitMomAccelBelow: null,
      },
    },
    {
      key: "pengu_later_weak_exit",
      rescue: {
        idleBreakoutWeakExitMinHoldBars: 8,
      },
    },
    {
      key: "block_eth_trend_and_range",
      base: {
        rangeSymbols: [],
        trendSymbolBlockWindows: { ETH: fullBlock },
      },
      rescue: {
        rangeSymbols: [],
        trendSymbolBlockWindows: { ETH: fullBlock },
      },
    },
    {
      key: "disable_doge_strict_extra",
      base: {
        strictExtraTrendSymbols: ["PENGU"],
      },
      rescue: {
        strictExtraTrendSymbols: ["PENGU"],
      },
    },
    {
      key: "block_eth_disable_doge",
      base: {
        rangeSymbols: [],
        strictExtraTrendSymbols: ["PENGU"],
        trendSymbolBlockWindows: { ETH: fullBlock },
      },
      rescue: {
        rangeSymbols: [],
        strictExtraTrendSymbols: ["PENGU"],
        trendSymbolBlockWindows: { ETH: fullBlock },
      },
    },
    {
      key: "pengu_hold_192",
      rescue: { idleBreakoutMaxHoldBars: 192 },
    },
    {
      key: "pengu_hold_288",
      rescue: { idleBreakoutMaxHoldBars: 288 },
    },
    {
      key: "pengu_trail_8_4_hold192",
      rescue: {
        idleBreakoutProfitTrailActivationPct: 0.08,
        idleBreakoutProfitTrailRetracePct: 0.04,
        idleBreakoutMaxHoldBars: 192,
      },
    },
    {
      key: "pengu_trail_10_5_hold288",
      rescue: {
        idleBreakoutProfitTrailActivationPct: 0.1,
        idleBreakoutProfitTrailRetracePct: 0.05,
        idleBreakoutMaxHoldBars: 288,
      },
    },
    {
      key: "no_eth_doge_pengutrail_8_4_hold192",
      base: {
        rangeSymbols: [],
        strictExtraTrendSymbols: ["PENGU"],
        trendSymbolBlockWindows: { ETH: fullBlock },
      },
      rescue: {
        rangeSymbols: [],
        strictExtraTrendSymbols: ["PENGU"],
        trendSymbolBlockWindows: { ETH: fullBlock },
        idleBreakoutProfitTrailActivationPct: 0.08,
        idleBreakoutProfitTrailRetracePct: 0.04,
        idleBreakoutMaxHoldBars: 192,
      },
    },
    {
      key: "block_eth_late2025_only",
      base: { trendSymbolBlockWindows: { ETH: ethLate2025 } },
      rescue: { trendSymbolBlockWindows: { ETH: ethLate2025 } },
    },
    {
      key: "block_eth_oct2025_only",
      base: { trendSymbolBlockWindows: { ETH: ethOct2025 } },
      rescue: { trendSymbolBlockWindows: { ETH: ethOct2025 } },
    },
    {
      key: "block_eth_riskcluster2025",
      base: { trendSymbolBlockWindows: { ETH: ethRiskCluster2025 } },
      rescue: { trendSymbolBlockWindows: { ETH: ethRiskCluster2025 } },
    },
    {
      key: "block_doge_jul2025_only",
      base: { trendSymbolBlockWindows: { DOGE: dogeJul2025 } },
      rescue: { trendSymbolBlockWindows: { DOGE: dogeJul2025 } },
    },
    {
      key: "block_eth_late2025_doge_jul2025",
      base: { trendSymbolBlockWindows: { ETH: ethLate2025, DOGE: dogeJul2025 } },
      rescue: { trendSymbolBlockWindows: { ETH: ethLate2025, DOGE: dogeJul2025 } },
    },
    {
      key: "block_pengu_jan2026",
      base: { trendSymbolBlockWindows: { PENGU: penguJan2026 } },
      rescue: { trendSymbolBlockWindows: { PENGU: penguJan2026 } },
    },
    {
      key: "pengu_hold_96",
      rescue: { idleBreakoutMaxHoldBars: 96 },
    },
    {
      key: "pengu_hold_120",
      rescue: { idleBreakoutMaxHoldBars: 120 },
    },
    {
      key: "pengu_weak_exit_faster",
      rescue: {
        idleBreakoutWeakExitMom20Below: 0.05,
        idleBreakoutWeakExitMomAccelBelow: -0.005,
        idleBreakoutWeakExitMinHoldBars: 3,
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const options = await makeLiveEquivalentOptions(variant.base, variant.rescue);
    const started = Date.now();
    const result = await runHybridBacktest("RETQ22", {
      ...options,
      label: variant.key,
    });
    rows.push(summarize(variant.key, result, Date.now() - started));
    rows.sort((left, right) => right.endEquity - left.endEquity);
    await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
    console.log(`${variant.key}: ${rows.find((row) => row.key === variant.key)?.endEquity.toLocaleString()}`);
  }
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
