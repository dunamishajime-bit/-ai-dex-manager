import { createHash } from "node:crypto";

import type { PerpStrategyGenome, PerpStrategyParameters } from "./types";

const LOGIC_FINGERPRINT_VERSION = 1;

function quantize(value: number, step: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / step) * step;
}

function normalizedParameters(parameters: PerpStrategyParameters) {
  return {
    timeframeHours: parameters.timeframeHours,
    leverage: quantize(parameters.leverage, 0.1),
    riskPerTradePct: quantize(parameters.riskPerTradePct, 0.1),
    maxMarginUsagePct: quantize(parameters.maxMarginUsagePct, 1),
    btcRegimeSmaBars: parameters.btcRegimeSmaBars,
    btcRegimeMomentumBars: parameters.btcRegimeMomentumBars,
    regimeThresholdPct: quantize(parameters.regimeThresholdPct, 0.0005),
    momentumBars: parameters.momentumBars,
    breakoutBars: parameters.breakoutBars,
    breakoutBufferPct: quantize(parameters.breakoutBufferPct, 0.0005),
    minimumMomentumPct: quantize(parameters.minimumMomentumPct, 0.0005),
    minimumVolumeRatio: quantize(parameters.minimumVolumeRatio, 0.01),
    minimumEdgeToCostRatio: quantize(parameters.minimumEdgeToCostRatio, 0.05),
    volatilityLookbackBars: parameters.volatilityLookbackBars,
    volatilityPenalty: quantize(parameters.volatilityPenalty, 0.05),
    atrBars: parameters.atrBars,
    stopAtr: quantize(parameters.stopAtr, 0.05),
    takeProfitAtr: quantize(parameters.takeProfitAtr, 0.05),
    trailingAtr: quantize(parameters.trailingAtr, 0.05),
    maxHoldBars: parameters.maxHoldBars,
    rebalanceBars: parameters.rebalanceBars,
    cooldownBars: parameters.cooldownBars,
    allowLong: parameters.allowLong,
    allowShort: parameters.allowShort,
    allowNeutralRegime: parameters.allowNeutralRegime,
    neutralScoreThreshold: quantize(parameters.neutralScoreThreshold, 0.05),
  };
}

export function perpStrategyLogicFingerprint(genome: PerpStrategyGenome) {
  const canonical = JSON.stringify({
    version: LOGIC_FINGERPRINT_VERSION,
    family: genome.family,
    symbols: [...new Set(genome.symbols)].sort(),
    parameters: normalizedParameters(genome.parameters),
  });

  return createHash("sha256").update(canonical).digest("base64url").slice(0, 20);
}

export function uniquePerpStrategiesByLogic(genomes: PerpStrategyGenome[]) {
  const unique = new Map<string, PerpStrategyGenome>();
  for (const genome of genomes) {
    const fingerprint = perpStrategyLogicFingerprint(genome);
    if (!unique.has(fingerprint)) unique.set(fingerprint, genome);
  }
  return [...unique.values()];
}
