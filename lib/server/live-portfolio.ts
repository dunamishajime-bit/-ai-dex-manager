import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";

export type LivePortfolioSnapshot = {
  ok: true;
  capturedAt: string;
  account: {
    balanceUsd: number;
    availableUsd: number;
    unrealizedPnlUsd: number;
  };
  positions: LivePosition[];
  orders: {
    count: number;
    protectionCount: number;
    items: LiveOrder[];
  };
};

export type LivePosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  positionSide: string;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
};

export type LiveOrder = {
  symbol: string;
  side: string;
  type: string;
  status: string;
  quantity: number;
  protection: boolean;
};

export type PublicPortfolioSummary = {
  status: "AVAILABLE" | "UNAVAILABLE" | "DATA ERROR";
  capturedAt?: string;
  positionCount: number | null;
  positions: Array<{ symbol: string; side: "LONG" | "SHORT"; protected: boolean }>;
  openOrderCount: number | null;
  protectedOrderCount: number | null;
};

type AccountSnapshot = {
  totalMarginBalance?: string | number;
  totalWalletBalance?: string | number;
  availableBalance?: string | number;
  totalUnrealizedProfit?: string | number;
};

type PositionRisk = {
  symbol?: string;
  positionAmt?: string | number;
  entryPrice?: string | number;
  markPrice?: string | number;
  unRealizedProfit?: string | number;
  positionSide?: string;
};

type OpenOrder = {
  symbol?: string;
  side?: string;
  type?: string;
  status?: string;
  reduceOnly?: boolean | string;
  closePosition?: boolean | string;
  origQty?: string | number;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown) {
  return value === true || value === "true";
}

export async function loadLivePortfolioSnapshot(): Promise<LivePortfolioSnapshot> {
  const config = loadAsterDexClientConfig();
  if (!config) throw new Error("Aster read-only configuration is unavailable.");

  const client = new AsterDexClient(config);
  const [account, positionRisk, openOrders] = await Promise.all([
    client.getAccount() as Promise<AccountSnapshot>,
    client.getPositionRisk() as Promise<PositionRisk[]>,
    client.getOpenOrders() as Promise<OpenOrder[]>,
  ]);

  const positions = (Array.isArray(positionRisk) ? positionRisk : [])
    .map((position): LivePosition | null => {
      const amount = finite(position.positionAmt);
      const quantity = Math.abs(amount);
      if (!position.symbol || quantity <= 0) return null;
      const entryPrice = finite(position.entryPrice);
      const markPrice = finite(position.markPrice);
      const unrealizedPnlUsd = finite(position.unRealizedProfit);
      return {
        symbol: position.symbol.toUpperCase(),
        side: amount >= 0 ? "LONG" : "SHORT",
        positionSide: position.positionSide || "BOTH",
        quantity,
        entryPrice,
        markPrice,
        notionalUsd: markPrice > 0 ? quantity * markPrice : 0,
        unrealizedPnlUsd,
      };
    })
    .filter((position): position is LivePosition => Boolean(position))
    .sort((left, right) => right.notionalUsd - left.notionalUsd);

  const orders = (Array.isArray(openOrders) ? openOrders : []).map((order): LiveOrder => ({
    symbol: String(order.symbol || "").toUpperCase(),
    side: String(order.side || "").toUpperCase(),
    type: String(order.type || ""),
    status: String(order.status || ""),
    quantity: finite(order.origQty),
    protection: bool(order.reduceOnly) || bool(order.closePosition) || /STOP|TAKE_PROFIT/i.test(String(order.type || "")),
  }));

  return {
    ok: true,
    capturedAt: new Date().toISOString(),
    account: {
      balanceUsd: finite(account?.totalMarginBalance || account?.totalWalletBalance),
      availableUsd: finite(account?.availableBalance),
      unrealizedPnlUsd: finite(account?.totalUnrealizedProfit),
    },
    positions,
    orders: {
      count: orders.length,
      protectionCount: orders.filter((order) => order.protection).length,
      items: orders,
    },
  };
}

export function toPublicPortfolioSummary(snapshot: LivePortfolioSnapshot): PublicPortfolioSummary {
  const protectedSymbols = new Set(snapshot.orders.items.filter((order) => order.protection).map((order) => order.symbol));
  return {
    status: "AVAILABLE",
    capturedAt: snapshot.capturedAt,
    positionCount: snapshot.positions.length,
    positions: snapshot.positions.map((position) => ({
      symbol: position.symbol,
      side: position.side,
      protected: protectedSymbols.has(position.symbol),
    })),
    openOrderCount: snapshot.orders.count,
    protectedOrderCount: snapshot.orders.protectionCount,
  };
}

export function unavailablePublicPortfolio(status: "UNAVAILABLE" | "DATA ERROR" = "UNAVAILABLE"): PublicPortfolioSummary {
  return {
    status,
    positionCount: null,
    positions: [],
    openOrderCount: null,
    protectedOrderCount: null,
  };
}
