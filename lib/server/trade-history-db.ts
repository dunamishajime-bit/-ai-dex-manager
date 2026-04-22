import fs from "fs";
import path from "path";

import type { OperationalWalletHolding } from "@/lib/operational-wallet-types";
import type { DirectWalletTradeInput, DirectWalletTradeResult } from "@/lib/server/direct-trade-executor";

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(KV_URL && KV_TOKEN);
const REDIS_KEY = "disdex:trade-ledger";
const DB_PATH = path.join(process.cwd(), "data", "trade-ledger.json");

export interface TradeHistoryEntry {
  id: string;
  executedAt: string;
  walletId: string;
  walletAddress: string;
  chainId: number;
  txHash: string;
  provider?: string;
  action: "BUY" | "SELL";
  sourceSymbol: string;
  destSymbol: string;
  sourceAmount: number;
  destAmount: number;
  sourceUsdValue: number;
  destUsdValue: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  reason: string;
  openedAt?: string;
  closedAt?: string;
}

interface OpenPositionRecord {
  walletId: string;
  symbol: string;
  quantity: number;
  costBasisUsd: number;
  openedAt: string;
  lastUpdatedAt: string;
}

interface TradeLedgerDb {
  entries: TradeHistoryEntry[];
  openPositions: Record<string, OpenPositionRecord>;
}

export interface TradeLedgerOpenPosition {
  walletId: string;
  symbol: string;
  quantity: number;
  costBasisUsd: number;
  openedAt: string;
  lastUpdatedAt: string;
}

interface AppendTradeHistoryInput {
  walletId: string;
  walletAddress: string;
  chainId: number;
  reason: string;
  action: DirectWalletTradeInput["action"];
  sourceSymbol: string;
  destSymbol: string;
  beforeHoldings: OperationalWalletHolding[];
  afterHoldings: OperationalWalletHolding[];
  trade: DirectWalletTradeResult;
  executedAt?: string;
}

let memoryLedger: TradeLedgerDb | null = null;

const STABLE_SYMBOLS = new Set(["USDT", "USDC", "BUSD", "USD1", "FDUSD", "USDE"]);

function emptyLedger(): TradeLedgerDb {
  return { entries: [], openPositions: {} };
}

function getHoldingAmount(holdings: OperationalWalletHolding[], symbol: string) {
  return Number(holdings.find((holding) => holding.symbol === symbol)?.amount || 0);
}

function getHoldingUsdPrice(holdings: OperationalWalletHolding[], symbol: string) {
  if (symbol === "USDT") return 1;
  return Number(holdings.find((holding) => holding.symbol === symbol)?.usdPrice || 0);
}

function round6(value: number) {
  return Number(value.toFixed(6));
}

function hasMeaningfulTradeAmounts(entry: Pick<TradeHistoryEntry, "sourceAmount" | "destAmount">) {
  return Number(entry.sourceAmount || 0) > 0.0000001 || Number(entry.destAmount || 0) > 0.0000001;
}

