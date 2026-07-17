import { WIN80_ULTRA90_MAIN_STRATEGY } from "@/lib/win80-ultra90-main-strategy";

import type {
  ChampionDeepResearchState,
} from "./deep-research";
import type {
  PerpResearchConfig,
  PerpResearchResult,
  PerpStrategyGenome,
  PerpStrategyParameters,
} from "./types";

export const MAIN_STRATEGY_RESEARCH_LINEAGE_MARKER = "[WIN80_ULTRA90_LINEAGE]";

export const MAIN_STRATEGY_RESEARCH_POLICY = {
  version: 1,
  mode: "win80_ultra90_lineage" as const,
  title: "Win80 / Ultra90 Main-Lineage Research",
  mainStrategyId: WIN80_ULTRA90_MAIN_STRATEGY.id,
  mainStrategyLocked: true,
  autoPromotionToMain: false,
  productionLogicMutable: false,
  historicalReference: {
    period: "2025-07-01/2026-04-06",
    trades: 33,
    winRatePct: 90.91,
    arithmeticMonthlyPct: 17.61,
    compoundMonthlyPct: 16.81,
    maxDrawdownPct: -9.51,
    profitFactor: 16.51,
    untouchedOos: false,
  },
  researchTracks: [
    "Win80厳選Top-1思想を維持したままEntry品質・時間足・Cost耐性を深掘りする",
    "Ultra90級の強シグナルを別Family・別時間軸で再現できる近縁ロジックを開発する",
    "利益中50%分割とUltra90優先70% Rotationに近い低回転・高選別の資金移動条件を研究する",
  ],
  guardrails: [
    "本番メイン戦略WIN80_ULTRA90_TOP1_V1を研究結果で自動置換しない",
    "一度の子実験で変更するパラメータは1つだけに限定する",
    "同一期間の高成績を完全未使用OOSと表現しない",
    "採用された子もForward Paper候補までとし、実売買とメイン昇格は手動承認を必須とする",
    "清算発生・OOS悪化・Stress悪化・DD悪化は従来どおり拒否する",
  ],
} as const;

type ResearchConfigShape = Pick<PerpResearchConfig, "profile" | "symbols">;

function symbolsFromConfig(config: ResearchConfigShape) {
  const preferred = ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "LINK", "AAVE", "INJ", "NEAR"];
  const available = new Set(config.symbols.map((symbol) => symbol.toUpperCase()));
  const selected = preferred.filter((symbol) => available.has(symbol));
  return selected.length >= 5 ? selected : config.symbols.slice(0, 13);
}

function parameters(input: Partial<PerpStrategyParameters> & Pick<PerpStrategyParameters, "timeframeHours">): PerpStrategyParameters {
  return {
    timeframeHours: input.timeframeHours,
    leverage: input.leverage ?? 2.4,
    riskPerTradePct: input.riskPerTradePct ?? 1.6,
    maxMarginUsagePct: input.maxMarginUsagePct ?? 65,
    btcRegimeSmaBars: input.btcRegimeSmaBars ?? 60,
    btcRegimeMomentumBars: input.btcRegimeMomentumBars ?? 12,
    regimeThresholdPct: input.regimeThresholdPct ?? 0.008,
    momentumBars: input.momentumBars ?? 18,
    breakoutBars: input.breakoutBars ?? 12,
    breakoutBufferPct: input.breakoutBufferPct ?? 0.004,
    minimumMomentumPct: input.minimumMomentumPct ?? 0.012,
    minimumVolumeRatio: input.minimumVolumeRatio ?? 0.9,
    minimumEdgeToCostRatio: input.minimumEdgeToCostRatio ?? 4,
    volatilityLookbackBars: input.volatilityLookbackBars ?? 20,
    volatilityPenalty: input.volatilityPenalty ?? 1,
    atrBars: input.atrBars ?? 14,
    stopAtr: input.stopAtr ?? 1.5,
    takeProfitAtr: input.takeProfitAtr ?? 3.2,
    trailingAtr: input.trailingAtr ?? 1.4,
    maxHoldBars: input.maxHoldBars ?? 36,
    rebalanceBars: input.rebalanceBars ?? 6,
    cooldownBars: input.cooldownBars ?? 3,
    allowLong: input.allowLong ?? true,
    allowShort: input.allowShort ?? true,
    allowNeutralRegime: input.allowNeutralRegime ?? false,
    neutralScoreThreshold: input.neutralScoreThreshold ?? 0.5,
  };
}

