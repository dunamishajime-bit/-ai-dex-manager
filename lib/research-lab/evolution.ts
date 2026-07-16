import { RESEARCHERS } from "./roles";
import type { ResearcherId, StrategyFamily, StrategyGenome } from "./types";

const FAMILIES: StrategyFamily[] = [
  "trend",
  "breakout",
  "range",
  "mean_reversion",
  "momentum_rotation",
  "volatility",
  "regime_hybrid",
];

const RANGE_ENTRY_MODES: StrategyGenome["parameters"]["rangeEntryMode"][] = [
  "mean_revert",
  "box_rebound",
  "reclaim",
  "wick_rejection",
  "midline_reclaim",
  "volatility_spring",
  "failed_breakdown",
  "atr_snapback",
  "compression_turn",
  "sma_reclaim_pulse",
  "atr_or_failed_breakdown",
];

const DECISION_TIMEFRAMES: StrategyGenome["parameters"]["trendDecisionTimeframe"][] = ["4h", "6h", "12h", "1d"];
const EXIT_TIMEFRAMES: StrategyGenome["parameters"]["trendExitCheckTimeframe"][] = ["4h", "6h", "12h"];
const MARKET_SETS = [
  ["ETH", "SOL", "AVAX"],
  ["ETH", "SOL", "BNB", "LINK", "AVAX"],
  ["SOL", "AVAX", "LINK"],
  ["ETH", "BNB", "SOL"],
];

export function createSeededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

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

function jitter(value: number, amount: number, min: number, max: number, random: () => number) {
  const shifted = value + (random() * 2 - 1) * amount;
  return round(clamp(shifted, min, max));
}

function randomParameters(random: () => number): StrategyGenome["parameters"] {
  return {
    trendDecisionTimeframe: pick(DECISION_TIMEFRAMES, random),
    trendExitCheckTimeframe: pick(EXIT_TIMEFRAMES, random),
    trendAlloc: round(0.55 + random() * 0.45, 2),
    rangeAlloc: round(0.2 + random() * 0.45, 2),
    rangeEntryMode: pick(RANGE_ENTRY_MODES, random),
    trendExitSma: random() > 0.5 ? 40 : 45,
    trendBreakoutLookbackBars: Math.round(4 + random() * 26),
    trendBreakoutMinPct: round(random() * 0.08),
    trendMinVolumeRatio: round(0.7 + random() * 1.1),
    trendMinMomAccel: round(-0.04 + random() * 0.1),
    trendMinEfficiencyRatio: round(0.05 + random() * 0.55),
    trendProfitTrailActivationPct: round(0.04 + random() * 0.3),
    trendProfitTrailRetracePct: round(0.02 + random() * 0.16),
    rangeEntryBestMom20Below: round(-0.08 + random() * 0.18),
    rangeEntryBtcAdxBelow: round(12 + random() * 28, 2),
    rangeOverheatMax: round(-0.08 + random() * 0.1),
    rangeExitMom20Above: round(-0.01 + random() * 0.12),
    rangeMaxHoldBars: Math.round(4 + random() * 44),
    trendRotationWhileHolding: random() > 0.45,
    trendRotationScoreGap: round(2 + random() * 22, 2),
    trendRotationRequireConsecutiveBars: Math.round(1 + random() * 4),
  };
}

function thesisFor(family: StrategyFamily, researcher: ResearcherId) {
  const familyText: Record<StrategyFamily, string> = {
    trend: "強いトレンドだけを保有し、弱化時に素早く退出する",
    breakout: "出来高と効率性を伴うブレイクだけを採用する",
    range: "低ADX環境の反発と失敗ブレイクを利用する",
    mean_reversion: "短期的な過熱・売られ過ぎからの回帰を狙う",
    momentum_rotation: "相対的に強い銘柄へ継続的に資金を移す",
    volatility: "ボラティリティ収縮後の拡大と反転を捉える",
    regime_hybrid: "トレンドとレンジを相場状態に応じて切り替える",
  };
  return `${familyText[family]}。担当=${researcher}`;
}

