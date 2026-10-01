import { IDLE_RESIDUAL_LONG_POLICY, type IdleResidualLongSymbol } from "../config/idleResidualLongPolicy";
import type { IdleFeatures, IdleH1Candle } from "./idle-priority-short-signal";
import { computeIdlePriorityFeatures } from "./idle-priority-short-signal";

export type IdleResidualLongSignal = {
  accepted: boolean;
  symbol: IdleResidualLongSymbol;
  route: string;
  side: "LONG" | "FLAT";
  holdHours: 12;
  features: IdleFeatures;
  reason: string;
  priority: number;
};

export function evaluateIdleResidualLongFeatures(symbol: IdleResidualLongSymbol, features: IdleFeatures): IdleResidualLongSignal {
  const route = IDLE_RESIDUAL_LONG_POLICY.routes[symbol];
  if (features.rel24 < route.rel24Min) {
    return { accepted: false, symbol, route: route.route, side: "FLAT", holdHours: 12, features, reason: "REL24_NOT_MET", priority: route.priority };
  }
  if (features.volumeRatio < route.volumeRatioMin) {
    return { accepted: false, symbol, route: route.route, side: "FLAT", holdHours: 12, features, reason: "VOLUME_RATIO_NOT_MET", priority: route.priority };
  }
  if (features.atrRatio < route.atrRatioMin) {
    return { accepted: false, symbol, route: route.route, side: "FLAT", holdHours: 12, features, reason: "ATR_RATIO_NOT_MET", priority: route.priority };
  }
  return { accepted: true, symbol, route: route.route, side: "LONG", holdHours: 12, features, reason: route.route, priority: route.priority };
}

export function evaluateIdleResidualLong(
  symbol: IdleResidualLongSymbol,
  decisionTs: number,
  symbolRows: readonly IdleH1Candle[],
  btcRows: readonly IdleH1Candle[],
): IdleResidualLongSignal {
  return evaluateIdleResidualLongFeatures(symbol, computeIdlePriorityFeatures(decisionTs, symbolRows, btcRows));
}

export function chooseIdleResidualLong(signals: readonly IdleResidualLongSignal[]) {
  return [...signals].filter((signal) => signal.accepted).sort((a, b) => a.priority - b.priority || a.symbol.localeCompare(b.symbol))[0];
}
