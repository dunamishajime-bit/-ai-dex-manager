import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { DISDEX_V50_CONFIG } from "../config/disdexStockRouterV13DV11EqRuntime";
import { QUALITY102_CAUSAL_V4_S34_MODEL } from "../config/disdexQuality102CausalV4Model";
import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import type { AsterUserTradeRow } from "./aster-v3-client";

export const ASTER_OFFICIAL_HISTORY_SOURCE = "aster-official-userTrades" as const;

export interface AsterTradeHistoryReadOnlyClient {
  getUserTrades(symbol: string, input?: { limit?: number }): Promise<AsterUserTradeRow[]>;
}

export interface AsterTradeHistorySyncInput {
  client: AsterTradeHistoryReadOnlyClient;
  symbols: readonly string[];
  targetPath: string;
  statusPath: string;
  now?: () => number;
}

function normalizeSymbol(value: string): string {
  return String(value || "").trim().toUpperCase();
}

function usdtSymbol(value: string): string {
  const normalized = normalizeSymbol(value);
  return normalized.endsWith("USDT") ? normalized : `${normalized}USDT`;
}

export function managedAsterHistorySymbols(env: Partial<NodeJS.ProcessEnv> = process.env): string[] {
  const q102HighVol = String(env.QUALITY102_CAUSAL_V1_SYMBOLS || "")
    .split(",").map(normalizeSymbol).filter(Boolean);
  const symbols = [
    ...V12_X1_ALL.universe.map(usdtSymbol),
    PENGU_DUAL_LS_V2.symbol,
    ...QUALITY102_CAUSAL_V4_S34_MODEL.map((row) => row.symbol),
    ...q102HighVol,
    ...DISDEX_V50_CONFIG.universe.map(usdtSymbol),
  ];
  return [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].sort();
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTrade(row: AsterUserTradeRow) {
  const time = finiteNumber(row.time) ?? 0;
  return {
    id: row.id === undefined ? undefined : String(row.id),
    orderId: row.orderId === undefined ? undefined : String(row.orderId),
    symbol: normalizeSymbol(row.symbol),
    side: row.side,
    positionSide: row.positionSide,
    price: finiteNumber(row.price),
    quantity: finiteNumber(row.qty),
    quoteQuantity: finiteNumber(row.quoteQty),
    realizedPnl: finiteNumber(row.realizedPnl),
    commission: finiteNumber(row.commission),
    commissionAsset: row.commissionAsset,
    time,
    executedAt: time > 0 ? new Date(time).toISOString() : undefined,
    buyer: row.buyer,
    maker: row.maker,
  };
}

function statusBase(checkedAt: string) {
  return {
    checkedAt,
    source: ASTER_OFFICIAL_HISTORY_SOURCE,
    readOnly: true as const,
    tradingMutation: 0 as const,
  };
}
export async function writeAsterTradeHistoryPreservedStatus(
  statusPath: string,
  error: unknown,
  now: () => number = Date.now,
): Promise<void> {
  const checkedAt = new Date(now()).toISOString();
  await atomicJson(statusPath, {
    status: "preserved",
    ...statusBase(checkedAt),
    error: error instanceof Error ? error.message : String(error),
  });
}

export async function syncAsterTradeHistorySnapshot(input: AsterTradeHistorySyncInput) {
  const now = input.now || Date.now;
  const checkedAt = new Date(now()).toISOString();
  const symbols = [...new Set(input.symbols.map(normalizeSymbol).filter(Boolean))].sort();
  if (!symbols.length) throw new Error("ASTER_HISTORY_SYMBOLS_REQUIRED");

  const rows: ReturnType<typeof normalizeTrade>[] = [];
  try {
    for (const symbol of symbols) {
      const trades = await input.client.getUserTrades(symbol, { limit: 1000 });
      if (!Array.isArray(trades)) throw new Error(`ASTER_HISTORY_INVALID_RESPONSE:${symbol}`);
      rows.push(...trades.map(normalizeTrade));
    }
  } catch (error) {
    await writeAsterTradeHistoryPreservedStatus(input.statusPath, error, now);
    throw error;
  }

  rows.sort((left, right) => right.time - left.time
    || left.symbol.localeCompare(right.symbol)
    || String(left.id || "").localeCompare(String(right.id || "")));
  const snapshot = {
    schemaVersion: 2,
    generatedAt: checkedAt,
    source: ASTER_OFFICIAL_HISTORY_SOURCE,
    venue: "AsterDEX",
    readOnly: true as const,
    tradingMutation: 0 as const,
    symbols,
    maximumPerSymbol: 1000,
    entries: rows,
  };
  await atomicJson(input.targetPath, snapshot);
  await atomicJson(input.statusPath, {
    status: "ok",
    ...statusBase(checkedAt),
    entryCount: rows.length,
    symbols,
  });
  return {
    status: "ASTER_GIT_HISTORY_SYNC_PASS" as const,
    entryCount: rows.length,
    symbols,
    ordersSent: 0 as const,
    cancelsSent: 0 as const,
    positionChangesSent: 0 as const,
    tradingMutation: 0 as const,
  };
}