export function createInitialPopulation(count: number, seed: number): StrategyGenome[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, (_, index) => {
    const researcher = RESEARCHERS[index % RESEARCHERS.length];
    const family = random() < 0.72
      ? pick(researcher.preferredFamilies, random)
      : pick(FAMILIES, random);
    return {
      id: `g0-${String(index + 1).padStart(4, "0")}`,
      generation: 0,
      parentIds: [],
      createdBy: researcher.id,
      family,
      thesis: thesisFor(family, researcher.id),
      markets: [...pick(MARKET_SETS, random)],
      parameters: randomParameters(random),
    };
  });
}

function crossoverParameters(
  left: StrategyGenome["parameters"],
  right: StrategyGenome["parameters"],
  random: () => number,
): StrategyGenome["parameters"] {
  const choose = <K extends keyof StrategyGenome["parameters"]>(key: K) =>
    (random() > 0.5 ? left[key] : right[key]);

  return {
    trendDecisionTimeframe: choose("trendDecisionTimeframe"),
    trendExitCheckTimeframe: choose("trendExitCheckTimeframe"),
    trendAlloc: choose("trendAlloc"),
    rangeAlloc: choose("rangeAlloc"),
    rangeEntryMode: choose("rangeEntryMode"),
    trendExitSma: choose("trendExitSma"),
    trendBreakoutLookbackBars: choose("trendBreakoutLookbackBars"),
    trendBreakoutMinPct: choose("trendBreakoutMinPct"),
    trendMinVolumeRatio: choose("trendMinVolumeRatio"),
    trendMinMomAccel: choose("trendMinMomAccel"),
    trendMinEfficiencyRatio: choose("trendMinEfficiencyRatio"),
    trendProfitTrailActivationPct: choose("trendProfitTrailActivationPct"),
    trendProfitTrailRetracePct: choose("trendProfitTrailRetracePct"),
    rangeEntryBestMom20Below: choose("rangeEntryBestMom20Below"),
    rangeEntryBtcAdxBelow: choose("rangeEntryBtcAdxBelow"),
    rangeOverheatMax: choose("rangeOverheatMax"),
    rangeExitMom20Above: choose("rangeExitMom20Above"),
    rangeMaxHoldBars: choose("rangeMaxHoldBars"),
    trendRotationWhileHolding: choose("trendRotationWhileHolding"),
    trendRotationScoreGap: choose("trendRotationScoreGap"),
    trendRotationRequireConsecutiveBars: choose("trendRotationRequireConsecutiveBars"),
  };
}

