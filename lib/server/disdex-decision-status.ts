import fs from "node:fs/promises";
import path from "node:path";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

const STATUS = {
  candidate: "\u767a\u706b\u5019\u88dc",
  insufficient: "\u6761\u4ef6\u4e0d\u8db3",
  outsideHours: "\u5bfe\u8c61\u6642\u9593\u5916",
  unavailable: "\u53d6\u5f97\u4e0d\u80fd",
} as const;

type Sleeve = "V96" | "V52";
export type DecisionStatus = typeof STATUS[keyof typeof STATUS];

export type DecisionStatusItem = {
  symbol: string;
  sleeve: Sleeve;
  rank: number;
  score: number;
  scoreMax: number;
  status: DecisionStatus;
  side: "LONG" | "SHORT" | "WAIT";
  reason: string;
  checkedAt: string;
  source: string;
  dataUpdatedAt?: string;
  executionStatus?: string;
};

export type DecisionStatusSnapshot = {
  ok: boolean;
  readOnly: true;
  refreshIntervalMinutes: 5;
  checkedAt: string;
  source: string;
  v96: { items: DecisionStatusItem[]; runnerStatus?: string; runnerMessage?: string };
  v52: { marketOpen: boolean; marketLabel: string; items: DecisionStatusItem[]; runnerStatus?: string };
  error?: string;
};

type V96DecisionSnapshot = {
  version: 1;
  checkedAt: string;
  source: "disdex-v96-live-runner";
  strategyId: string;
  runnerMode: "paper" | "live";
  status: string;
  message: string;
  referenceTs: number | null;
  targetWeights: Record<string, number>;
  core: { regime: string; reasons: string[] };
  pengu: { side: number; targetGross: number; reason: string };
  execution: { finalGross: number; coreScale: number; penguClip: number; orderEligible: boolean };
};

type V52DecisionSnapshot = {
  version: 1;
  checkedAt: string;
  source: "disdex-v52-live-runner";
  strategyId: string;
  runnerMode: "paper" | "live";
  marketOpen: boolean;
  marketLabel: string;
  items: Array<{
    symbol: string;
    slot: "V11_EQ" | "V50_POST_OPEN_BASIS";
    status: "candidate" | "rejected" | "outside_hours" | "unavailable";
    side: "BUY" | "SELL" | "WAIT";
    reasons: string[];
    checkedAt: string;
    dataUpdatedAt?: string;
  }>;
};

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;
const V96_SNAPSHOT_FILE = process.env.DISDEX_V96_DECISION_SNAPSHOT_FILE?.trim()
  || path.join(process.cwd(), "data", "disdex-v96-decision-status.json");
const V52_SNAPSHOT_FILE = process.env.DISDEX_V52_DECISION_SNAPSHOT_FILE?.trim()
  || path.join(process.cwd(), "data", "disdex-v52-decision-status.json");

