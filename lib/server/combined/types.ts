export type CombinedStrategyMode = "dry_run" | "live";

export type CombinedSignalSide = "long" | "short" | "flat";
export type CombinedLaneId = "pengu_goldcat" | "hype_freq" | "eth_reclaim";

export type CombinedSignalSnapshot = {
  checkedAt: string;
  signalTs: string | null;
  source: "goldcat_btc_15m";
  side: CombinedSignalSide;
  moveBps: number;
  elapsedSec: number | null;
  bidSupportRatio: number | null;
  spreadBps: number | null;
  accepted: boolean;
  reason: string;
};

export type CombinedSizingSnapshot = {
  checkedAt: string;
  laneId: CombinedLaneId;
  side: CombinedSignalSide;
  pengu15mAligned: boolean;
  strongAligned: boolean;
  moveBps: number;
  accelBps: number;
  multiplier: number;
  reason: string;
};

export type CombinedExecutionSnapshot = {
  checkedAt: string;
  mode: CombinedStrategyMode;
  laneId: CombinedLaneId;
  marketSymbol: string;
  executionSymbol: string;
  entryBreakoutBps: number;
  holdMinutes: number;
  minStopLossHoldMinutes: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
};

export type CombinedPositionState = {
  laneId: CombinedLaneId;
  symbol: string;
  marketSymbol: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  entryTs: string;
  entryCount?: number;
  sizeMultiplier: number;
  highWatermark: number;
  lowWatermark: number;
  sourceSignalTs: string;
  lastAddedAt?: string | null;
  externalOrderId?: string | null;
};

export type CombinedLaneCooldownState = {
  until: string;
  reason: string;
};

export type CombinedDecisionPayload = {
  ok: true;
  strategyType: "combined";
  strategyId: "combined";
  checkedAt: string;
  activeLaneId: CombinedLaneId;
  activeSignalTs: string | null;
  runtimeMode: CombinedStrategyMode;
  signal: CombinedSignalSnapshot;
  sizing: CombinedSizingSnapshot;
  execution: CombinedExecutionSnapshot;
  desiredAction: "enter" | "exit" | "hold" | "skip";
  desiredSide: CombinedSignalSide;
  desiredSymbol: string;
  currentPosition: CombinedPositionState | null;
  currentPositions?: CombinedPositionState[];
  reason: string;
  venue: "AsterDex";
  cachedAt: number;
};

export type CombinedRunWalletResult = {
  status: "skipped" | "noop" | "traded" | "error";
  step: "entry" | "exit" | "wait" | "hold";
  reason: string;
  desiredSymbol: string;
  desiredSide: "trend" | "range" | "cash";
  currentSymbol: string;
  amountWei?: string;
  trade?: {
    ok: boolean;
    txHash?: string;
    provider?: string;
    details?: string;
    quotedSourceAmount?: number;
    quotedDestAmount?: number;
    quotedSourceUsdValue?: number;
    quotedDestUsdValue?: number;
  };
};
