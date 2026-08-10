export type TradeCloseDateLike = {
  executedAt: string;
  closedAt?: string;
};

export function tradeCloseDate(entry: TradeCloseDateLike) {
  return new Date(entry.closedAt || entry.executedAt);
}

export function tradeHistoryAnchorId(id: string) {
  return `trade-${id.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}
