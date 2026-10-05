import fs from "fs/promises";
import path from "path";

import type { CombinedLaneCooldownState, CombinedLaneId, CombinedPositionState } from "@/lib/server/combined/types";
import {
  COMBINED_ETH_EXECUTION_SYMBOL,
  COMBINED_ETH_MARKET_SYMBOL,
  COMBINED_EXECUTION_SYMBOL,
  COMBINED_HYPE_EXECUTION_SYMBOL,
  COMBINED_HYPE_MARKET_SYMBOL,
  COMBINED_MARKET_SYMBOL,
} from "@/lib/server/combined/config";

const STATE_PATH = path.join(process.cwd(), "data", "combined-state.json");

export type CombinedState = {
  updatedAt: string;
  currentPositions: CombinedPositionState[];
  currentPosition: CombinedPositionState | null;
  laneCooldowns?: Partial<Record<CombinedLaneId, CombinedLaneCooldownState | null>>;
};

const DEFAULT_STATE: CombinedState = {
  updatedAt: new Date(0).toISOString(),
  currentPositions: [],
  currentPosition: null,
  laneCooldowns: {},
};

function normalizeLaneCooldowns(input: any): Partial<Record<CombinedLaneId, CombinedLaneCooldownState | null>> {
  const laneIds: CombinedLaneId[] = ["pengu_goldcat", "hype_freq", "eth_reclaim"];
  return laneIds.reduce((acc, laneId) => {
    const value = input?.[laneId];
    if (value?.until && value?.reason) {
      acc[laneId] = {
        until: String(value.until),
        reason: String(value.reason),
      };
    }
    return acc;
  }, {} as Partial<Record<CombinedLaneId, CombinedLaneCooldownState | null>>);
}

function normalizePosition(input: any): CombinedPositionState {
  const symbol = String(input?.symbol || COMBINED_EXECUTION_SYMBOL);
  const laneId = input?.laneId === "hype_freq"
    ? "hype_freq"
    : input?.laneId === "eth_reclaim"
      ? "eth_reclaim"
      : symbol === COMBINED_HYPE_EXECUTION_SYMBOL
        ? "hype_freq"
        : symbol === COMBINED_ETH_EXECUTION_SYMBOL
          ? "eth_reclaim"
          : "pengu_goldcat";
  return {
    laneId,
    symbol,
    marketSymbol: String(
      input?.marketSymbol
      || (symbol === COMBINED_HYPE_EXECUTION_SYMBOL
        ? COMBINED_HYPE_MARKET_SYMBOL
        : symbol === COMBINED_ETH_EXECUTION_SYMBOL
          ? COMBINED_ETH_MARKET_SYMBOL
          : COMBINED_MARKET_SYMBOL),
    ),
    side: input?.side === "short" ? "short" : "long",
    quantity: Number(input?.quantity || 0),
    entryPrice: Number(input?.entryPrice || 0),
    entryTs: String(input?.entryTs || new Date(0).toISOString()),
    entryCount: Number(input?.entryCount || 1),
    sizeMultiplier: Number(input?.sizeMultiplier || 1),
    highWatermark: Number(input?.highWatermark || 0),
    lowWatermark: Number(input?.lowWatermark || 0),
    sourceSignalTs: String(input?.sourceSignalTs || new Date(0).toISOString()),
    lastAddedAt: input?.lastAddedAt ? String(input.lastAddedAt) : null,
    externalOrderId: input?.externalOrderId ? String(input.externalOrderId) : null,
  };
}

function sortPositions(positions: CombinedPositionState[]) {
  const priority = { pengu_goldcat: 0, hype_freq: 1, eth_reclaim: 2 } as const;
  return [...positions].sort((left, right) => {
    const diff = priority[left.laneId] - priority[right.laneId];
    if (diff !== 0) return diff;
    return Date.parse(left.entryTs) - Date.parse(right.entryTs);
  });
}

export async function loadCombinedState(): Promise<CombinedState> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CombinedState>;
    const currentPositions = Array.isArray((parsed as any).currentPositions)
      ? sortPositions((parsed as any).currentPositions.map((item: any) => normalizePosition(item)))
      : parsed.currentPosition && typeof parsed.currentPosition === "object"
        ? [normalizePosition(parsed.currentPosition)]
        : [];
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : DEFAULT_STATE.updatedAt,
      currentPositions,
      currentPosition: currentPositions[0] || null,
      laneCooldowns: normalizeLaneCooldowns((parsed as any).laneCooldowns),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export async function saveCombinedState(state: CombinedState) {
  const currentPositions = sortPositions(Array.isArray(state.currentPositions) ? state.currentPositions : (state.currentPosition ? [state.currentPosition] : []));
  const next: CombinedState = {
    ...state,
    currentPositions,
    currentPosition: currentPositions[0] || null,
    laneCooldowns: normalizeLaneCooldowns(state.laneCooldowns),
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}
