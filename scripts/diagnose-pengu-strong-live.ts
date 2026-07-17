import "dotenv/config";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "@/config/reclaimHybridStrategy";
import { evaluateHybridLiveDecisionDetails, type HybridVariantOptions } from "@/lib/backtest/hybrid-engine";
import { loadOperationalWallets } from "@/lib/server/operational-wallet-db";
import { loadOpenPositionForWalletSymbol } from "@/lib/server/trade-history-db";

const CURRENT_SYMBOLS = ["ETH", "SOL", "INJ"];
const TARGET_SYMBOLS = ["PENGU"];
const SCORE_GAP = 15;
const MIN_HOLD_BARS = 2;
const BAR_MS = 15 * 60 * 1000;

function currentHoldingSymbol(wallet: Awaited<ReturnType<typeof loadOperationalWallets>>[number]) {
  return (wallet.trackedHoldings || [])
    .filter((holding) => Number(holding.usdValue || 0) >= 3)
    .filter((holding) => holding.symbol !== RECLAIM_HYBRID_EXECUTION_PROFILE.gasSymbol)
    .sort((left, right) => Number(right.usdValue || 0) - Number(left.usdValue || 0))[0]?.symbol || "NONE";
}

async function main() {
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  const options: HybridVariantOptions = {
    ...base,
    penguStrongOverrideEntry: true,
    penguStrongOverrideTimeframe: "15m",
    penguStrongOverrideSymbols: TARGET_SYMBOLS,
    penguStrongOverrideCurrentSymbols: CURRENT_SYMBOLS,
    penguStrongOverrideScoreGap: SCORE_GAP,
    penguStrongOverrideMinHoldBars: MIN_HOLD_BARS,
    penguStrongOverrideAllowTradeGateOff: true,
    trendDecisionTimeframe: "15m",
    expandedTrendSymbols: [
      ...new Set([
        ...(base.expandedTrendSymbols || []),
        ...CURRENT_SYMBOLS,
        ...TARGET_SYMBOLS,
      ]),
    ],
    idleCashTrendContext: true,
    idleCashTrendAllowTrendGateOff: true,
  };

  const [details, wallets] = await Promise.all([
    evaluateHybridLiveDecisionDetails("RETQ22", options),
    loadOperationalWallets(),
  ]);
  const wallet = wallets.find((item) => !item.deletedAt && item.status !== "paused") || null;
  const currentSymbol = wallet ? currentHoldingSymbol(wallet) : "NONE";
  const currentEval = details?.trendEvaluations.find((item) => item.symbol.toUpperCase() === currentSymbol.toUpperCase()) || null;
  const penguEval = details?.trendEvaluations.find((item) => item.symbol.toUpperCase() === "PENGU") || null;
  const openPosition = wallet && currentSymbol !== "NONE"
    ? await loadOpenPositionForWalletSymbol(wallet.id, currentSymbol)
    : null;
  const decisionMs = details?.decision.isoTime ? new Date(details.decision.isoTime).getTime() : 0;
  const openedMs = openPosition?.openedAt ? new Date(openPosition.openedAt).getTime() : 0;
  const heldBars = decisionMs && openedMs ? Math.floor((decisionMs - openedMs) / BAR_MS) : null;
  const scoreGap = penguEval && currentEval ? penguEval.score - currentEval.score : null;

  const blockers: string[] = [];
  if (!wallet) blockers.push("active walletなし");
  if (!CURRENT_SYMBOLS.includes(currentSymbol)) blockers.push(`現在保有 ${currentSymbol} は対象外`);
  if (!penguEval?.eligible) blockers.push(`PENGU eligible=false (${penguEval?.reasons?.join(", ") || "評価なし"})`);
  if (!currentEval) blockers.push(`${currentSymbol} の15分評価なし`);
  if (scoreGap != null && scoreGap < SCORE_GAP) blockers.push(`Score差 ${scoreGap.toFixed(2)} < ${SCORE_GAP}`);
  if (!openPosition?.openedAt) blockers.push(`${currentSymbol} のopen positionなし`);
  if (heldBars != null && heldBars < MIN_HOLD_BARS) blockers.push(`minHoldBars ${heldBars} < ${MIN_HOLD_BARS}`);

  console.log(JSON.stringify({
    decisionTime: details?.decision.isoTime || null,
    baseDesired: details?.decision.desiredSymbol || null,
    wallet: wallet ? {
      id: wallet.id,
      status: wallet.status,
      backupConfirmed: wallet.backupConfirmed,
      currentSymbol,
      portfolioUsd: wallet.lastPortfolioUsd,
    } : null,
    openPosition,
    heldBars,
    scoreGap,
    minScoreGap: SCORE_GAP,
    minHoldBars: MIN_HOLD_BARS,
    pengu: penguEval ? {
      eligible: penguEval.eligible,
      score: penguEval.score,
      reasons: penguEval.reasons,
      close: penguEval.close,
      mom20: penguEval.mom20,
      momAccel: penguEval.momAccel,
      volumeRatio: penguEval.volumeRatio,
      efficiencyRatio: penguEval.efficiencyRatio,
    } : null,
    current: currentEval ? {
      symbol: currentEval.symbol,
      eligible: currentEval.eligible,
      score: currentEval.score,
      reasons: currentEval.reasons,
      close: currentEval.close,
      mom20: currentEval.mom20,
      momAccel: currentEval.momAccel,
      volumeRatio: currentEval.volumeRatio,
      efficiencyRatio: currentEval.efficiencyRatio,
    } : null,
    wouldTrade: blockers.length === 0,
    blockers,
  }, null, 2));
}

main().catch((error) => {
  console.error("[diagnose-pengu-strong-live] failed:", error);
  process.exitCode = 1;
});
