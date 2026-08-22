export const TRADE_HISTORY_STRATEGY_IDS = [
  "V12",
  "V96",
  "PENGU_V2",
  "V52",
  "UNKNOWN",
] as const;

export type TradeHistoryStrategyId = (typeof TRADE_HISTORY_STRATEGY_IDS)[number];

export const TRADE_HISTORY_STRATEGY_LABELS: Record<TradeHistoryStrategyId, string> = {
  V12: "V12 X1.00 ALL",
  V96: "V96",
  PENGU_V2: "PENGU V2",
  V52: "V52 Stock",
  UNKNOWN: "未分類",
};

export function tradeHistoryStrategyLabel(strategyId?: TradeHistoryStrategyId) {
  return strategyId ? TRADE_HISTORY_STRATEGY_LABELS[strategyId] : "未分類";
}
