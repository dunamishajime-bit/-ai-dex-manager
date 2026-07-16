import { createSeededRandom } from "../evolution";
import { RESEARCHERS } from "../roles";
import type { ResearcherId } from "../types";
import type { PerpFamily, PerpStrategyGenome, PerpStrategyParameters, PerpTimeframeHours } from "./types";

const FAMILIES: PerpFamily[] = ["regime_momentum", "breakout", "relative_strength", "dual_direction"];
const TIMEFRAMES: PerpTimeframeHours[] = [2, 4, 6, 8, 12];
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

function randomParameters(random: () => number): PerpStrategyParameters {
  const bothDirections = random() < 0.75;
  return ensureDirection(
    {
      timeframeHours: pick(TIMEFRAMES, random),
      leverage: round(1 + random() * 4, 2),
      riskPerTradePct: round(0.5 + random() * 3.5, 2),
      maxMarginUsagePct: round(35 + random() * 65, 1),
      btcRegimeSmaBars: Math.round(20 + random() * 100),
      btcRegimeMomentumBars: Math.round(4 + random() * 36),
      regimeThresholdPct: round(0.002 + random() * 0.05),
      momentumBars: Math.round(4 + random() * 56),
      breakoutBars: Math.round(4 + random() * 36),
      breakoutBufferPct: round(random() * 0.025),
      minimumMomentumPct: round(0.003 + random() * 0.08),
      minimumVolumeRatio: round(0.6 + random() * 1.2),
      volatilityLookbackBars: Math.round(6 + random() * 34),
      volatilityPenalty: round(random() * 2.5),
      atrBars: Math.round(6 + random() * 24),
      stopAtr: round(0.8 + random() * 3.2),
      takeProfitAtr: round(1.2 + random() * 7.8),
      trailingAtr: round(0.8 + random() * 4.2),
      maxHoldBars: Math.round(4 + random() * 76),
      rebalanceBars: Math.round(1 + random() * 18),
      cooldownBars: Math.round(random() * 10),
      allowLong: bothDirections || random() > 0.35,
      allowShort: bothDirections || random() > 0.35,
      allowNeutralRegime: random() < 0.3,
      neutralScoreThreshold: round(0.15 + random() * 1.5),
    },
    random,
  );
}

function thesis(family: PerpFamily, researcher: ResearcherId) {
  const text: Record<PerpFamily, string> = {
    regime_momentum: "BTCレジーム方向へ相対モメンタム上位・下位銘柄をLong/Shortする",
    breakout: "出来高を伴う高値・安値ブレイクを先物両方向で追随する",
    relative_strength: "ボラティリティ調整後の相対強弱で最も優位な銘柄を選ぶ",
    dual_direction: "上昇・下落レジームを対称に扱い、方向転換時にポジションを反転する",
  };
  return `${text[family]}。担当=${researcher}`;
}

