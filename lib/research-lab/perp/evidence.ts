import type { PerpBacktestResult } from "./types";

export function compactPerpBacktestResult(result: PerpBacktestResult, tradeLimit = 100): PerpBacktestResult {
  return {
    ...result,
    trades: result.trades.slice(-tradeLimit),
    equityCurve: [],
  };
}
