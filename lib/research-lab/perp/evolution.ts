import { createSeededRandom } from "../evolution";
import { RESEARCHERS } from "../roles";
import type { ResearcherId } from "../types";
import type {
  PerpFamily,
  PerpResearchProfile,
  PerpStrategyGenome,
  PerpStrategyParameters,
  PerpTimeframeHours,
} from "./types";

const FAMILIES: PerpFamily[] = ["regime_momentum", "breakout", "relative_strength", "dual_direction"];
const TIMEFRAMES: PerpTimeframeHours[] = [2, 4, 6, 8, 12];
const ATTACK_TIMEFRAMES: PerpTimeframeHours[] = [2, 2, 4, 4, 6, 8];
const SYMBOL_SETS = [
  ["BTC", "ETH", "BNB", "SOL", "XRP"],
  ["ETH", "SOL", "AVAX", "LINK", "INJ", "NEAR"],
  ["BTC", "ETH", "SOL", "XRP", "ADA", "LINK"],
  ["BNB", "SOL", "AVAX", "ATOM", "AAVE", "INJ"],
  ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "LINK", "LTC", "ATOM", "AAVE", "NEAR", "INJ"],
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

function jitter(value: number, amount: number, min: number, max: number, random: () => number, digits = 4) {
  return round(clamp(value + (random() * 2 - 1) * amount, min, max), digits);
}

function ensureDirection(parameters: PerpStrategyParameters, random: () => number) {
  if (!parameters.allowLong && !parameters.allowShort) {
    if (random() > 0.5) parameters.allowLong = true;
    else parameters.allowShort = true;
  }
  return parameters;
}

function randomParameters(random: () => number, profile: PerpResearchProfile): PerpStrategyParameters {
  const attack = profile === "attack";
  const bothDirections = random() < (attack ? 0.9 : 0.75);
  return ensureDirection(
    {
      timeframeHours: pick(attack ? ATTACK_TIMEFRAMES : TIMEFRAMES, random),
      leverage: round(attack ? 3 + random() * 2 : 1 + random() * 3, 2),
      riskPerTradePct: round(attack ? 2 + random() * 3 : 0.5 + random() * 2.5, 2),
      maxMarginUsagePct: round(attack ? 65 + random() * 35 : 30 + random() * 55, 1),
      btcRegimeSmaBars: Math.round((attack ? 12 : 20) + random() * (attack ? 70 : 100)),
      btcRegimeMomentumBars: Math.round(3 + random() * (attack ? 24 : 36)),
      regimeThresholdPct: round((attack ? 0.001 : 0.002) + random() * (attack ? 0.035 : 0.05)),
      momentumBars: Math.round((attack ? 3 : 4) + random() * (attack ? 35 : 56)),
      breakoutBars: Math.round((attack ? 3 : 4) + random() * (attack ? 24 : 36)),
      breakoutBufferPct: round(random() * (attack ? 0.015 : 0.025)),
      minimumMomentumPct: round((attack ? 0.002 : 0.003) + random() * (attack ? 0.05 : 0.08)),
      minimumVolumeRatio: round((attack ? 0.45 : 0.6) + random() * (attack ? 1.1 : 1.2)),
      minimumEdgeToCostRatio: round((attack ? 1.5 : 2.5) + random() * (attack ? 2.5 : 3.5)),
      volatilityLookbackBars: Math.round(5 + random() * (attack ? 24 : 34)),
      volatilityPenalty: round(random() * (attack ? 1.5 : 2.5)),
      atrBars: Math.round(5 + random() * (attack ? 16 : 24)),
      stopAtr: round(attack ? 0.55 + random() * 1.8 : 0.8 + random() * 3.2),
      takeProfitAtr: round(attack ? 1.4 + random() * 6.5 : 1.2 + random() * 7.8),
      trailingAtr: round(attack ? 0.5 + random() * 2.5 : 0.8 + random() * 4.2),
      maxHoldBars: Math.round((attack ? 3 : 4) + random() * (attack ? 45 : 76)),
      rebalanceBars: Math.round(1 + random() * (attack ? 10 : 18)),
      cooldownBars: Math.round(random() * (attack ? 5 : 10)),
      allowLong: bothDirections || random() > 0.35,
      allowShort: bothDirections || random() > 0.35,
      allowNeutralRegime: random() < (attack ? 0.5 : 0.3),
      neutralScoreThreshold: round((attack ? 0.05 : 0.15) + random() * (attack ? 1 : 1.5)),
    },
    random,
  );
}