export function createInitialPerpPopulation(count: number, seed: number): PerpStrategyGenome[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, (_, index) => {
    const researcher = RESEARCHERS[index % RESEARCHERS.length];
    const family = pick(FAMILIES, random);
    return {
      id: `p0-${String(index + 1).padStart(4, "0")}`,
      generation: 0,
      parentIds: [],
      createdBy: researcher.id,
      family,
      thesis: thesis(family, researcher.id),
      symbols: [...pick(SYMBOL_SETS, random)],
      parameters: randomParameters(random),
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

function mutate(parameters: PerpStrategyParameters, researcher: ResearcherId, random: () => number) {
  const next = { ...parameters };
  const profile = RESEARCHERS.find((item) => item.id === researcher) ?? RESEARCHERS[0];
  const broad = profile.mutationFocus.includes("all");
  const should = (name: string) => broad || profile.mutationFocus.includes(name) || random() < 0.2;

  if (should("timeframe")) next.timeframeHours = pick(TIMEFRAMES, random);
  if (should("leverage")) next.leverage = jitter(next.leverage, 1, 1, 5, random, 2);
  if (should("risk")) next.riskPerTradePct = jitter(next.riskPerTradePct, 0.9, 0.25, 5, random, 2);
  if (should("allocation")) next.maxMarginUsagePct = jitter(next.maxMarginUsagePct, 18, 20, 100, random, 1);
  if (should("regime")) next.btcRegimeSmaBars = Math.round(jitter(next.btcRegimeSmaBars, 24, 10, 160, random, 0));
  if (should("regime")) next.btcRegimeMomentumBars = Math.round(jitter(next.btcRegimeMomentumBars, 10, 2, 60, random, 0));
  if (should("regime")) next.regimeThresholdPct = jitter(next.regimeThresholdPct, 0.015, 0, 0.1, random);
  if (should("momentum")) next.momentumBars = Math.round(jitter(next.momentumBars, 14, 2, 100, random, 0));
  if (should("breakout")) next.breakoutBars = Math.round(jitter(next.breakoutBars, 10, 2, 80, random, 0));
  if (should("breakout")) next.breakoutBufferPct = jitter(next.breakoutBufferPct, 0.01, 0, 0.06, random);
  if (should("momentum")) next.minimumMomentumPct = jitter(next.minimumMomentumPct, 0.025, 0, 0.15, random);
  if (should("volume")) next.minimumVolumeRatio = jitter(next.minimumVolumeRatio, 0.35, 0.3, 3, random);
  if (should("volatility")) next.volatilityLookbackBars = Math.round(jitter(next.volatilityLookbackBars, 10, 4, 80, random, 0));
  if (should("volatility")) next.volatilityPenalty = jitter(next.volatilityPenalty, 0.8, 0, 5, random);
  if (should("atr")) next.atrBars = Math.round(jitter(next.atrBars, 7, 3, 60, random, 0));
  if (should("stop")) next.stopAtr = jitter(next.stopAtr, 0.8, 0.5, 6, random);
  if (should("takeProfit")) next.takeProfitAtr = jitter(next.takeProfitAtr, 1.8, 1, 15, random);
  if (should("trailing")) next.trailingAtr = jitter(next.trailingAtr, 1, 0.5, 8, random);
  if (should("holding")) next.maxHoldBars = Math.round(jitter(next.maxHoldBars, 18, 2, 160, random, 0));
  if (should("rotation")) next.rebalanceBars = Math.round(jitter(next.rebalanceBars, 5, 1, 40, random, 0));
  if (should("cooldown")) next.cooldownBars = Math.round(jitter(next.cooldownBars, 3, 0, 30, random, 0));
  if (should("direction")) next.allowLong = random() > 0.15;
  if (should("direction")) next.allowShort = random() > 0.15;
  if (should("neutral")) next.allowNeutralRegime = !next.allowNeutralRegime;
  if (should("neutral")) next.neutralScoreThreshold = jitter(next.neutralScoreThreshold, 0.45, 0.05, 3, random);

  return ensureDirection(next, random);
}

export function createNextPerpPopulation(input: {
  elites: PerpStrategyGenome[];
  count: number;
  generation: number;
  seed: number;
}): PerpStrategyGenome[] {
  const random = createSeededRandom(input.seed + input.generation * 2029);
  if (!input.elites.length) return createInitialPerpPopulation(input.count, input.seed + input.generation * 7919);

  return Array.from({ length: input.count }, (_, index) => {
    const left = pick(input.elites, random);
    const right = pick(input.elites, random);
    const researcher = RESEARCHERS[(input.generation + index) % RESEARCHERS.length];
    const family = random() < 0.55 ? left.family : random() < 0.8 ? right.family : pick(FAMILIES, random);
    const parameters = mutate(crossover(left.parameters, right.parameters, random), researcher.id, random);
    const symbols = random() < 0.3
      ? [...pick(SYMBOL_SETS, random)]
      : [...(random() > 0.5 ? left.symbols : right.symbols)];

    return {
      id: `p${input.generation}-${String(index + 1).padStart(4, "0")}`,
      generation: input.generation,
      parentIds: left.id === right.id ? [left.id] : [left.id, right.id],
      createdBy: researcher.id,
      family,
      thesis: thesis(family, researcher.id),
      symbols,
      parameters,
    };
  });
}
