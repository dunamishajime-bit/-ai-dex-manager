export type TradeHistoryAttributionClassification =
  | "logic"
  | "alternate-route"
  | "test-order"
  | "unknown";

export type TradeHistoryAttributionEvidence =
  | "explicit"
  | "symbol-inference"
  | "negative-pnl-no-logic"
  | "unavailable";

export type TradeHistoryAttribution = {
  classification: TradeHistoryAttributionClassification;
  logicLabel?: string;
  routeLabel?: string;
  ranking?: number;
  evidence: TradeHistoryAttributionEvidence;
};

export type TradeHistoryAttributionInput = {
  source: "official-fill" | "local-ledger";
  strategyId?: string;
  reason?: string;
  realizedPnlUsd?: number;
  netPnlUsd?: number;
};

export function formatTradeHistoryAttributionLabel(input: {
  attribution?: TradeHistoryAttribution;
  strategyId?: string;
}) {
  const attribution = input.attribution;
  if (!attribution) return "発火経路不明";
  const ranking = attribution.ranking ? ` / Rank${attribution.ranking}` : "";
  if (attribution.classification === "test-order") return "テスト注文";
  if (attribution.classification === "alternate-route") {
    const logic = attribution.logicLabel || input.strategyId || "ロジック不明";
    return `別ルート発火: ${logic}${attribution.routeLabel ? ` / ${attribution.routeLabel}` : ""}${ranking}`;
  }
  if (attribution.classification === "logic") {
    return `ロジック発火: ${attribution.logicLabel || input.strategyId || "特定不可"}${ranking}`;
  }
  return `${attribution.logicLabel ? `${attribution.logicLabel}（推定）` : "発火経路不明"}${ranking}`;
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function extractRanking(reason: string) {
  const match = reason.match(/(?:ranking|rank|候補rank|順位)\s*(?:=|:)?\s*#?(\d+)/i);
  if (!match) return undefined;
  const ranking = Number(match[1]);
  return Number.isInteger(ranking) && ranking > 0 ? ranking : undefined;
}

function logicLabel(strategyId: string, reason: string) {
  const normalized = strategyId.toUpperCase();
  if (normalized.includes("QUALITY102") || normalized === "Q102") {
    return reason.toUpperCase().includes("CAUSAL_V4") ? "Q102 / CAUSAL_V4" : "Q102";
  }
  if (normalized.includes("PENGU")) return "PENGU";
  if (normalized.includes("V12")) return "V12";
  if (normalized.includes("V52")) return "V52";
  if (normalized.includes("V96")) return "V96";
  return undefined;
}

function explicitLogicId(strategyId: string, reason: string) {
  const label = logicLabel(strategyId, reason);
  if (label) return label;
  const upper = reason.toUpperCase();
  if (/QUALITY102|Q102/.test(upper)) return upper.includes("CAUSAL_V4") ? "Q102 / CAUSAL_V4" : "Q102";
  if (/PENGU/.test(upper)) return "PENGU";
  if (/V12/.test(upper)) return "V12";
  if (/V52/.test(upper)) return "V52";
  if (/V96/.test(upper)) return "V96";
  return undefined;
}

function routeLabel(reason: string) {
  if (/recovery\s*v8/i.test(reason)) return "Recovery V8";
  if (/v64\s*dynamic\s*long/i.test(reason)) return "V64 Dynamic Long";
  if (/short\s*v20/i.test(reason)) return "Short V20";
  const route = reason.match(/(?:route|経路)\s*(?:=|:)\s*([^/]+)/i)?.[1]?.trim();
  return route || undefined;
}

function isTestMarker(reason: string) {
  return /recovered:onchain-swap|manual\s*(?:probe|test)|synthetic|dummy|micro\s*order|test\s*order|テスト注文|検証注文|手動検証/i.test(reason);
}

function isNegative(input: TradeHistoryAttributionInput) {
  const pnl = input.netPnlUsd ?? input.realizedPnlUsd;
  return typeof pnl === "number" && Number.isFinite(pnl) && pnl < 0;
}

export function deriveTradeHistoryAttribution(
  input: TradeHistoryAttributionInput,
): TradeHistoryAttribution {
  const reason = normalizedText(input.reason);
  const strategy = normalizedText(input.strategyId);
  const ranking = extractRanking(reason);
  const route = routeLabel(reason);

  if (isTestMarker(reason)) {
    return {
      classification: "test-order",
      ...(ranking === undefined ? {} : { ranking }),
      evidence: "explicit",
    };
  }

  const officialSymbolInference = input.source === "official-fill"
    && /^Aster official fill\s*\//i.test(reason);
  const explicitLogic = !officialSymbolInference && Boolean(explicitLogicId(strategy, reason));
  const logic = explicitLogic ? explicitLogicId(strategy, reason) : logicLabel(strategy, reason);

  if (explicitLogic) {
    return {
      classification: route ? "alternate-route" : "logic",
      ...(logic ? { logicLabel: logic } : {}),
      ...(route ? { routeLabel: route } : {}),
      ...(ranking === undefined ? {} : { ranking }),
      evidence: "explicit",
    };
  }

  if (isNegative(input)) {
    return {
      classification: "test-order",
      evidence: "negative-pnl-no-logic",
    };
  }

  if (officialSymbolInference && logic) {
    return {
      classification: "unknown",
      logicLabel: logic,
      ...(ranking === undefined ? {} : { ranking }),
      evidence: "symbol-inference",
    };
  }

  return {
    classification: "unknown",
    ...(logic ? { logicLabel: logic } : {}),
    ...(ranking === undefined ? {} : { ranking }),
    evidence: "unavailable",
  };
}