function normalizeTradeHistoryEntries(entries: TradeHistoryEntry[]) {
  const sorted = [...entries]
    .filter((entry) => entry && entry.walletId && entry.executedAt && entry.sourceSymbol && entry.destSymbol)
    .filter((entry) => hasMeaningfulTradeAmounts(entry))
    .sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());

  const openPositions = new Map<string, OpenPositionRecord>();
  const normalized = sorted.map((entry) => {
    const sourceAmount = Number(entry.sourceAmount || 0);
    const destAmount = Number(entry.destAmount || 0);
    const sourceUsdValue = Number(entry.sourceUsdValue || 0);
    const destUsdValue = Number(entry.destUsdValue || 0);

    const next: TradeHistoryEntry = {
      ...entry,
      sourceAmount: round6(sourceAmount),
      destAmount: round6(destAmount),
      sourceUsdValue: round6(sourceUsdValue),
      destUsdValue: round6(destUsdValue),
      entryPriceUsd: entry.entryPriceUsd,
      exitPriceUsd: entry.exitPriceUsd,
      realizedPnlUsd: entry.realizedPnlUsd,
      realizedPnlPct: entry.realizedPnlPct,
      openedAt: entry.openedAt,
      closedAt: entry.closedAt,
    };

    if (!next.entryPriceUsd && next.action === "BUY" && destAmount > 0) {
      const inferredEntryUsd = sourceUsdValue > 0
        ? sourceUsdValue
        : (STABLE_SYMBOLS.has(next.sourceSymbol) ? sourceAmount : 0);
      if (inferredEntryUsd > 0) {
        next.entryPriceUsd = round6(inferredEntryUsd / destAmount);
        if (!next.sourceUsdValue) next.sourceUsdValue = round6(inferredEntryUsd);
        if (!next.destUsdValue) next.destUsdValue = round6(inferredEntryUsd);
      }
    }

    if (!next.exitPriceUsd && next.action === "SELL" && sourceAmount > 0) {
      const inferredExitUsd = destUsdValue > 0
        ? destUsdValue
        : (STABLE_SYMBOLS.has(next.destSymbol) ? destAmount : 0);
      if (inferredExitUsd > 0) {
        next.exitPriceUsd = round6(inferredExitUsd / sourceAmount);
        if (!next.destUsdValue) next.destUsdValue = round6(inferredExitUsd);
        if (!next.sourceUsdValue) next.sourceUsdValue = round6(inferredExitUsd);
      }
    }

    const buyKey = `${next.walletId}:${next.destSymbol}`;
    const sellKey = `${next.walletId}:${next.sourceSymbol}`;

    if (next.action === "BUY" && destAmount > 0) {
      const effectiveBuyUsd = next.sourceUsdValue > 0
        ? next.sourceUsdValue
        : (STABLE_SYMBOLS.has(next.sourceSymbol) ? sourceAmount : next.destUsdValue);
      if (effectiveBuyUsd > 0) {
        const existing = openPositions.get(buyKey);
        if (existing) {
          const totalQty = round6(existing.quantity + destAmount);
          const totalCost = round6(existing.costBasisUsd + effectiveBuyUsd);
          openPositions.set(buyKey, {
            ...existing,
            quantity: totalQty,
            costBasisUsd: totalCost,
            lastUpdatedAt: next.executedAt,
          });
          next.openedAt = existing.openedAt;
        } else {
          openPositions.set(buyKey, {
            walletId: next.walletId,
            symbol: next.destSymbol,
            quantity: round6(destAmount),
            costBasisUsd: round6(effectiveBuyUsd),
            openedAt: next.executedAt,
            lastUpdatedAt: next.executedAt,
          });
          next.openedAt = next.executedAt;
        }
      }
    }

    if (next.action === "SELL" && sourceAmount > 0) {
      const open = openPositions.get(sellKey);
      const effectiveSellUsd = next.destUsdValue > 0
        ? next.destUsdValue
        : (STABLE_SYMBOLS.has(next.destSymbol) ? destAmount : next.sourceUsdValue);

      if (open && open.quantity > 0 && open.costBasisUsd > 0) {
        const soldQty = Math.min(open.quantity, sourceAmount);
        const averageCost = open.costBasisUsd / open.quantity;
        const costForSold = round6(soldQty * averageCost);
        if (effectiveSellUsd > 0) {
          next.realizedPnlUsd = round6(effectiveSellUsd - costForSold);
          next.realizedPnlPct = costForSold > 0 ? round6((next.realizedPnlUsd / costForSold) * 100) : undefined;
          if (!next.sourceUsdValue) next.sourceUsdValue = costForSold;
          if (!next.destUsdValue) next.destUsdValue = round6(effectiveSellUsd);
        }
        next.openedAt = open.openedAt;
        next.closedAt = next.executedAt;

        const remainingQty = round6(Math.max(0, open.quantity - soldQty));
        const remainingCost = round6(Math.max(0, open.costBasisUsd - costForSold));
        if (remainingQty <= 0.0000001 || remainingCost <= 0.0000001) {
          openPositions.delete(sellKey);
        } else {
          openPositions.set(sellKey, {
            ...open,
            quantity: remainingQty,
            costBasisUsd: remainingCost,
            lastUpdatedAt: next.executedAt,
          });
        }
      }
    }

    return next;
  });

  return normalized.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());
}

async function loadFromRedis(): Promise<TradeLedgerDb> {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({ url: KV_URL!, token: KV_TOKEN! });
  const data = await redis.get<TradeLedgerDb>(REDIS_KEY);
  if (!data || typeof data !== "object") return emptyLedger();
  return {
    entries: Array.isArray(data.entries) ? data.entries : [],
    openPositions: data.openPositions && typeof data.openPositions === "object" ? data.openPositions : {},
  };
}

async function saveToRedis(db: TradeLedgerDb): Promise<void> {
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis({ url: KV_URL!, token: KV_TOKEN! });
  await redis.set(REDIS_KEY, db);
}

function loadFromFs(): TradeLedgerDb {
  try {
    if (memoryLedger) return memoryLedger;
    if (!fs.existsSync(DB_PATH)) return emptyLedger();
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    memoryLedger = {
      entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
      openPositions: parsed?.openPositions && typeof parsed.openPositions === "object" ? parsed.openPositions : {},
    };
    return memoryLedger;
  } catch (error) {
    console.warn("Failed to load trade ledger:", error);
    return memoryLedger || emptyLedger();
  }
}

