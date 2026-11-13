/** Read-only identity used to deduplicate UI history rows (not order execution). */
export type HistoryFillIdentity = {
  id: string;
  provider?: string;
  tradeId?: string;
  orderId?: string;
  txHash?: string;
  sourceSymbol: string;
  destSymbol: string;
};

/**
 * The Aster userTrades feed identifies fills by tradeId. Several distinct
 * tradeIds may share a single orderId (partial fills). Never dedup them by
 * orderId: doing so misstates notional and can hide XRP executions.
 */
export function tradeHistoryDedupKeys(entry: HistoryFillIdentity): string[] {
  const prefix = entry.provider || "unknown";
  if (entry.tradeId) {
    return [`fill:${prefix}:${entry.sourceSymbol}:${entry.destSymbol}:${entry.tradeId}`];
  }
  if (entry.orderId) {
    return [`order:${prefix}:${entry.sourceSymbol}:${entry.destSymbol}:${entry.orderId}`];
  }
  if (entry.txHash) {
    return [`tx:${prefix}:${entry.txHash}`];
  }
  return [`id:${entry.id}`];
}