function thesis(family: PerpFamily, researcher: ResearcherId, profile: PerpResearchProfile) {
  const text: Record<PerpFamily, string> = {
    regime_momentum: "BTCレジーム方向へ相対モメンタム上位・下位銘柄をLong/Shortする",
    breakout: "出来高を伴う高値・安値ブレイクを先物両方向で追随する",
    relative_strength: "ボラティリティ調整後の相対強弱で最も優位な銘柄を選ぶ",
    dual_direction: "上昇・下落レジームを対称に扱い、方向転換時にポジションを反転する",
  };
  return `${text[family]}。Profile=${profile}、担当=${researcher}`;
}

export function createInitialPerpPopulation(
  count: number,
  seed: number,
  profile: PerpResearchProfile,
): PerpStrategyGenome[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, (_, index) => {
    const researcher = RESEARCHERS[index % RESEARCHERS.length];
    const family = pick(FAMILIES, random);
    return {
      id: `${profile === "attack" ? "a" : "b"}p0-${String(index + 1).padStart(4, "0")}`,
      generation: 0,
      parentIds: [],
      createdBy: researcher.id,
      family,
      thesis: thesis(family, researcher.id, profile),
      symbols: [...pick(SYMBOL_SETS, random)],
      parameters: randomParameters(random, profile),
    };
  });
}

function crossover(
  left: PerpStrategyParameters,
  right: PerpStrategyParameters,
  random: () => number,
): PerpStrategyParameters {
  const choose = <K extends keyof PerpStrategyParameters>(key: K) => (random() > 0.5 ? left[key] : right[key]);
  return {
    timeframeHours: choose("timeframeHours"),
    leverage: choose("leverage"),
    riskPerTradePct: choose("riskPerTradePct"),
    maxMarginUsagePct: choose("maxMarginUsagePct"),
    btcRegimeSmaBars: choose("btcRegimeSmaBars"),
    btcRegimeMomentumBars: choose("btcRegimeMomentumBars"),
    regimeThresholdPct: choose("regimeThresholdPct"),
    momentumBars: choose("momentumBars"),
    breakoutBars: choose("breakoutBars"),
    breakoutBufferPct: choose("breakoutBufferPct"),
    minimumMomentumPct: choose("minimumMomentumPct"),
    minimumVolumeRatio: choose("minimumVolumeRatio"),
    minimumEdgeToCostRatio: choose("minimumEdgeToCostRatio"),
    volatilityLookbackBars: choose("volatilityLookbackBars"),
    volatilityPenalty: choose("volatilityPenalty"),
    atrBars: choose("atrBars"),
    stopAtr: choose("stopAtr"),
    takeProfitAtr: choose("takeProfitAtr"),
    trailingAtr: choose("trailingAtr"),
    maxHoldBars: choose("maxHoldBars"),
    rebalanceBars: choose("rebalanceBars"),
    cooldownBars: choose("cooldownBars"),
    allowLong: choose("allowLong"),
    allowShort: choose("allowShort"),
    allowNeutralRegime: choose("allowNeutralRegime"),
    neutralScoreThreshold: choose("neutralScoreThreshold"),
  };
}