const REASON_LABELS: Record<string, string> = {
  FLAT: "BTC\u306e\u76f8\u5834\u74b0\u5883\u304c\u30d5\u30e9\u30c3\u30c8\u3067\u3059\u3002",
  BEAR: "\u5f31\u6c17\u76f8\u5834\u306e\u78ba\u8a8d\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002",
  BULL: "\u5f37\u6c17\u76f8\u5834\u306e\u78ba\u8a8d\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002",
  CORE_FLAT_BTC_REGIME: "BTC\u76f8\u5834\u304c\u30ed\u30f3\u30b0\u6761\u4ef6\u306e\u30ec\u30b8\u30fc\u30e0\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002",
  CORE_INSUFFICIENT_COMPONENT_AGREEMENT: "\u5bfe\u8c61\u9298\u67c4\u306e\u5f37\u6c17\u4e00\u81f4\u6570\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059\u3002",
  CORE_VOLUME_FAILED: "\u51fa\u6765\u9ad8\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002",
  CORE_BEAR_WAITING_CONFIRMATION: "\u5f31\u6c17\u5224\u5b9a\u306e\u7d99\u7d9a\u78ba\u8a8d\u4e2d\u3067\u3059\u3002",
  CORE_WEIGHT_BAND_IGNORED: "\u76ee\u6a19\u30a6\u30a7\u30a4\u30c8\u306e\u5dee\u304c\u8a31\u5bb9\u5e2f\u4ee5\u5185\u3067\u3059\u3002",
  CORE_TURNOVER_BELOW_20PCT: "\u30dd\u30fc\u30c8\u30d5\u30a9\u30ea\u30aa\u5909\u5316\u7387\u304c\u30ea\u30d0\u30e9\u30f3\u30b9\u95be\u5024\u672a\u6e80\u3067\u3059\u3002",
  ORDER_DELTA_BELOW_TOLERANCE: "\u6ce8\u6587\u5dee\u984d\u304c\u6700\u5c0f\u6ce8\u6587\u6761\u4ef6\u672a\u6e80\u3067\u3059\u3002",
  PENGU_FUNDING_MISSING: "PENGU\u306eFunding\u30c7\u30fc\u30bf\u304c\u53d6\u5f97\u3067\u304d\u305a\u30ed\u30f3\u30b0\u3092\u505c\u6b62\u3057\u3066\u3044\u307e\u3059\u3002",
  PENGU_VOLUME_FAILED: "PENGU\u306e\u51fa\u6765\u9ad8\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002",
  PENGU_TREND_FAILED: "PENGU\u306e\u30c8\u30ec\u30f3\u30c9\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002",
  PENGU_MOMENTUM_FAILED: "PENGU\u306e\u30e2\u30e1\u30f3\u30bf\u30e0\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002",
  PENGU_RELATIVE_MOMENTUM_FAILED: "PENGU\u306eBTC\u6bd4\u30e2\u30e1\u30f3\u30bf\u30e0\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002",
  PENGU_RSI_FAILED: "PENGU\u306eRSI\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002",
  PENGU_BTC_RISK_FAILED: "BTC\u30ea\u30b9\u30af\u6761\u4ef6\u306b\u3088\u308aPENGU\u3092\u505c\u6b62\u3057\u3066\u3044\u307e\u3059\u3002",
  NO_GROSS_CAPACITY: "\u4f7f\u7528\u53ef\u80fd\u306aGross\u304c\u3042\u308a\u307e\u305b\u3093\u3002",
  V11_GROSS_CAPACITY_INSUFFICIENT: "V11\u306e\u6ce8\u6587\u53ef\u80fd\u306a\u4f59\u529b\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059\u3002",
  BASIS_BELOW_75: "Basis\u304c75bps\u672a\u6e80\u3067\u3059\u3002",
  BASIS_BELOW_50: "Basis\u304c50bps\u672a\u6e80\u3067\u3059\u3002",
  SIGN_CHANGED: "\u30b7\u30b0\u30ca\u30eb\u5f8c\u306bBasis\u306e\u7b26\u53f7\u304c\u53cd\u8ee2\u3057\u3066\u3044\u307e\u3059\u3002",
  ADVERSE_BASIS_MOVE: "Basis\u304c\u4e0d\u5229\u306a\u65b9\u5411\u3078\u52d5\u3044\u3066\u3044\u307e\u3059\u3002",
  ROUND_TRIP_COST_OVER_60: "\u5f80\u5fa9\u30b3\u30b9\u30c8\u304c60bps\u3092\u8d85\u3048\u3066\u3044\u307e\u3059\u3002",
  NET_EDGE_BELOW_10: "\u63a8\u5b9aNet Edge\u304c10bps\u672a\u6e80\u3067\u3059\u3002",
  DEPTH_BELOW_2X: "\u677f\u306e\u6df1\u3055\u304c\u5fc5\u8981\u984d\u306e2\u500d\u672a\u6e80\u3067\u3059\u3002",
  SPREAD_OVER_20: "\u30b9\u30d7\u30ec\u30c3\u30c9\u304c20bps\u3092\u8d85\u3048\u3066\u3044\u307e\u3059\u3002",
  SAME_SYMBOL_ACTIVE: "\u540c\u3058\u9298\u67c4\u306e\u5efa\u7389\u304c\u65e2\u306b\u3042\u308a\u307e\u3059\u3002",
  REFERENCE_STALE: "\u682a\u4fa1Reference\u304c\u53e4\u3044\u305f\u3081\u505c\u6b62\u3057\u3066\u3044\u307e\u3059\u3002",
  REFERENCE_TIMESTAMP_FALLBACK: "Reference\u6642\u523b\u306e\u4ee3\u66ff\u5024\u3092\u4f7f\u7528\u3057\u3066\u3044\u307e\u3059\u3002",
  BOOK_STALE: "Aster\u677f\u30c7\u30fc\u30bf\u304c\u53e4\u3044\u305f\u3081\u505c\u6b62\u3057\u3066\u3044\u307e\u3059\u3002",
};

