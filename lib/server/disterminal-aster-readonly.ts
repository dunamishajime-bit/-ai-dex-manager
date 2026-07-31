import { cookies } from "next/headers";
import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import type {
  DisterminalAccountSnapshot,
  DisterminalClosedTrade,
  DisterminalPosition,
  DisterminalTradesSnapshot,
} from "@/lib/disterminal-account-types";

type CacheEntry<T> = { expiresAt: number; value: T };
type Fill = {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  realizedPnl: number;
  commission: number;
  time: number;
  id: string;
  orderId: string;
  reduceOnly: boolean;
};

const cache = globalThis as typeof globalThis & {
  __disterminalAccountCache?: CacheEntry<DisterminalAccountSnapshot>;
  __disterminalTradesCache?: CacheEntry<DisterminalTradesSnapshot>;
};

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function firstFinite(...values: unknown[]) {
  for (const value of values) {
    const parsed = finite(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function maskAddress(value: string) {
  return value.length > 12 ? value.slice(0, 6) + "…" + value.slice(-4) : null;
}

function strategyFor(symbol: string): "V96" | "V52" | "UNKNOWN" {
  if ((config.cryptoSymbols as readonly string[]).includes(symbol)) return "V96";
  if ((config.stockSymbols as readonly string[]).includes(symbol)) return "V52";
  return "UNKNOWN";
}

async function getClient() {
  const jar = await cookies();
  if (jar.get("disdex_auth")?.value !== "1") return { errorCode: "UNAUTHENTICATED" as const };
  const clientConfig = loadAsterDexClientConfig();
  if (!clientConfig) return { errorCode: "CONFIG_MISSING" as const };
  try {
    return { client: new AsterDexClient(clientConfig), clientConfig };
  } catch {
    return { errorCode: "CONFIG_MISSING" as const };
  }
}

function normalizePosition(row: Record<string, unknown>): DisterminalPosition | null {
  const quantity = finite(row.positionAmt);
  if (quantity === null || quantity === 0 || typeof row.symbol !== "string") return null;
  return {
    symbol: row.symbol,
    side: quantity < 0 ? "SHORT" : "LONG",
    quantity: Math.abs(quantity),
    entryPrice: finite(row.entryPrice),
    markPrice: finite(row.markPrice),
    unrealizedPnl: firstFinite(row.unRealizedProfit, row.unrealizedProfit),
  };
}

export async function readDisterminalAccount(force = false): Promise<DisterminalAccountSnapshot> {
  const now = Date.now();
  if (!force && cache.__disterminalAccountCache && cache.__disterminalAccountCache.expiresAt > now) {
    return cache.__disterminalAccountCache.value;
  }
  const fetchedAt = new Date(now).toISOString();
  const clientResult = await getClient();
  if (!("client" in clientResult) || !clientResult.client) {
    return {
      ok: false,
      source: "AsterDEX read-only account API",
      fetchedAt,
      errorCode: clientResult.errorCode,
      message: "Aster口座情報を取得できません。",
    };
  }
  const client = clientResult.client;
  const clientConfig = clientResult.clientConfig;
  try {
    const [account, balances, positions, openOrders] = await Promise.all([
      client.getAccount(),
      client.getBalance(),
      client.getPositionRisk(),
      client.getOpenOrders(),
    ]);
    const accountRow = account as Record<string, unknown>;
    const usdt = (balances as Array<Record<string, unknown>>).find((row) => row.asset === "USDT");
    const value: DisterminalAccountSnapshot = {
      ok: true,
      source: "AsterDEX read-only account API",
      fetchedAt,
      accountAddress: maskAddress(clientConfig.userAddress),
      walletBalanceUsd: firstFinite(accountRow.totalWalletBalance, usdt?.balance, usdt?.crossWalletBalance),
      equityUsd: firstFinite(accountRow.totalMarginBalance, accountRow.totalWalletBalance, usdt?.crossWalletBalance),
      availableBalanceUsd: firstFinite(accountRow.availableBalance, usdt?.availableBalance),
      marginBalanceUsd: firstFinite(accountRow.totalMarginBalance, usdt?.marginBalance),
      unrealizedPnlUsd: firstFinite(accountRow.totalUnrealizedProfit, usdt?.crossUnPnl, usdt?.unrealizedProfit),
      openOrderCount: Array.isArray(openOrders) ? openOrders.length : null,
      positions: Array.isArray(positions)
        ? positions
            .map((row) => normalizePosition(row as Record<string, unknown>))
            .filter((row): row is DisterminalPosition => row !== null)
        : [],
    };
    cache.__disterminalAccountCache = { expiresAt: now + 10_000, value };
    return value;
  } catch {
    return {
      ok: false,
      source: "AsterDEX read-only account API",
      fetchedAt,
      errorCode: "UPSTREAM_ERROR",
      message: "Aster口座APIから取得できません。",
    };
  }
}

function normalizeFill(row: Record<string, unknown>): Fill | null {
  const price = finite(row.price);
  const quantity = finite(row.qty ?? row.quantity);
  const time = finite(row.time ?? row.transactTime);
  if (
    typeof row.symbol !== "string" ||
    (row.side !== "BUY" && row.side !== "SELL") ||
    price === null ||
    quantity === null ||
    quantity <= 0 ||
    time === null
  ) {
    return null;
  }
  return {
    symbol: row.symbol,
    side: row.side,
    price,
    quantity,
    realizedPnl: finite(row.realizedPnl) ?? 0,
    commission: finite(row.commission) ?? 0,
    time,
    id: String(row.id ?? String(row.orderId ?? "order") + "-" + time + "-" + price),
    orderId: String(row.orderId ?? ""),
    reduceOnly: row.reduceOnly === true,
  };
}

function pairFills(fills: Fill[]): DisterminalClosedTrade[] {
  const open: Array<{ side: "LONG" | "SHORT"; quantity: number; price: number; time: number; fill: Fill }> = [];
  const closed: DisterminalClosedTrade[] = [];
  for (const fill of fills.sort((a, b) => a.time - b.time)) {
    const incoming: "LONG" | "SHORT" = fill.side === "BUY" ? "LONG" : "SHORT";
    const opposite: "LONG" | "SHORT" = incoming === "LONG" ? "SHORT" : "LONG";
    let remaining = fill.quantity;
    while (remaining > 0) {
      const index = open.findIndex((lot) => lot.side === opposite);
      if (index < 0) break;
      const lot = open[index];
      const matched = Math.min(remaining, lot.quantity);
      const grossPnl = lot.side === "LONG" ? (fill.price - lot.price) * matched : (lot.price - fill.price) * matched;
      const commission = lot.fill.commission * (matched / lot.quantity) + fill.commission * (matched / fill.quantity);
      closed.push({
        id: lot.fill.id + "-" + fill.id,
        strategy: strategyFor(fill.symbol),
        symbol: fill.symbol,
        side: lot.side,
        entryAt: new Date(lot.time).toISOString(),
        exitAt: new Date(fill.time).toISOString(),
        holdingMinutes: Math.max(0, Math.round((fill.time - lot.time) / 60_000)),
        entryPrice: lot.price,
        exitPrice: fill.price,
        quantity: matched,
        grossPnl,
        commission,
        funding: 0,
        netPnl: grossPnl - commission,
        exitReason: fill.reduceOnly ? "reduce-only" : "反対約定で決済",
        source: "AsterDEX userTrades",
      });
      remaining -= matched;
      lot.quantity -= matched;
      if (lot.quantity <= 1e-12) open.splice(index, 1);
    }
    if (remaining > 0) open.push({ side: incoming, quantity: remaining, price: fill.price, time: fill.time, fill });
  }
  return closed.sort((a, b) => b.exitAt.localeCompare(a.exitAt));
}

export async function readDisterminalTrades(force = false): Promise<DisterminalTradesSnapshot> {
  const now = Date.now();
  if (!force && cache.__disterminalTradesCache && cache.__disterminalTradesCache.expiresAt > now) {
    return cache.__disterminalTradesCache.value;
  }
  const fetchedAt = new Date(now).toISOString();
  const clientResult = await getClient();
  if (!("client" in clientResult) || !clientResult.client) {
    return {
      ok: false,
      source: "AsterDEX userTrades",
      fetchedAt,
      errorCode: clientResult.errorCode,
      message: "Aster取引履歴を取得できません。",
    };
  }
  const client = clientResult.client;
  try {
    const symbols = [...config.cryptoSymbols, ...config.stockSymbols];
    const rows: Fill[] = [];
    const unavailableSymbols: string[] = [];
    for (const symbol of symbols) {
      try {
        const response = await client.getUserTrades(symbol, 500);
        if (Array.isArray(response)) {
          for (const row of response) {
            const fill = normalizeFill(row as Record<string, unknown>);
            if (fill) rows.push(fill);
          }
        }
      } catch {
        unavailableSymbols.push(symbol);
      }
    }
    if (rows.length === 0 && unavailableSymbols.length === symbols.length) {
      return {
        ok: false,
        source: "AsterDEX userTrades",
        fetchedAt,
        errorCode: "UPSTREAM_ERROR",
        message: "Aster取引履歴APIから取得できません。",
      };
    }
    const value: DisterminalTradesSnapshot = {
      ok: true,
      source: "AsterDEX userTrades",
      fetchedAt,
      fills: rows.length,
      closedTrades: pairFills(rows),
      unavailableSymbols,
    };
    cache.__disterminalTradesCache = { expiresAt: now + 60_000, value };
    return value;
  } catch {
    return {
      ok: false,
      source: "AsterDEX userTrades",
      fetchedAt,
      errorCode: "UPSTREAM_ERROR",
      message: "Aster取引履歴APIから取得できません。",
    };
  }
}