function mutate(
  parameters: PerpStrategyParameters,
  researcher: ResearcherId,
  random: () => number,
  researchProfile: PerpResearchProfile,
) {
  const next = { ...parameters };
  const researcherProfile = RESEARCHERS.find((item) => item.id === researcher) ?? RESEARCHERS[0];
  const broad = researcherProfile.mutationFocus.includes("all");
  const should = (name: string) => broad || researcherProfile.mutationFocus.includes(name) || random() < 0.22;
  const attack = researchProfile === "attack";

  if (should("timeframe")) next.timeframeHours = pick(attack ? ATTACK_TIMEFRAMES : TIMEFRAMES, random);
  if (should("leverage")) next.leverage = jitter(next.leverage, attack ? 1.2 : 0.8, 1, 5, random, 2);
  if (should("risk")) next.riskPerTradePct = jitter(next.riskPerTradePct, attack ? 1.2 : 0.7, 0.25, 5, random, 2);
  if (should("allocation")) next.maxMarginUsagePct = jitter(next.maxMarginUsagePct, attack ? 15 : 12, 20, 100, random, 1);
  if (should("regime")) next.btcRegimeSmaBars = Math.round(jitter(next.btcRegimeSmaBars, 24, 10, 160, random, 0));
  if (should("regime")) next.btcRegimeMomentumBars = Math.round(jitter(next.btcRegimeMomentumBars, 10, 2, 60, random, 0));
  if (should("regime")) next.regimeThresholdPct = jitter(next.regimeThresholdPct, 0.015, 0, 0.1, random);
  if (should("momentum")) next.momentumBars = Math.round(jitter(next.momentumBars, 14, 2, 100, random, 0));
  if (should("breakout")) next.breakoutBars = Math.round(jitter(next.breakoutBars, 10, 2, 80, random, 0));
  if (should("breakout")) next.breakoutBufferPct = jitter(next.breakoutBufferPct, 0.01, 0, 0.06, random);
  if (should("momentum")) next.minimumMomentumPct = jitter(next.minimumMomentumPct, 0.025, 0, 0.15, random);
  if (should("volume")) next.minimumVolumeRatio = jitter(next.minimumVolumeRatio, 0.35, 0.3, 3, random);
  if (should("cost")) next.minimumEdgeToCostRatio = jitter(next.minimumEdgeToCostRatio, 1, 1, 10, random);
  if (should("volatility")) next.volatilityLookbackBars = Math.round(jitter(next.volatilityLookbackBars, 10, 4, 80, random, 0));
  if (should("volatility")) next.volatilityPenalty = jitter(next.volatilityPenalty, 0.8, 0, 5, random);
  if (should("atr")) next.atrBars = Math.round(jitter(next.atrBars, 7, 3, 60, random, 0));
  if (should("stop")) next.stopAtr = jitter(next.stopAtr, attack ? 0.6 : 0.8, 0.4, 6, random);
  if (should("takeProfit")) next.takeProfitAtr = jitter(next.takeProfitAtr, 1.8, 1, 15, random);
  if (should("trailing")) next.trailingAtr = jitter(next.trailingAtr, 1, 0.4, 8, random);
  if (should("holding")) next.maxHoldBars = Math.round(jitter(next.maxHoldBars, 18, 2, 160, random, 0));
  if (should("rotation")) next.rebalanceBars = Math.round(jitter(next.rebalanceBars, 5, 1, 40, random, 0));
  if (should("cooldown")) next.cooldownBars = Math.round(jitter(next.cooldownBars, 3, 0, 30, random, 0));
  if (should("direction")) next.allowLong = random() > 0.1;
  if (should("direction")) next.allowShort = random() > 0.1;
  if (should("neutral")) next.allowNeutralRegime = !next.allowNeutralRegime;
  if (should("neutral")) next.neutralScoreThreshold = jitter(next.neutralScoreThreshold, 0.45, 0.03, 3, random);

  if (attack && random() < 0.2) {
    next.leverage = jitter(next.leverage, 0.5, 3, 5, random, 2);
    next.riskPerTradePct = jitter(next.riskPerTradePct, 0.5, 2, 5, random, 2);
    next.stopAtr = jitter(next.stopAtr, 0.25, 0.4, 2.2, random);
    next.maxMarginUsagePct = jitter(next.maxMarginUsagePct, 8, 65, 100, random, 1);
  }

  return ensureDirection(next, random);
}

export function createNextPerpPopulation(input: {
  elites: PerpStrategyGenome[];
  count: number;
  generation: number;
  seed: number;
  profile: PerpResearchProfile;
}): PerpStrategyGenome[] {
  const random = createSeededRandom(input.seed + input.generation * 2029);
  if (!input.elites.length) {
    return createInitialPerpPopulation(input.count, input.seed + input.generation * 7919, input.profile);
  }

  return Array.from({ length: input.count }, (_, index) => {
    const left = pick(input.elites, random);
    const right = pick(input.elites, random);
    const researcher = RESEARCHERS[(input.generation + index) % RESEARCHERS.length];
    const family = random() < 0.55 ? left.family : random() < 0.8 ? right.family : pick(FAMILIES, random);
    const parameters = mutate(crossover(left.parameters, right.parameters, random), researcher.id, random, input.profile);
    const symbols = random() < 0.3
      ? [...pick(SYMBOL_SETS, random)]
      : [...(random() > 0.5 ? left.symbols : right.symbols)];

    return {
      id: `${input.profile === "attack" ? "a" : "b"}p${input.generation}-${String(index + 1).padStart(4, "0")}`,
      generation: input.generation,
      parentIds: left.id === right.id ? [left.id] : [left.id, right.id],
      createdBy: researcher.id,
      family,
      thesis: thesis(family, researcher.id, input.profile),
      symbols,
      parameters,
    };
  });
}
