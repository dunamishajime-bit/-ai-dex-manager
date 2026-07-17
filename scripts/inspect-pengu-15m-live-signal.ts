import "dotenv/config";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { evaluateHybridLiveDecisionDetails, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

async function main() {
  const options = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  const overrideOptions: HybridVariantOptions = {
    ...options,
    penguStrongOverrideEntry: true,
    penguStrongOverrideTimeframe: "15m",
    penguStrongOverrideSymbols: ["PENGU"],
    penguStrongOverrideCurrentSymbols: ["ETH", "SOL", "INJ"],
    penguStrongOverrideScoreGap: 15,
    penguStrongOverrideMinHoldBars: 2,
    penguStrongOverrideAllowTradeGateOff: true,
    trendDecisionTimeframe: "15m",
    expandedTrendSymbols: [
      ...new Set([
        ...(options.expandedTrendSymbols || []),
        "ETH",
        "SOL",
        "INJ",
        "PENGU",
      ]),
    ],
    idleCashTrendContext: true,
    idleCashTrendAllowTrendGateOff: true,
  };
  if (process.env.PENGU_DRIFT === "1") {
    overrideOptions.trendBreakoutLookbackBars = null;
    overrideOptions.trendMinVolumeRatio = 0.01;
    overrideOptions.trendMinMomAccel = -0.01;
    overrideOptions.trendMinEfficiencyRatio = 0.08;
    overrideOptions.trendMinSmaDistancePct = -0.005;
    overrideOptions.idleCashTrendMinEfficiencyRatio = 0.08;
  }

  const details = await evaluateHybridLiveDecisionDetails("RETQ22", overrideOptions);
  const pengu = details?.trendEvaluations.find((item) => item.symbol.toUpperCase() === "PENGU") || null;
  const currentCandidates = (details?.trendEvaluations || [])
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((item) => ({
      symbol: item.symbol,
      eligible: item.eligible,
      score: item.score,
      close: item.close,
      sma40: item.sma40,
      mom20: item.mom20,
      momAccel: item.momAccel,
      volumeRatio: item.volumeRatio,
      efficiencyRatio: item.efficiencyRatio,
      recentHighDrawdownPct: item.recentHighDrawdownPct,
      structureBreak: item.structureBreak,
      reasons: item.reasons,
    }));

  console.log(JSON.stringify({
    now: new Date().toISOString(),
    decisionTime: details?.decision.isoTime,
    desiredSymbol: details?.decision.desiredSymbol,
    desiredSide: details?.decision.desiredSide,
    reason: details?.decision.reason,
    pengu,
    topCandidates: currentCandidates,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