function saveToFs(db: TradeLedgerDb) {
  memoryLedger = db;
  try {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (error) {
    console.warn("Failed to save trade ledger:", error);
  }
}

async function loadTradeLedger(): Promise<TradeLedgerDb> {
  if (USE_REDIS) return loadFromRedis();
  return loadFromFs();
}

export async function loadOpenPositionForWalletSymbol(
  walletId: string,
  symbol: string,
): Promise<TradeLedgerOpenPosition | null> {
  const db = await loadTradeLedger();
  const key = `${walletId}:${symbol}`;
  const open = db.openPositions[key];
  return open ? { ...open } : null;
}

async function saveTradeLedger(db: TradeLedgerDb) {
  if (USE_REDIS) return saveToRedis(db);
  saveToFs(db);
}

export async function loadTradeHistoryEntries(): Promise<TradeHistoryEntry[]> {
  const db = await loadTradeLedger();
  return normalizeTradeHistoryEntries(db.entries);
}

export async function appendTradeHistory(input: AppendTradeHistoryInput): Promise<TradeHistoryEntry | null> {
  if (!input.trade.ok || !input.trade.txHash || !input.action) return null;

  const db = await loadTradeLedger();
  const now = input.executedAt || new Date().toISOString();
  let sourceAmount = Math.max(
    0,
    getHoldingAmount(input.beforeHoldings, input.sourceSymbol) - getHoldingAmount(input.afterHoldings, input.sourceSymbol),
  );
  let destAmount = Math.max(
    0,
    getHoldingAmount(input.afterHoldings, input.destSymbol) - getHoldingAmount(input.beforeHoldings, input.destSymbol),
  );

  if (sourceAmount <= 0.0000001 && Number(input.trade.quotedSourceAmount || 0) > 0) {
    sourceAmount = Number(input.trade.quotedSourceAmount || 0);
  }

  if (destAmount <= 0.0000001 && Number(input.trade.quotedDestAmount || 0) > 0) {
    destAmount = Number(input.trade.quotedDestAmount || 0);
  }

  if (!hasMeaningfulTradeAmounts({ sourceAmount, destAmount })) {
    return null;
  }

  const sourceUsdPrice = getHoldingUsdPrice(input.beforeHoldings, input.sourceSymbol)
    || getHoldingUsdPrice(input.afterHoldings, input.sourceSymbol)
    || (input.sourceSymbol === "USDT" ? 1 : 0);
  const destUsdPrice = getHoldingUsdPrice(input.afterHoldings, input.destSymbol)
    || getHoldingUsdPrice(input.beforeHoldings, input.destSymbol)
    || (input.destSymbol === "USDT" ? 1 : 0);

  const sourceUsdValue = round6(
    Number(input.trade.quotedSourceUsdValue || 0) > 0
      ? Number(input.trade.quotedSourceUsdValue || 0)
      : sourceAmount * sourceUsdPrice,
  );
  const destUsdValue = round6(
    Number(input.trade.quotedDestUsdValue || 0) > 0
      ? Number(input.trade.quotedDestUsdValue || 0)
      : destAmount * destUsdPrice,
  );
  const entryPriceUsd = input.action === "BUY" && destAmount > 0 ? round6(sourceUsdValue / destAmount) : undefined;
  const exitPriceUsd = input.action === "SELL" && sourceAmount > 0 ? round6(destUsdValue / sourceAmount) : undefined;

  let realizedPnlUsd: number | undefined;
  let realizedPnlPct: number | undefined;
  let openedAt: string | undefined;
  let closedAt: string | undefined;

  const openKey = `${input.walletId}:${input.destSymbol}`;
  const sourceKey = `${input.walletId}:${input.sourceSymbol}`;

  if (input.action === "BUY" && destAmount > 0 && sourceUsdValue > 0) {
    db.openPositions[openKey] = {
      walletId: input.walletId,
      symbol: input.destSymbol,
      quantity: round6(destAmount),
      costBasisUsd: round6(sourceUsdValue),
      openedAt: now,
      lastUpdatedAt: now,
    };
    openedAt = now;
  }

  if (input.action === "SELL" && sourceAmount > 0) {
    const open = db.openPositions[sourceKey];
    if (open && open.quantity > 0 && open.costBasisUsd > 0) {
      const averageCost = open.costBasisUsd / open.quantity;
      const costForSold = round6(sourceAmount * averageCost);
      realizedPnlUsd = round6(destUsdValue - costForSold);
      realizedPnlPct = costForSold > 0 ? round6((realizedPnlUsd / costForSold) * 100) : undefined;
      openedAt = open.openedAt;
      closedAt = now;

      const remainingQty = round6(Math.max(0, open.quantity - sourceAmount));
      const remainingCost = round6(Math.max(0, open.costBasisUsd - costForSold));
      if (remainingQty <= 0.0000001 || remainingCost <= 0.0000001) {
        delete db.openPositions[sourceKey];
      } else {
        db.openPositions[sourceKey] = {
          ...open,
          quantity: remainingQty,
          costBasisUsd: remainingCost,
          lastUpdatedAt: now,
        };
      }
    }
  }

  const entry: TradeHistoryEntry = {
    id: `trd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    executedAt: now,
    walletId: input.walletId,
    walletAddress: input.walletAddress,
    chainId: input.chainId,
    txHash: input.trade.txHash,
    provider: input.trade.provider,
    action: input.action,
    sourceSymbol: input.sourceSymbol,
    destSymbol: input.destSymbol,
    sourceAmount: round6(sourceAmount),
    destAmount: round6(destAmount),
    sourceUsdValue,
    destUsdValue,
    entryPriceUsd,
    exitPriceUsd,
    realizedPnlUsd,
    realizedPnlPct,
    reason: input.reason,
    openedAt,
    closedAt,
  };

  db.entries.unshift(entry);
  await saveTradeLedger(db);
  return entry;
}