function mutateParameters(
  parameters: StrategyGenome["parameters"],
  researcher: ResearcherId,
  random: () => number,
): StrategyGenome["parameters"] {
  const next = { ...parameters };
  const profile = RESEARCHERS.find((item) => item.id === researcher) ?? RESEARCHERS[0];
  const broadMutation = profile.mutationFocus.includes("all");
  const shouldMutate = (key: string) => broadMutation || profile.mutationFocus.includes(key) || random() < 0.18;

  if (shouldMutate("trendDecisionTimeframe")) next.trendDecisionTimeframe = pick(DECISION_TIMEFRAMES, random);
  if (shouldMutate("trendExitCheckTimeframe")) next.trendExitCheckTimeframe = pick(EXIT_TIMEFRAMES, random);
  if (shouldMutate("trendAlloc")) next.trendAlloc = jitter(next.trendAlloc, 0.16, 0.35, 1, random);
  if (shouldMutate("rangeAlloc")) next.rangeAlloc = jitter(next.rangeAlloc, 0.16, 0.1, 0.8, random);
  if (shouldMutate("rangeEntryMode")) next.rangeEntryMode = pick(RANGE_ENTRY_MODES, random);
  if (shouldMutate("trendExitSma")) next.trendExitSma = next.trendExitSma === 40 ? 45 : 40;
  if (shouldMutate("trendBreakoutLookbackBars")) next.trendBreakoutLookbackBars = Math.round(jitter(next.trendBreakoutLookbackBars, 7, 3, 40, random));
  if (shouldMutate("trendBreakoutMinPct")) next.trendBreakoutMinPct = jitter(next.trendBreakoutMinPct, 0.025, 0, 0.12, random);
  if (shouldMutate("trendMinVolumeRatio")) next.trendMinVolumeRatio = jitter(next.trendMinVolumeRatio, 0.3, 0.5, 2.5, random);
  if (shouldMutate("trendMinMomAccel")) next.trendMinMomAccel = jitter(next.trendMinMomAccel, 0.025, -0.1, 0.15, random);
  if (shouldMutate("trendMinEfficiencyRatio")) next.trendMinEfficiencyRatio = jitter(next.trendMinEfficiencyRatio, 0.14, 0, 0.9, random);
  if (shouldMutate("trendProfitTrailActivationPct")) next.trendProfitTrailActivationPct = jitter(next.trendProfitTrailActivationPct, 0.08, 0.02, 0.6, random);
  if (shouldMutate("trendProfitTrailRetracePct")) next.trendProfitTrailRetracePct = jitter(next.trendProfitTrailRetracePct, 0.05, 0.01, 0.35, random);
  if (shouldMutate("rangeEntryBestMom20Below")) next.rangeEntryBestMom20Below = jitter(next.rangeEntryBestMom20Below, 0.05, -0.2, 0.2, random);
  if (shouldMutate("rangeEntryBtcAdxBelow")) next.rangeEntryBtcAdxBelow = jitter(next.rangeEntryBtcAdxBelow, 7, 8, 55, random);
  if (shouldMutate("rangeOverheatMax")) next.rangeOverheatMax = jitter(next.rangeOverheatMax, 0.035, -0.2, 0.1, random);
  if (shouldMutate("rangeExitMom20Above")) next.rangeExitMom20Above = jitter(next.rangeExitMom20Above, 0.04, -0.08, 0.25, random);
  if (shouldMutate("rangeMaxHoldBars")) next.rangeMaxHoldBars = Math.round(jitter(next.rangeMaxHoldBars, 10, 2, 80, random));
  if (shouldMutate("trendRotationWhileHolding")) next.trendRotationWhileHolding = !next.trendRotationWhileHolding;
  if (shouldMutate("trendRotationScoreGap")) next.trendRotationScoreGap = jitter(next.trendRotationScoreGap, 6, 0, 40, random);
  if (shouldMutate("trendRotationRequireConsecutiveBars")) next.trendRotationRequireConsecutiveBars = Math.round(jitter(next.trendRotationRequireConsecutiveBars, 2, 1, 8, random));

  return next;
}

export function createNextPopulation(input: {
  elites: StrategyGenome[];
  count: number;
  generation: number;
  seed: number;
}): StrategyGenome[] {
  const { elites, count, generation, seed } = input;
  const random = createSeededRandom(seed + generation * 1009);
  if (!elites.length) return createInitialPopulation(count, seed + generation * 7919);

  return Array.from({ length: count }, (_, index) => {
    const left = pick(elites, random);
    const right = pick(elites, random);
    const researcher = RESEARCHERS[(generation + index) % RESEARCHERS.length];
    const family = random() < 0.6 ? left.family : random() < 0.75 ? right.family : pick(researcher.preferredFamilies, random);
    const crossed = crossoverParameters(left.parameters, right.parameters, random);
    const parameters = mutateParameters(crossed, researcher.id, random);
    const markets = random() > 0.35
      ? [...(random() > 0.5 ? left.markets : right.markets)]
      : [...pick(MARKET_SETS, random)];

    return {
      id: `g${generation}-${String(index + 1).padStart(4, "0")}`,
      generation,
      parentIds: left.id === right.id ? [left.id] : [left.id, right.id],
      createdBy: researcher.id,
      family,
      thesis: thesisFor(family, researcher.id),
      markets,
      parameters,
    };
  });
}
