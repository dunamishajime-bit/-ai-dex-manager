import { applyAIEscalation } from "./aiEscalation";
import { defaultPolymarketConfig } from "./config";
import { scorePolymarket } from "./scoreMarket";
import type {
  PolymarketBacktestSummary,
  PolymarketConfig,
  PolymarketScore,
  PolymarketSnapshot,
  SimulatedTrade
} from "./types";

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getExitPrice(score: PolymarketScore, config: PolymarketConfig) {
  const market = score.market;
  const isYes = score.market.recommendedSide === "YES";
  const entry = score.entryPrice;
  const maxAfter = isYes ? market.maxYesPriceAfterEntry : market.maxNoPriceAfterEntry;
  const minAfter = isYes ? market.minYesPriceAfterEntry : market.minNoPriceAfterEntry;
  const takeProfitPrice = entry * (1 + config.takeProfitPct);
  const stopLossPrice = entry * (1 - config.stopLossPct);

  if (typeof maxAfter === "number" && maxAfter >= takeProfitPrice) {
    return { exitPrice: Math.min(0.99, takeProfitPrice), exitReason: "take_profit" as const };
  }
  if (typeof minAfter === "number" && minAfter <= stopLossPrice) {
    return { exitPrice: Math.max(0.01, stopLossPrice), exitReason: "stop_loss" as const };
  }
  if (market.actualResolutionSide) {
    const won = market.actualResolutionSide === market.recommendedSide;
    return { exitPrice: won ? 1 : 0, exitReason: "resolution" as const };
  }
  const fallback = isYes ? market.finalYesPrice : market.finalNoPrice;
  return { exitPrice: typeof fallback === "number" ? fallback : entry, exitReason: fallback == null ? "open" as const : "resolution" as const };
}

function createTrade(score: PolymarketScore, snapshotIso: string, config: PolymarketConfig): SimulatedTrade {
  const { exitPrice, exitReason } = getExitPrice(score, config);
  const shares = config.stakeUsd / score.entryPrice;
  const valueAtExit = shares * exitPrice;
  const pnlUsd = valueAtExit - config.stakeUsd;
  const exitIso = score.market.deadlineIso || snapshotIso;
  const holdingHours = Math.max(0, (Date.parse(exitIso) - Date.parse(snapshotIso)) / 36e5);
  return {
    tradeId: `${score.market.marketId}-${snapshotIso}`,
    marketId: score.market.marketId,
    title: score.market.title,
    category: score.market.category,
    side: score.market.recommendedSide,
    entryIso: snapshotIso,
    exitIso,
    entryPrice: round(score.entryPrice, 4),
    exitPrice: round(exitPrice, 4),
    exitReason,
    stakeUsd: config.stakeUsd,
    pnlUsd: round(pnlUsd, 2),
    roi: round(pnlUsd / config.stakeUsd, 4),
    holdingHours: round(holdingHours, 1),
    finalScore: round(score.finalScore, 1),
    expectedReturn: round(score.market.expectedReturn, 4),
    edge: round(score.market.edge, 4),
    entryReason: `FinalScore ${round(score.finalScore, 1)} / edge ${round(score.market.edge, 3)} / ER ${round(score.market.expectedReturn, 3)}`,
    status: exitReason === "open" ? "open" : "closed"
  };
}

function addPerf(perf: Record<string, { trades: number; pnlUsd: number; roi: number }>, key: string, trade: SimulatedTrade) {
  if (!perf[key]) perf[key] = { trades: 0, pnlUsd: 0, roi: 0 };
  perf[key].trades += 1;
  perf[key].pnlUsd = round(perf[key].pnlUsd + trade.pnlUsd, 2);
  perf[key].roi = round(perf[key].pnlUsd / (perf[key].trades * trade.stakeUsd), 4);
}

function scoreBand(score: number) {
  if (score >= 90) return "90+";
  if (score >= 85) return "85-89";
  if (score >= 70) return "70-84";
  return "0-69";
}

function maxDrawdownFromTrades(trades: SimulatedTrade[]) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const trade of trades) {
    equity += trade.pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return round(maxDd, 2);
}

export function runPolymarketSimulatedBacktest(
  snapshots: PolymarketSnapshot[],
  config: PolymarketConfig = defaultPolymarketConfig
): PolymarketBacktestSummary {
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.snapshotIso) - Date.parse(b.snapshotIso));
  const scores: PolymarketScore[] = [];
  const trades: SimulatedTrade[] = [];
  const seenMarkets = new Set<string>();

  for (const snapshot of ordered) {
    const snapshotScores = snapshot.markets
      .map((market) => applyAIEscalation(scorePolymarket(market, config), config))
      .sort((a, b) => b.finalScore - a.finalScore);
    scores.push(...snapshotScores);

    let entries = 0;
    for (const score of snapshotScores) {
      if (score.decision !== "Entry") continue;
      if (config.duplicateEntryPolicy === "skip" && seenMarkets.has(score.market.marketId)) continue;
      if (entries >= config.maxEntriesPerSnapshot) continue;
      trades.push(createTrade(score, snapshot.snapshotIso, config));
      seenMarkets.add(score.market.marketId);
      entries += 1;
    }
  }

  const totalMarkets = scores.length;
  const entryCount = scores.filter((score) => score.decision === "Entry").length;
  const watchCount = scores.filter((score) => score.decision === "Watch").length;
  const rejectCount = scores.filter((score) => score.decision === "Reject").length;
  const aiEscalationCount = scores.filter((score) => score.aiEscalated).length;
  const totalPnL = round(trades.reduce((sum, trade) => sum + trade.pnlUsd, 0), 2);
  const totalStake = trades.reduce((sum, trade) => sum + trade.stakeUsd, 0);
  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  const categoryPerformance: PolymarketBacktestSummary["categoryPerformance"] = {};
  const scoreBandPerformance: PolymarketBacktestSummary["scoreBandPerformance"] = {};
  const rejectReasonCounts: Record<string, number> = {};

  for (const trade of trades) {
    addPerf(categoryPerformance, trade.category, trade);
    addPerf(scoreBandPerformance, scoreBand(trade.finalScore), trade);
  }
  for (const score of scores) {
    if (score.rejectReason) rejectReasonCounts[score.rejectReason] = (rejectReasonCounts[score.rejectReason] || 0) + 1;
  }

  return {
    snapshotPeriod: ordered.length ? `${ordered[0].snapshotIso} - ${ordered[ordered.length - 1].snapshotIso}` : "no snapshots",
    totalMarkets,
    totalTrades: trades.length,
    entryCount,
    watchCount,
    rejectCount,
    aiEscalationCount,
    aiUsagePct: totalMarkets ? round((aiEscalationCount / totalMarkets) * 100, 2) : 0,
    winRate: trades.length ? round((wins / trades.length) * 100, 2) : 0,
    totalPnL,
    roi: totalStake ? round(totalPnL / totalStake, 4) : 0,
    averageReturn: trades.length ? round(trades.reduce((sum, trade) => sum + trade.roi, 0) / trades.length, 4) : 0,
    maxDrawdown: maxDrawdownFromTrades(trades),
    bestTrade: trades.length ? [...trades].sort((a, b) => b.pnlUsd - a.pnlUsd)[0] : null,
    worstTrade: trades.length ? [...trades].sort((a, b) => a.pnlUsd - b.pnlUsd)[0] : null,
    categoryPerformance,
    scoreBandPerformance,
    rejectReasonCounts,
    scores,
    trades
  };
}
