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

export type TradeHistoryAttributionTone =
  | "v12"
  | "v12-strong"
  | "v12-relaxed"
  | "v12-dynamic"
  | "q102"
  | "q102-high-vol"
  | "q102-brk"
  | "q102-mr"
  | "q102-pb"
  | "q102-rev"
  | "pengu"
  | "pengu-long-v2"
  | "recovery-v8"
  | "v64-dynamic"
  | "short-v20"
  | "v52"
  | "v52-v11eq"
  | "v52-v50"
  | "alternate-route"
  | "test-order"
  | "logic"
  | "unknown";

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

export function getTradeHistoryAttributionTone(attribution?: TradeHistoryAttribution): TradeHistoryAttributionTone {
  if (!attribution) return "unknown";
  if (attribution.classification === "test-order") return "test-order";
  const labels = `${attribution.logicLabel || ""} ${attribution.routeLabel || ""}`.toUpperCase();
  if (labels.includes("RECOVERY V8")) return "recovery-v8";
  if (labels.includes("V64 DYNAMIC LONG")) return "v64-dynamic";
  if (labels.includes("SHORT V20")) return "short-v20";
  if (labels.includes("LONG V2 FINAL")) return "pengu-long-v2";
  if (labels.includes("HIGH_VOL")) return "q102-high-vol";
  if (/\bBRK\b/.test(labels)) return "q102-brk";
  if (/\bMR\b/.test(labels)) return "q102-mr";
  if (/\bPB\b/.test(labels)) return "q102-pb";
  if (/\bREV\b/.test(labels)) return "q102-rev";
  if (labels.includes("STRONG QUALITY")) return "v12-strong";
  if (labels.includes("RELAXED MOMENTUM")) return "v12-relaxed";
  if (labels.includes("DYNAMIC RESIDUAL")) return "v12-dynamic";
  if (labels.includes("V11_EQ")) return "v52-v11eq";
  if (labels.includes("V50")) return "v52-v50";
  if (labels.includes("Q102") || labels.includes("QUALITY102")) return "q102";
  if (labels.includes("PENGU")) return "pengu";
  if (labels.includes("V52")) return "v52";
  if (labels.includes("V12")) return "v12";
  return attribution.classification === "alternate-route" ? "alternate-route" : attribution.classification === "logic" ? "logic" : "unknown";
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
  if (/recovery[_\s-]*v8|recv8-/i.test(reason)) return "Recovery V8";
  if (/v64[_\s-]*dynamic[_\s-]*long/i.test(reason)) return "V64 Dynamic Long";
  if (/short[_\s-]*v20/i.test(reason)) return "Short V20";
  if (/long[_\s-]*v2[_\s-]*final/i.test(reason)) return "Long V2 Final";
  if (/high[_\s-]*vol/i.test(reason)) return "HIGH_VOL";
  if (/(?:^|[^A-Z])BRK(?:[^A-Z]|$)/i.test(reason)) return "BRK";
  if (/(?:^|[^A-Z])MR(?:[^A-Z]|$)/i.test(reason)) return "MR";
  if (/(?:^|[^A-Z])PB(?:[^A-Z]|$)/i.test(reason)) return "PB";
  if (/(?:^|[^A-Z])REV(?:[^A-Z]|$)/i.test(reason)) return "REV";
  if (/strong[_\s-]*quality/i.test(reason)) return "Strong Quality";
  if (/relaxed[_\s-]*(?:momentum|mom)/i.test(reason)) return "Relaxed Momentum+ATR";
  if (/dynamic[_\s-]*residual/i.test(reason)) return "Dynamic Residual";
  if (/normal[_\s-]*score/i.test(reason)) return "Normal Score";
  if (/v11[_\s-]*eq/i.test(reason)) return "V11_EQ";
  if (/v50/i.test(reason)) return "V50";
  const route = reason.match(/(?:route|経路)\s*(?:=|:)\s*([^/]+)/i)?.[1]?.trim();
  return route || undefined;
}

function isTestMarker(reason: string) {
  return /recovered:onchain-swap|manual\s*(?:probe|test)|synthetic|dummy|micro\s*order|test\s*order|テスト注文|検証注文|手動検証/i.test(reason);
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

  if (officialSymbolInference && logic) {
    return {
      classification: route ? "alternate-route" : "logic",
      logicLabel: logic,
      ...(route ? { routeLabel: route } : {}),
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