function translateDecisionReason(reason: string) {
  return REASON_LABELS[reason] || reason.replaceAll("V96 portfolio is within 5.00 USD tolerance.", "V96\u30dd\u30fc\u30c8\u30d5\u30a9\u30ea\u30aa\u306f\u8a31\u5bb9\u5dee5.00 USD\u4ee5\u5185\u3067\u3059\u3002");
}

function maxAgeMs() {
  const value = Number(process.env.DIST_TERMINAL_LIVE_DECISION_MAX_AGE_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_AGE_MS;
}

async function readSnapshot<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { return null; }
}

function isFresh(checkedAt: string, now: number) {
  const timestamp = Date.parse(checkedAt);
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= maxAgeMs();
}

function unknownItems(symbols: readonly string[], sleeve: Sleeve, checkedAt: string, reason: string): DecisionStatusItem[] {
  return symbols.map((symbol) => ({ symbol, sleeve, rank: 0, score: 0, scoreMax: 0, status: STATUS.unavailable, side: "WAIT", reason, checkedAt, source: "\u5b9fLIVE Runner\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8" }));
}

function v96Items(snapshot: V96DecisionSnapshot, checkedAt: string): DecisionStatusItem[] {
  const targetWeights = snapshot.targetWeights || {};
  const reasons = [...(snapshot.core?.reasons || []), snapshot.pengu?.reason, `LIVE Runner\u7d50\u679c: ${snapshot.status}${snapshot.message ? ` / ${snapshot.message}` : ""}`]
    .filter(Boolean).map((reason) => translateDecisionReason(String(reason)));
  return config.cryptoSymbols.map((symbol, index) => {
    const weight = Number(targetWeights[symbol] || 0);
    const active = weight !== 0 && snapshot.execution?.orderEligible === true;
    const side = active ? (weight > 0 ? "LONG" : weight < 0 ? "SHORT" : "WAIT") : "WAIT";
    return {
      symbol, sleeve: "V96", rank: active ? index + 1 : 0, score: active ? 1 : 0, scoreMax: 1,
      status: active ? STATUS.candidate : STATUS.insufficient, side,
      reason: active ? `\u5b9fLIVE\u30b7\u30b0\u30ca\u30eb\u3042\u308a\uff08target weight ${weight.toFixed(6)}\uff09\u3002${reasons.join(" / ")}` : reasons.join(" / ") || "\u5b9fLIVE Runner\u306e\u6700\u7d42target\u306b\u542b\u307e\u308c\u3066\u3044\u307e\u305b\u3093\u3002",
      checkedAt, source: "\u5b9fLIVE V96 Runner\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8",
      dataUpdatedAt: snapshot.referenceTs ? new Date(snapshot.referenceTs).toISOString() : undefined,
      executionStatus: snapshot.status,
    } satisfies DecisionStatusItem;
  }).sort((left, right) => Number(right.status === STATUS.candidate) - Number(left.status === STATUS.candidate) || left.symbol.localeCompare(right.symbol));
}

