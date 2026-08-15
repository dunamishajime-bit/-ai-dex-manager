import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";

const START_TS = Date.UTC(2023, 6, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 6, 1, 0, 0, 0, 0) - 1;
const OUT = path.join(process.cwd(), ".research-state", "legacy-reclaim-hybrid-3y-benchmark.json");

function round(v: number, d = 6) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

async function main() {
  const options = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "research_legacy_reclaim_hybrid_3y_benchmark",
  };
  const result = await runHybridBacktest("RETQ22", options);
  const bySymbol: Record<string, { trades: number; netPnl: number }> = {};
  const byEntryReason: Record<string, { trades: number; netPnl: number }> = {};
  const byExitReason: Record<string, { trades: number; netPnl: number }> = {};
  const byYear: Record<string, { trades: number; netPnl: number }> = {};

  for (const trade of result.trade_pairs) {
    const symbol = trade.symbol;
    bySymbol[symbol] ??= { trades: 0, netPnl: 0 };
    bySymbol[symbol].trades += 1;
    bySymbol[symbol].netPnl += trade.net_pnl;

    const entryReason = trade.entry_reason || "UNKNOWN";
    byEntryReason[entryReason] ??= { trades: 0, netPnl: 0 };
    byEntryReason[entryReason].trades += 1;
    byEntryReason[entryReason].netPnl += trade.net_pnl;

    const exitReason = trade.exit_reason || "UNKNOWN";
    byExitReason[exitReason] ??= { trades: 0, netPnl: 0 };
    byExitReason[exitReason].trades += 1;
    byExitReason[exitReason].netPnl += trade.net_pnl;

    const year = String(new Date(trade.entry_ts).getUTCFullYear());
    byYear[year] ??= { trades: 0, netPnl: 0 };
    byYear[year].trades += 1;
    byYear[year].netPnl += trade.net_pnl;
  }

  const normalize = (obj: Record<string, { trades: number; netPnl: number }>) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { trades: v.trades, netPnl: round(v.netPnl) }]));

  const out = {
    researchLine: "LEGACY_RECLAIM_HYBRID_3Y_DIAGNOSTIC_BENCHMARK",
    researchOnly: true,
    diagnosticOnly: true,
    productionChanged: false,
    vpsChanged: false,
    liveChanged: false,
    realTradingEnabled: false,
    freshOosRead: false,
    freshOosConsumed: false,
    liveEligible: false,
    antiOverfitWarning: {
      candidateEligible: false,
      reasons: [
        "legacy profile contains per-symbol thresholds",
        "legacy profile contains AVAX auxRange activeYears=[2024,2025]",
        "legacy profile was developed before this sealed 3Y research line",
      ],
    },
    period: { startTs: START_TS, endTsInclusive: END_TS },
    declaredProfile: {
      id: RECLAIM_HYBRID_EXECUTION_PROFILE.id,
      feeRatePerSide: RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate,
      maxConcurrentPositions: RECLAIM_HYBRID_EXECUTION_PROFILE.maxConcurrentPositions,
      targetAlloc: RECLAIM_HYBRID_EXECUTION_PROFILE.targetAlloc,
      primaryRange: RECLAIM_HYBRID_EXECUTION_PROFILE.primaryRange,
      auxRange: RECLAIM_HYBRID_EXECUTION_PROFILE.auxRange,
      expandedTrendSymbols: RECLAIM_HYBRID_EXECUTION_PROFILE.expandedTrendSymbols,
      strictExtraTrendSymbols: RECLAIM_HYBRID_EXECUTION_PROFILE.strictExtraTrendSymbols,
      trendBreakoutLookbackBarsBySymbol: RECLAIM_HYBRID_EXECUTION_PROFILE.trendBreakoutLookbackBarsBySymbol,
      trendBreakoutMinPctBySymbol: RECLAIM_HYBRID_EXECUTION_PROFILE.trendBreakoutMinPctBySymbol,
      trendMinVolumeRatioBySymbol: RECLAIM_HYBRID_EXECUTION_PROFILE.trendMinVolumeRatioBySymbol,
      trendMinMomAccelBySymbol: RECLAIM_HYBRID_EXECUTION_PROFILE.trendMinMomAccelBySymbol,
      trendMinEfficiencyRatioBySymbol: RECLAIM_HYBRID_EXECUTION_PROFILE.trendMinEfficiencyRatioBySymbol,
    },
    summary: result.summary,
    tradeCount: result.trade_pairs.length,
    bySymbol: normalize(bySymbol),
    byEntryReason: normalize(byEntryReason),
    byExitReason: normalize(byExitReason),
    byEntryYear: normalize(byYear),
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
