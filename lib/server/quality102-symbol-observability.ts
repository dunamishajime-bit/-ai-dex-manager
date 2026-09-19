import { readFile } from "node:fs/promises";

import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";

const DEFAULT_SNAPSHOT_PATH = "/var/lib/disdex/quality102-causal-v1/decision-snapshot.json";
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
};

export type Quality102SymbolSnapshot = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  capturedAt: string;
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
    };
  });
}

export async function loadQuality102SymbolObservability(): Promise<Quality102SymbolSnapshot> {
  const runtime = await loadCurrentProductionRuntime();
  const path = process.env.QUALITY102_DECISION_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH;
  const parsed = JSON.parse(await readFile(path, "utf8")) as PersistedSnapshot;

  if (parsed.strategyId !== "QUALITY102_CAUSAL_V1") throw new Error("Q102_DECISION_SNAPSHOT_STRATEGY_MISMATCH");
  if (parsed.selectorMode !== "CAUSAL_V4") throw new Error("Q102_DECISION_SNAPSHOT_SELECTOR_MISMATCH");
  if (String(parsed.runtimeCommitSha || "").toLowerCase() !== runtime.releaseSha.toLowerCase()) {
    throw new Error(`Q102_DECISION_SNAPSHOT_RUNTIME_MISMATCH:${parsed.runtimeCommitSha || "missing"}!=${runtime.releaseSha}`);
  }
  const capturedAt = String(parsed.capturedAt || "");
  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) throw new Error("Q102_DECISION_SNAPSHOT_CAPTURED_AT_INVALID");
  if (Date.now() - capturedAtMs > MAX_AGE_MS) throw new Error("Q102_DECISION_SNAPSHOT_STALE");

  const items = normalizedItems(parsed.items);
  if (!items.length) throw new Error("Q102_DECISION_SNAPSHOT_EMPTY");

  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    capturedAt,
    productionSha: runtime.releaseSha,
    selectorMode: parsed.selectorMode,
    referenceTs: Number(parsed.referenceTs || 0),
    ...(parsed.selectedSymbol ? { selectedSymbol: String(parsed.selectedSymbol).toUpperCase() } : {}),
    ...(parsed.selectedFamily ? { selectedFamily: String(parsed.selectedFamily) } : {}),
    selectedReason: String(parsed.selectedReason || ""),
    items,
  };
}