function v52Items(snapshot: V52DecisionSnapshot, checkedAt: string): DecisionStatusItem[] {
  const bySymbol = new Map<string, V52DecisionSnapshot["items"]>();
  for (const item of snapshot.items || []) { const current = bySymbol.get(item.symbol) || []; current.push(item); bySymbol.set(item.symbol, current); }
  return config.stockSymbols.map((symbol, index) => {
    const entries = bySymbol.get(symbol) || [];
    const candidate = entries.find((item) => item.status === "candidate");
    const reasons = entries.flatMap((item) => item.reasons || []).map((reason) => translateDecisionReason(String(reason)));
    const side = candidate?.side === "BUY" ? "LONG" : candidate?.side === "SELL" ? "SHORT" : "WAIT";
    const status: DecisionStatus = !snapshot.marketOpen ? STATUS.outsideHours : candidate ? STATUS.candidate : entries.some((item) => item.status === "unavailable") ? STATUS.unavailable : STATUS.insufficient;
    return {
      symbol, sleeve: "V52", rank: status === STATUS.candidate ? index + 1 : 0, score: status === STATUS.candidate ? 1 : 0, scoreMax: 1, status, side,
      reason: !snapshot.marketOpen ? "V52\u306e\u7c73\u56fd\u682a\u5f0f\u5e02\u5834\u304c\u5bfe\u8c61\u6642\u9593\u5916\u306e\u305f\u3081\u3001LIVE Runner\u306f\u65b0\u898f\u5224\u5b9a\u3092\u884c\u3063\u3066\u3044\u307e\u305b\u3093\u3002" : reasons.join(" / ") || (candidate ? "V52 LIVE Runner\u306e\u5168\u6761\u4ef6\u3092\u901a\u904e\u3057\u307e\u3057\u305f\u3002" : "V52 LIVE Runner\u306e\u5019\u88dc\u6761\u4ef6\u3092\u6e80\u305f\u3057\u3066\u3044\u307e\u305b\u3093\u3002"),
      checkedAt, source: "\u5b9fLIVE V52 Runner\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8", dataUpdatedAt: candidate?.dataUpdatedAt, executionStatus: candidate?.slot,
    } satisfies DecisionStatusItem;
  }).sort((left, right) => Number(right.status === STATUS.candidate) - Number(left.status === STATUS.candidate) || left.symbol.localeCompare(right.symbol));
}

export async function loadDecisionStatus(): Promise<DecisionStatusSnapshot> {
  const now = Date.now();
  const checkedAt = new Date(now).toISOString();
  const [v96, v52] = await Promise.all([readSnapshot<V96DecisionSnapshot>(V96_SNAPSHOT_FILE), readSnapshot<V52DecisionSnapshot>(V52_SNAPSHOT_FILE)]);
  const v96Ready = v96?.version === 1 && v96.runnerMode === "live" && isFresh(v96.checkedAt, now) && Boolean(v96.execution && typeof v96.execution.finalGross === "number");
  const v52Ready = v52?.version === 1 && v52.runnerMode === "live" && isFresh(v52.checkedAt, now) && Array.isArray(v52.items);
  const errors: string[] = [];
  if (!v96Ready) errors.push("V96\u306e\u5b9fLIVE\u5224\u5b9a\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8\u304c\u672a\u53d6\u5f97\u307e\u305f\u306f\u53e4\u3044\u72b6\u614b\u3067\u3059\u3002");
  if (!v52Ready) errors.push("V52\u306e\u5b9fLIVE\u5224\u5b9a\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8\u304c\u672a\u53d6\u5f97\u307e\u305f\u306f\u53e4\u3044\u72b6\u614b\u3067\u3059\u3002");
  return {
    ok: errors.length === 0, readOnly: true, refreshIntervalMinutes: 5, checkedAt,
    source: "V96/V52 LIVE Runner read-only snapshots",
    v96: v96Ready ? { items: v96Items(v96, checkedAt), runnerStatus: v96.status, runnerMessage: v96.message } : { items: unknownItems(config.cryptoSymbols, "V96", checkedAt, errors[0]) },
    v52: v52Ready ? { marketOpen: v52.marketOpen, marketLabel: v52.marketLabel, items: v52Items(v52, checkedAt) } : { marketOpen: false, marketLabel: "LIVE\u5224\u5b9a\u672a\u53d6\u5f97", items: unknownItems(config.stockSymbols, "V52", checkedAt, errors[1] || errors[0]) },
    error: errors.length ? errors.join(" ") : undefined,
  };
}
