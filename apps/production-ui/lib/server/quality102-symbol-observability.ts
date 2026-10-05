import { readFile } from "node:fs/promises";

import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";

const DEFAULT_DECISION_SNAPSHOT_PATH = "/var/lib/disdex/quality102-causal-v1/decision-snapshot.json";
const DEFAULT_RANKING_SNAPSHOT_PATH = "/var/lib/disdex/quality102-causal-v1/decision-ranking-snapshot.json";
const MAX_AGE_MS = 2 * 60 * 60_000;

export type Quality102SymbolDecision = {
  symbol: string;
  eligible: boolean;
  side: "LONG" | "SHORT" | "WAIT";
  family?: string;
  layer?: string;
  variant?: string;
  requestedGross: number;
  reason: string;
  selected: boolean;
  referenceTs: number;
  rankingScore?: number;
  rankingRank?: number;
  rankingFamily?: string;
  rankingLayer?: string;
  rankingVariant?: string;
  rankingStage?: string;
  rankingReason?: string;
  diagnostics?: Record<string, unknown>;
};

export type Quality102SymbolSnapshot = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  capturedAt: string;
  rankingCapturedAt?: string;
  observerCommitSha?: string;
  rankingModelVersion?: string;
  rankingAvailable: boolean;
  snapshotSource: "ranking" | "decision";
  productionSha: string;
  selectorMode: string;
  referenceTs: number;
  selectedSymbol?: string;
  selectedFamily?: string;
  selectedReason: string;
  items: Quality102SymbolDecision[];
};

type PersistedSnapshot = {
  schemaVersion?: number;
  rankingModelVersion?: string;
  rankingCapturedAt?: string;
  observerCommitSha?: string;
  strategyId?: string;
  selectorMode?: string;
  runtimeCommitSha?: string;
  capturedAt?: string;
  referenceTs?: number;
  selectedSymbol?: string;
  selectedFamily?: string;
  selectedReason?: string;
  items?: Quality102SymbolDecision[];
};

function normalizedItems(value: unknown): Quality102SymbolDecision[] {
  if (!Array.isArray(value)) throw new Error("Q102_DECISION_SNAPSHOT_ITEMS_INVALID");
  return value.map((item) => {
    const row = item as Partial<Quality102SymbolDecision>;
    const symbol = String(row.symbol || "").toUpperCase();
    if (!symbol) throw new Error("Q102_DECISION_SNAPSHOT_SYMBOL_MISSING");
    if (!["LONG", "SHORT", "WAIT"].includes(String(row.side))) throw new Error(`Q102_DECISION_SNAPSHOT_SIDE_INVALID:${symbol}`);
    const rankingScore = Number(row.rankingScore);
    const rankingRank = Number(row.rankingRank);
    return {
      symbol,
      eligible: row.eligible === true,
      side: row.side as Quality102SymbolDecision["side"],
      ...(row.family ? { family: String(row.family) } : {}),
      ...(row.layer ? { layer: String(row.layer) } : {}),
      ...(row.variant ? { variant: String(row.variant) } : {}),
      requestedGross: Number.isFinite(Number(row.requestedGross)) ? Number(row.requestedGross) : 0,
      reason: String(row.reason || ""),
      selected: row.selected === true,
      referenceTs: Number(row.referenceTs || 0),
      ...(Number.isFinite(rankingScore) ? { rankingScore } : {}),
      ...(Number.isFinite(rankingRank) && rankingRank > 0 ? { rankingRank } : {}),
      ...(row.rankingFamily ? { rankingFamily: String(row.rankingFamily) } : {}),
      ...(row.rankingLayer ? { rankingLayer: String(row.rankingLayer) } : {}),
      ...(row.rankingVariant ? { rankingVariant: String(row.rankingVariant) } : {}),
      ...(row.rankingStage ? { rankingStage: String(row.rankingStage) } : {}),
      ...(row.rankingReason ? { rankingReason: String(row.rankingReason) } : {}),
      ...(row.diagnostics && typeof row.diagnostics === "object" && !Array.isArray(row.diagnostics)
        ? { diagnostics: row.diagnostics as Record<string, unknown> }
        : {}),
    };
  });
}

