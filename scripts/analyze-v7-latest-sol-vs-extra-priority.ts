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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-latest-sol-vs-extra-priority");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

type Window = {
  startTs: number;
  endTs: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
}

function withSymbolMapNumber(
  map: Record<string, number> | undefined,
  symbol: string,
  value: number,
) {
  return {
    ...(map ?? {}),
    [symbol]: value,
  };
}

function withSymbolBlockWindows(
  map: Record<string, readonly Window[]> | undefined,
  symbol: string,
  windows: readonly Window[],
) {
  return {
    ...(map ?? {}),
    [symbol]: windows,
  };
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

function invertWindows(
  windows: readonly Window[],
  startTs: number,
  endTs: number,
) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
  let cursor = startTs;

  for (const window of sorted) {
    if (window.startTs > cursor) {
      inverted.push({ startTs: cursor, endTs: window.startTs });
    }
    cursor = Math.max(cursor, window.endTs);
  }

  if (cursor < endTs) {
    inverted.push({ startTs: cursor, endTs: endTs });
  }

  return inverted.filter((window) => window.endTs > window.startTs);
}

function applyTrxLogicToSymbols(
  base: HybridVariantOptions,
  symbols: readonly string[],
  nonCashWindows?: readonly Window[],
): HybridVariantOptions {
  const expandedTrendSymbols = unique([...(base.expandedTrendSymbols ?? []), ...symbols]);
  let breakoutLookback = { ...(base.trendBreakoutLookbackBarsBySymbol ?? {}) };
  let breakoutMinPct = { ...(base.trendBreakoutMinPctBySymbol ?? {}) };
  let minVolume = { ...(base.trendMinVolumeRatioBySymbol ?? {}) };
  let minAccel = { ...(base.trendMinMomAccelBySymbol ?? {}) };
  let minEff = { ...(base.trendMinEfficiencyRatioBySymbol ?? {}) };

  for (const symbol of symbols) {
    breakoutLookback = withSymbolMapNumber(breakoutLookback, symbol, 8);
    breakoutMinPct = withSymbolMapNumber(breakoutMinPct, symbol, 0.012);
    minVolume = withSymbolMapNumber(minVolume, symbol, 1.01);
    minAccel = withSymbolMapNumber(minAccel, symbol, 0.0005);
    minEff = withSymbolMapNumber(minEff, symbol, 0.17);
  }

  let trendSymbolBlockWindows = { ...(base.trendSymbolBlockWindows ?? {}) };
  if (nonCashWindows?.length) {
    for (const symbol of symbols) {
      trendSymbolBlockWindows = withSymbolBlockWindows(trendSymbolBlockWindows, symbol, nonCashWindows);
    }
  }

  return {
    ...base,
    expandedTrendSymbols,
    trendSymbolBlockWindows,
    trendBreakoutLookbackBarsBySymbol: breakoutLookback,
    trendBreakoutMinPctBySymbol: breakoutMinPct,
    trendMinVolumeRatioBySymbol: minVolume,
    trendMinMomAccelBySymbol: minAccel,
    trendMinEfficiencyRatioBySymbol: minEff,
  };
}

function latestAcceptedOptions(base: HybridVariantOptions, nonCashWindows: readonly Window[]): HybridVariantOptions {
  return {
    ...applyTrxLogicToSymbols(base, ["UNI", "TWT"], nonCashWindows),
    trendPrioritySymbols: ["TWT"],
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
    trendRotationScoreGap: 0,
    trendRotationCurrentMomAccelMax: 999,
    trendRotationCurrentMom20Max: 999,
    trendRotationMinHoldBars: 1,
    trendRotationRequireConsecutiveBars: 1,
  };
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    bySymbol: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const latest = latestAcceptedOptions(base, nonCashWindows);

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "latest_baseline",
      thesis: "Latest accepted setup: cash-only UNI/TWT with TWT priority rotation.",
      options: { ...latest, label: "latest_baseline" },
    },
    {
      key: "latest_plus_extra_over_sol_gap8_mom_eff",
      thesis: "Latest baseline plus prefer DOGE/PENGU over SOL when score leads by 8 and both mom20 / efficiency are stronger.",
      options: {
        ...latest,
        strictExtraTrendPriorityCurrentSymbols: ["SOL"],
        strictExtraTrendPriorityScoreGap: 8,
        strictExtraTrendPriorityRequireHigherMom20: true,
        strictExtraTrendPriorityRequireHigherEfficiency: true,
        label: "latest_plus_extra_over_sol_gap8_mom_eff",
      },
    },
    {
      key: "latest_plus_extra_over_sol_gap10_mom_eff",
      thesis: "Latest baseline plus prefer DOGE/PENGU over SOL when score leads by 10 and both mom20 / efficiency are stronger.",
      options: {
        ...latest,
        strictExtraTrendPriorityCurrentSymbols: ["SOL"],
        strictExtraTrendPriorityScoreGap: 10,
        strictExtraTrendPriorityRequireHigherMom20: true,
        strictExtraTrendPriorityRequireHigherEfficiency: true,
        label: "latest_plus_extra_over_sol_gap10_mom_eff",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      ...summarize(result),
    });
  }

  rows.sort((left, right) => right.endEquity - left.endEquity);

  const md = [
    "# Latest V7-style Baseline vs DOGE/PENGU over SOL Priority",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id_source: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} |`,
    ),
    "",
    "## Symbol Contribution",
    "",
    ...rows.map((row) => `- ${row.key}: ${Object.entries(row.bySymbol).map(([k, v]) => `${k} ${v}`).join(" / ")}`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
