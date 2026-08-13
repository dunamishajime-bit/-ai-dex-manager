Exit code: 0
Wall time: 1 seconds
Output:
import { AsterV3Client, type AsterUserTrade } from "@/lib/aster-v3-client";
import type { TradeHistoryEntry } from "@/lib/server/trade-history-db";

const HISTORY_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT",
  "AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT",
] as const;
const CACHE_TTL_MS = 60_000;

type HistoryResult = {
  entries: TradeHistoryEntry[];
  source: "asterdex" | "unavailable";
  accountAddress?: string;
  refreshedAt: string;
  error?: string;
};

let cache: { expiresAt: number; result: HistoryResult } | null = null;

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalFinite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function strategyForSymbol(symbol: string) {
  return /^(AMZN|META|MSFT|NVDA|TSLA)/.test(symbol) ? "V52" : "V96";
}

async function fetchSymbolTrades(client: AsterV3Client, symbol: string) {
  const rows: AsterUserTrade[] = [];
  const seen = new Set<string>();
  let fromId = 0;

  for (let page = 0; page < 100; page += 1) {
    const pageRows = await client.getUserTrades(symbol, { limit: 1000, fromId });
    if (!Array.isArray(pageRows) || pageRows.length === 0) break;
    let newRows = 0;
    for (const row of pageRows) {
      const key = String(row.id ?? `${row.orderId ?? "unknown"}:${row.time ?? "unknown"}:${row.qty ?? "unknown"}`);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
        newRows += 1;
      }
    }
    if (pageRows.length < 1000 || newRows === 0) break;
    const ids = pageRows.map((row) => Number(row.id)).filter(Number.isFinite);
    const lastId = ids.length ? Math.max(...ids) : undefined;
    if (lastId === undefined || lastId < fromId) break;
    fromId = lastId + 1;
  }

  return rows.sort((left, right) => finite(left.time) - finite(right.time));
}

function toOfficialFill(row: AsterUserTrade, symbol: string, accountAddress: string): TradeHistoryEntry | null {
  const action = row.side === "BUY" || row.side === "SELL" ? row.side : null;
  const quantity = finite(row.qty);
  const price = finite(row.price);
  const executedAtMs = finite(row.time);
  if (!action || quantity <= 0 || price <= 0 || executedAtMs <= 0) return null;

  const quoteQuantity = finite(row.quoteQty) || quantity * price;
  const realizedPnlUsd = optionalFinite(row.realizedPnl ?? row.realizedProfit);
  const tradeId = String(row.id ?? `${row.orderId ?? "unknown"}-${executedAtMs}-${quantity}`);
  const orderId = row.orderId === undefined ? undefined : String(row.orderId);
  const baseSymbol = symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
  const strategy = strategyForSymbol(symbol);

  return {
    id: `aster:${symbol}:${tradeId}`,
    executedAt: new Date(executedAtMs).toISOString(),
    walletId: `asterdex:${accountAddress.toLowerCase()}`,
    walletAddress: accountAddress,
    chainId: 1666,
    txHash: orderId ? `aster-order:${orderId}` : `aster-trade:${tradeId}`,
    provider: "AsterDEX",
    action,
    sourceSymbol: action === "BUY" ? "USDT" : baseSymbol,
    destSymbol: action === "BUY" ? baseSymbol : "USDT",
    sourceAmount: action === "BUY" ? quoteQuantity : quantity,
    destAmount: action === "BUY" ? quantity : quoteQuantity,
    sourceUsdValue: quoteQuantity,
    destUsdValue: quoteQuantity,
    fillPriceUsd: price,
    realizedPnlUsd,
    reason: `AsterDEX公式約定 / ${strategy} / ${row.positionSide || "BOTH"}`,
    closedAt: realizedPnlUsd === undefined ? undefined : new Date(executedAtMs).toISOString(),
    tradeId,
    orderId,
    positionSide: row.positionSide,
    commission: optionalFinite(row.commission),
    commissionAsset: row.commissionAsset,
    maker: row.maker,
  };
}

export async function loadAsterTradeHistory(): Promise<HistoryResult> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.result;

  const accountAddress = process.env.ASTER_USER_ADDRESS?.trim();
  const privateKey = process.env.ASTER_API_PRIVATE_KEY?.trim();
  if (!accountAddress || !privateKey) {
    const result: HistoryResult = {
      entries: [],
      source: "unavailable",
      refreshedAt: new Date(now).toISOString(),
      error: "AsterDEX公式の履歴認証が設定されていません。",
    };
    cache = { expiresAt: now + CACHE_TTL_MS, result };
    return result;
  }

  try {
    const client = new AsterV3Client({
      baseUrl: process.env.ASTER_FUTURES_BASE_URL,
      userAddress: accountAddress,
      privateKey: privateKey as `0x${string}`,
      requestTimeoutMs: 10_000,
      recvWindowMs: 5_000,
      userAgent: "DisDex-DISTerminal-ReadOnly/1.0",
    });
    const entries: TradeHistoryEntry[] = [];
    for (const symbol of HISTORY_SYMBOLS) {
      const rows = await fetchSymbolTrades(client, symbol);
      for (const row of rows) {
        const entry = toOfficialFill(row, symbol, accountAddress);
        if (entry) entries.push(entry);
      }
    }
    entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));
    const result: HistoryResult = {
      entries,
      source: "asterdex",
      accountAddress,
      refreshedAt: new Date(now).toISOString(),
    };
    cache = { expiresAt: now + CACHE_TTL_MS, result };
    return result;
  } catch (error) {
    console.warn("Aster official trade history refresh failed:", error instanceof Error ? error.name : "unknown");
    const result: HistoryResult = {
      entries: [],
      source: "unavailable",
      accountAddress,
      refreshedAt: new Date(now).toISOString(),
      error: "AsterDEX公式の取引履歴を取得できません。ローカル台帳へ置き換えていません。",
    };
    cache = { expiresAt: now + CACHE_TTL_MS, result };
    return result;
  }
}

