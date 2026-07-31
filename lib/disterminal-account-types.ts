export type DisterminalPosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
};

export type DisterminalAccountSnapshot =
  | {
      ok: true;
      source: "AsterDEX read-only account API";
      fetchedAt: string;
      accountAddress: string | null;
      walletBalanceUsd: number | null;
      equityUsd: number | null;
      availableBalanceUsd: number | null;
      marginBalanceUsd: number | null;
      unrealizedPnlUsd: number | null;
      openOrderCount: number | null;
      positions: DisterminalPosition[];
    }
  | {
      ok: false;
      source: "AsterDEX read-only account API";
      fetchedAt: string;
      errorCode: "UNAUTHENTICATED" | "CONFIG_MISSING" | "UPSTREAM_ERROR";
      message: string;
    };

export type DisterminalClosedTrade = {
  id: string;
  strategy: "V96" | "V52" | "UNKNOWN";
  symbol: string;
  side: "LONG" | "SHORT";
  entryAt: string;
  exitAt: string;
  holdingMinutes: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  commission: number;
  funding: number;
  netPnl: number;
  exitReason: string;
  source: "AsterDEX userTrades";
};

export type DisterminalTradesSnapshot =
  | {
      ok: true;
      source: "AsterDEX userTrades";
      fetchedAt: string;
      fills: number;
      closedTrades: DisterminalClosedTrade[];
      unavailableSymbols: string[];
    }
  | {
      ok: false;
      source: "AsterDEX userTrades";
      fetchedAt: string;
      errorCode: "UNAUTHENTICATED" | "CONFIG_MISSING" | "UPSTREAM_ERROR";
      message: string;
    };

export type DisterminalLiveStatus =
  | {
      ok: true;
      state: "ACTIVE" | "INACTIVE" | "UNKNOWN";
      source: "read-only status file" | "unavailable";
      checkedAt: string;
      lastRuntimeAt: string | null;
      reason: string;
    }
  | {
      ok: false;
      state: "UNKNOWN";
      source: "unavailable";
      checkedAt: string;
      lastRuntimeAt: null;
      reason: string;
    };
