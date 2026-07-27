export type PolymarketSide = "YES" | "NO";
export type PolymarketDecision = "Entry" | "Watch" | "Reject";
export type ResolutionRisk = "low" | "medium" | "high";

export type PolymarketMarketSnapshot = {
  marketId: string;
  title: string;
  category: string;
  deadlineIso: string;
  currentYesPrice: number;
  currentNoPrice: number;
  recommendedSide: PolymarketSide;
  estimatedProbability: number;
  edge: number;
  expectedReturn: number;
  liquidityUsd: number;
  spread: number;
  volume24h: number;
  evidenceStrength: number;
  sourceCount: number;
  primarySources: boolean;
  xSignalStrength: number;
  newsSignalStrength: number;
  ruleClarity: number;
  resolutionRisk: ResolutionRisk;
  negativeNews: boolean;
  strongOpposition: boolean;
  liquidityOk: boolean;
  conflictingSources?: boolean;
  complexRules?: boolean;
  newCategory?: boolean;
  actualResolutionSide?: PolymarketSide;
  finalYesPrice?: number;
  finalNoPrice?: number;
  maxYesPriceAfterEntry?: number;
  minYesPriceAfterEntry?: number;
  maxNoPriceAfterEntry?: number;
  minNoPriceAfterEntry?: number;
  notes?: string[];
};

export type PolymarketSnapshot = {
  snapshotIso: string;
  source: string;
  markets: PolymarketMarketSnapshot[];
};

export type PolymarketConfig = {
  minFinalScoreForEntry: number;
  watchScoreMin: number;
  minEdge: number;
  minExpectedReturn: number;
  minLiquidityUsd: number;
  maxSpread: number;
  stakeUsd: number;
  maxEntriesPerSnapshot: number;
  duplicateEntryPolicy: "skip" | "allow";
  takeProfitPct: number;
  stopLossPct: number;
  aiEscalationEnabled: boolean;
  aiEscalationScoreMin: number;
  aiEscalationScoreMax: number;
  targetAiUsagePct: number;
  weights: {
    evidence: number;
    mispricing: number;
    expectedReturn: number;
    liquidity: number;
    timeEdge: number;
    ruleClarity: number;
    risk: number;
  };
};

export type PolymarketScore = {
  market: PolymarketMarketSnapshot;
  entryPrice: number;
  evidenceScore: number;
  mispricingScore: number;
  expectedReturnScore: number;
  liquidityScore: number;
  timeEdgeScore: number;
  ruleClarityScore: number;
  riskScore: number;
  oppositionScore: number;
  finalScore: number;
  decision: PolymarketDecision;
  confidence: number;
  rejectReason: string | null;
  aiEscalated: boolean;
  aiReviewResult?: string | null;
};

export type SimulatedTrade = {
  tradeId: string;
  marketId: string;
  title: string;
  category: string;
  side: PolymarketSide;
  entryIso: string;
  exitIso: string;
  entryPrice: number;
  exitPrice: number;
  exitReason: "resolution" | "take_profit" | "stop_loss" | "open";
  stakeUsd: number;
  pnlUsd: number;
  roi: number;
  holdingHours: number;
  finalScore: number;
  expectedReturn: number;
  edge: number;
  entryReason: string;
  status: "closed" | "open";
};

export type PolymarketBacktestSummary = {
  snapshotPeriod: string;
  totalMarkets: number;
  totalTrades: number;
  entryCount: number;
  watchCount: number;
  rejectCount: number;
  aiEscalationCount: number;
  aiUsagePct: number;
  winRate: number;
  totalPnL: number;
  roi: number;
  averageReturn: number;
  maxDrawdown: number;
  bestTrade: SimulatedTrade | null;
  worstTrade: SimulatedTrade | null;
  categoryPerformance: Record<string, { trades: number; pnlUsd: number; roi: number }>;
  scoreBandPerformance: Record<string, { trades: number; pnlUsd: number; roi: number }>;
  rejectReasonCounts: Record<string, number>;
  scores: PolymarketScore[];
  trades: SimulatedTrade[];
};