export function buildMainStrategyResearchAnchors(config: ResearchConfigShape): PerpStrategyGenome[] {
  const attack = config.profile === "attack";
  const symbols = symbolsFromConfig(config);
  const mainId = MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyId;

  return [
    {
      id: "win80-lineage-core-v1",
      generation: 0,
      parentIds: [mainId],
      createdBy: "quant-regime",
      family: "relative_strength",
      thesis: `${MAIN_STRATEGY_RESEARCH_LINEAGE_MARKER} ${mainId}のScore80以上・厳選Top-1思想を、相対強度・BTCレジーム・高Edge/Cost条件で再検証する研究Proxy。本番ロジックは変更しない。`,
      symbols: [...symbols],
      parameters: parameters({
        timeframeHours: 6,
        leverage: attack ? 3.2 : 2.2,
        riskPerTradePct: attack ? 2.4 : 1.5,
        maxMarginUsagePct: attack ? 78 : 62,
        btcRegimeSmaBars: 60,
        btcRegimeMomentumBars: 12,
        regimeThresholdPct: 0.008,
        momentumBars: 18,
        breakoutBars: 12,
        minimumMomentumPct: 0.012,
        minimumVolumeRatio: 0.9,
        minimumEdgeToCostRatio: 4.2,
        rebalanceBars: 6,
        cooldownBars: 3,
      }),
    },
    {
      id: "win80-lineage-ultra-v1",
      generation: 0,
      parentIds: [mainId],
      createdBy: "alpha-breakout",
      family: "breakout",
      thesis: `${MAIN_STRATEGY_RESEARCH_LINEAGE_MARKER} ${mainId}のUltra90優先思想を、強いBreakout・Volume・Edge/Cost・非Neutral条件へ写像した近縁ロジック。本番のUltra90条件は固定する。`,
      symbols: [...symbols],
      parameters: parameters({
        timeframeHours: 4,
        leverage: attack ? 3.6 : 2.5,
        riskPerTradePct: attack ? 2.6 : 1.4,
        maxMarginUsagePct: attack ? 85 : 68,
        btcRegimeSmaBars: 48,
        btcRegimeMomentumBars: 8,
        regimeThresholdPct: 0.012,
        momentumBars: 12,
        breakoutBars: 8,
        breakoutBufferPct: 0.007,
        minimumMomentumPct: 0.018,
        minimumVolumeRatio: 1.15,
        minimumEdgeToCostRatio: 4.8,
        volatilityLookbackBars: 16,
        volatilityPenalty: 1.2,
        atrBars: 12,
        stopAtr: 1.3,
        takeProfitAtr: 4.2,
        trailingAtr: 1.6,
        maxHoldBars: 30,
        rebalanceBars: 4,
        cooldownBars: 4,
      }),
    },
    {
      id: "win80-lineage-rotation-v1",
      generation: 0,
      parentIds: [mainId],
      createdBy: "execution-cost",
      family: "regime_momentum",
      thesis: `${MAIN_STRATEGY_RESEARCH_LINEAGE_MARKER} ${mainId}の含み益時50%分割・Ultra90時70%優先Rotation思想を、低回転・高選別・Cost耐性重視で研究する近縁Proxy。自動的に本番配分へ反映しない。`,
      symbols: [...symbols],
      parameters: parameters({
        timeframeHours: 8,
        leverage: attack ? 3 : 1.9,
        riskPerTradePct: attack ? 2.2 : 1.2,
        maxMarginUsagePct: attack ? 75 : 55,
        btcRegimeSmaBars: 72,
        btcRegimeMomentumBars: 16,
        regimeThresholdPct: 0.006,
        momentumBars: 24,
        breakoutBars: 16,
        breakoutBufferPct: 0.003,
        minimumMomentumPct: 0.01,
        minimumVolumeRatio: 0.85,
        minimumEdgeToCostRatio: 3.8,
        volatilityLookbackBars: 24,
        volatilityPenalty: 0.8,
        atrBars: 16,
        stopAtr: 1.7,
        takeProfitAtr: 3.6,
        trailingAtr: 1.2,
        maxHoldBars: 48,
        rebalanceBars: 8,
        cooldownBars: 3,
      }),
    },
  ];
}