function validateSnapshot(parsed: PersistedSnapshot, productionSha: string) {
  if (parsed.strategyId !== "QUALITY102_CAUSAL_V1") throw new Error("Q102_DECISION_SNAPSHOT_STRATEGY_MISMATCH");
  if (parsed.selectorMode !== "CAUSAL_V4") throw new Error("Q102_DECISION_SNAPSHOT_SELECTOR_MISMATCH");
  if (String(parsed.runtimeCommitSha || "").toLowerCase() !== productionSha.toLowerCase()) {
    throw new Error(`Q102_DECISION_SNAPSHOT_RUNTIME_MISMATCH:${parsed.runtimeCommitSha || "missing"}!=${productionSha}`);
  }
  const capturedAt = String(parsed.capturedAt || "");
  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) throw new Error("Q102_DECISION_SNAPSHOT_CAPTURED_AT_INVALID");
  if (Date.now() - capturedAtMs > MAX_AGE_MS) throw new Error("Q102_DECISION_SNAPSHOT_STALE");
  const items = normalizedItems(parsed.items);
  if (!items.length) throw new Error("Q102_DECISION_SNAPSHOT_EMPTY");
  return { capturedAt, items };
}

async function readSnapshot(path: string): Promise<PersistedSnapshot> {
  return JSON.parse(await readFile(path, "utf8")) as PersistedSnapshot;
}

export async function loadQuality102SymbolObservability(): Promise<Quality102SymbolSnapshot> {
  const runtime = await loadCurrentProductionRuntime();
  const rankingPath = process.env.QUALITY102_RANKING_SNAPSHOT_PATH || DEFAULT_RANKING_SNAPSHOT_PATH;
  const decisionPath = process.env.QUALITY102_DECISION_SNAPSHOT_PATH || DEFAULT_DECISION_SNAPSHOT_PATH;

  let parsed: PersistedSnapshot | undefined;
  let source: Quality102SymbolSnapshot["snapshotSource"] = "decision";
  let rankingError: unknown;
  try {
    const candidate = await readSnapshot(rankingPath);
    validateSnapshot(candidate, runtime.releaseSha);
    parsed = candidate;
    source = "ranking";
  } catch (error) {
    rankingError = error;
  }
  if (!parsed) {
    try {
      const candidate = await readSnapshot(decisionPath);
      validateSnapshot(candidate, runtime.releaseSha);
      parsed = candidate;
      source = "decision";
    } catch (decisionError) {
      throw new Error(`Q102_OBSERVABILITY_UNAVAILABLE:ranking=${rankingError instanceof Error ? rankingError.message : String(rankingError)};decision=${decisionError instanceof Error ? decisionError.message : String(decisionError)}`);
    }
  }

  const { capturedAt, items } = validateSnapshot(parsed, runtime.releaseSha);
  const rankingAvailable = source === "ranking"
    && parsed.schemaVersion === 2
    && parsed.rankingModelVersion === "Q102_PROXIMITY_V1"
    && items.some((item) => Number.isFinite(item.rankingScore));

  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    capturedAt,
    ...(parsed.rankingCapturedAt ? { rankingCapturedAt: String(parsed.rankingCapturedAt) } : {}),
    ...(parsed.observerCommitSha ? { observerCommitSha: String(parsed.observerCommitSha) } : {}),
    ...(parsed.rankingModelVersion ? { rankingModelVersion: String(parsed.rankingModelVersion) } : {}),
    rankingAvailable,
    snapshotSource: source,
    productionSha: runtime.releaseSha,
    selectorMode: parsed.selectorMode || "CAUSAL_V4",
    referenceTs: Number(parsed.referenceTs || 0),
    ...(parsed.selectedSymbol ? { selectedSymbol: String(parsed.selectedSymbol).toUpperCase() } : {}),
    ...(parsed.selectedFamily ? { selectedFamily: String(parsed.selectedFamily) } : {}),
    selectedReason: String(parsed.selectedReason || ""),
    items,
  };
}
