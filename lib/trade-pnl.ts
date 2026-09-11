export type TradePnlValues = {
  realizedPnlUsd?: number;
  netPnlUsd?: number;
};

export function displayTradePnlUsd(entry: TradePnlValues): number | undefined {
  if (typeof entry.netPnlUsd === "number" && Number.isFinite(entry.netPnlUsd)) {
    return entry.netPnlUsd;
  }
  if (typeof entry.realizedPnlUsd === "number" && Number.isFinite(entry.realizedPnlUsd)) {
    return entry.realizedPnlUsd;
  }
  return undefined;
}