export function isMainStrategyLineageGenome(genome: PerpStrategyGenome) {
  return genome.thesis.includes(MAIN_STRATEGY_RESEARCH_LINEAGE_MARKER)
    || genome.parentIds.includes(MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyId)
    || genome.id.startsWith("win80-lineage-");
}

export function focusChampionStateOnMainStrategyLineage(
  state: ChampionDeepResearchState,
): ChampionDeepResearchState {
  const champions = state.champions.filter((item) => isMainStrategyLineageGenome(item.genome));
  const latestExperiments = state.latestExperiments.filter((item) => isMainStrategyLineageGenome(item.plan.childGenome));
  return {
    ...state,
    champions,
    latestExperiments,
    nextPlan: champions.length
      ? [
          ...state.nextPlan,
          "Win80/Ultra90系統だけを親として維持し、本番メイン戦略は固定したまま単一変更を続ける",
        ].slice(-6)
      : [
          "旧Championを研究親から外し、Win80 Top-1・Ultra90・低回転Rotationの3系統を新しい親として開始する",
          "本番メイン戦略は固定し、研究結果はForward Paper候補としてのみ比較する",
        ],
  };
}

export function focusPreviousResultOnMainStrategyLineage(
  result: PerpResearchResult | null,
): PerpResearchResult | null {
  if (!result) return null;
  const leaderboard = result.leaderboard.filter((item) => isMainStrategyLineageGenome(item.genome));
  if (!leaderboard.length) return null;
  const ids = new Set(leaderboard.map((item) => item.genome.id));
  const finalCandidates = result.finalCandidates.filter((item) => ids.has(item.genome.id));
  return {
    ...result,
    rounds: result.rounds.map((round) => ({
      ...round,
      evaluated: leaderboard.length,
      survivors: leaderboard.filter((item) => item.verdict !== "rejected").length,
      best: leaderboard[0] ?? null,
    })),
    leaderboard,
    finalCandidates,
    totalEvaluations: leaderboard.length,
    validatedStrategies: leaderboard.filter((item) => item.validation).length,
  };
}

export function mainStrategyResearchPolicyMarkdown() {
  const reference = MAIN_STRATEGY_RESEARCH_POLICY.historicalReference;
  return [
    "# Win80 / Ultra90 Main-Lineage Research Policy",
    "",
    `- Fixed production main strategy: ${MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyId}`,
    "- Main strategy lock: ON",
    "- Automatic promotion to production: OFF",
    "- Research output: Research / Forward Paper only",
    `- Historical reference: ${reference.trades} trades, win ${reference.winRatePct.toFixed(2)}%, compound monthly ${reference.compoundMonthlyPct.toFixed(2)}%, MaxDD ${reference.maxDrawdownPct.toFixed(2)}%, PF ${reference.profitFactor.toFixed(2)}`,
    "- Evidence warning: the historical reference was filtered after loss analysis and is not untouched OOS",
    "",
    "## Direction",
    "",
    ...MAIN_STRATEGY_RESEARCH_POLICY.researchTracks.map((item) => `- ${item}`),
    "",
    "## Non-negotiable guardrails",
    "",
    ...MAIN_STRATEGY_RESEARCH_POLICY.guardrails.map((item) => `- ${item}`),
  ].join("\n");
}
