import type { CriticId, ResearcherId, StrategyFamily } from "./types";

export interface ResearcherProfile {
  id: ResearcherId;
  name: string;
  specialty: string;
  preferredFamilies: StrategyFamily[];
  mutationFocus: string[];
}

export const RESEARCHERS: ResearcherProfile[] = [
  {
    id: "alpha-trend",
    name: "Alpha Researcher / Trend",
    specialty: "持続的なトレンドとモメンタム継続を探す",
    preferredFamilies: ["trend", "momentum_rotation", "regime_hybrid"],
    mutationFocus: ["trendMinMomAccel", "trendMinEfficiencyRatio", "trendAlloc"],
  },
  {
    id: "alpha-breakout",
    name: "Alpha Researcher / Breakout",
    specialty: "出来高を伴うブレイクアウトを探す",
    preferredFamilies: ["breakout", "volatility", "regime_hybrid"],
    mutationFocus: ["trendBreakoutLookbackBars", "trendBreakoutMinPct", "trendMinVolumeRatio"],
  },
  {
    id: "alpha-range",
    name: "Alpha Researcher / Range",
    specialty: "レンジ内の反発と失敗ブレイクを探す",
    preferredFamilies: ["range", "mean_reversion", "regime_hybrid"],
    mutationFocus: ["rangeEntryMode", "rangeOverheatMax", "rangeMaxHoldBars"],
  },
  {
    id: "alpha-mean-reversion",
    name: "Alpha Researcher / Mean Reversion",
    specialty: "過熱・行き過ぎからの平均回帰を探す",
    preferredFamilies: ["mean_reversion", "range", "volatility"],
    mutationFocus: ["rangeEntryBestMom20Below", "rangeEntryBtcAdxBelow", "rangeExitMom20Above"],
  },
  {
    id: "quant-statistics",
    name: "Quant Researcher / Statistics",
    specialty: "サンプル数と安定性を重視してパラメータを整える",
    preferredFamilies: ["trend", "range", "regime_hybrid"],
    mutationFocus: ["trendDecisionTimeframe", "trendExitCheckTimeframe", "rangeMaxHoldBars"],
  },
  {
    id: "quant-regime",
    name: "Quant Researcher / Regime",
    specialty: "相場レジームごとの切替条件を探す",
    preferredFamilies: ["regime_hybrid", "trend", "range"],
    mutationFocus: ["rangeEntryBtcAdxBelow", "trendMinEfficiencyRatio", "trendRotationScoreGap"],
  },
  {
    id: "execution-cost",
    name: "Execution Researcher",
    specialty: "売買回数と約定コストを抑える",
    preferredFamilies: ["trend", "breakout", "momentum_rotation"],
    mutationFocus: ["trendRotationRequireConsecutiveBars", "trendRotationScoreGap", "trendBreakoutLookbackBars"],
  },
  {
    id: "exit-engineer",
    name: "Exit Engineer",
    specialty: "利確・撤退・トレーリング条件を改善する",
    preferredFamilies: ["trend", "range", "regime_hybrid"],
    mutationFocus: ["trendProfitTrailActivationPct", "trendProfitTrailRetracePct", "trendExitSma"],
  },
  {
    id: "portfolio-construction",
    name: "Portfolio Researcher",
    specialty: "配分と複数銘柄の組み合わせを改善する",
    preferredFamilies: ["momentum_rotation", "regime_hybrid", "volatility"],
    mutationFocus: ["trendAlloc", "rangeAlloc", "trendRotationWhileHolding"],
  },
  {
    id: "wildcard-innovation",
    name: "Wildcard Researcher",
    specialty: "既存の常識から外れた組み合わせを試す",
    preferredFamilies: ["volatility", "regime_hybrid", "breakout", "mean_reversion"],
    mutationFocus: ["all"],
  },
];

export const CRITICS: Array<{ id: CriticId; name: string; mission: string }> = [
  {
    id: "overfit-critic",
    name: "AI反対派 / Overfit",
    mission: "少数取引、特定期間依存、過剰なパラメータ調整を疑う",
  },
  {
    id: "tail-risk-critic",
    name: "AI反対派 / Tail Risk",
    mission: "最大DD、最悪月、急落時の破綻可能性を探す",
  },
  {
    id: "execution-critic",
    name: "AI反対派 / Execution",
    mission: "売買回数、約定コスト、実運用で再現できない条件を疑う",
  },
];
