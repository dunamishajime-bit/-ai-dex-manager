Exit code: 0
Wall time: 1 seconds
Output:
import { AsterV3Client, AsterApiError, type AsterPositionRiskRow } from "@/lib/aster-v3-client";

const STABLE_ASSETS = new Set(["USDT", "USDF", "USDC", "USDE", "FDUSD", "BUSD"]);

export type AsterReadonlyPosition = {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  positionSide?: string;
};

export type AsterReadonlySnapshot = {
  status: "available" | "unavailable" | "not_configured";
  source: "asterdex";
  accountAddress?: string;
  walletBalanceUsd?: number;
  availableBalanceUsd?: number;
  portfolioUsd?: number;
  unrealizedPnlUsd?: number;
  positions: AsterReadonlyPosition[];
  openOrdersCount?: number;
  refreshedAt: string;
  error?: string;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unavailable(status: AsterReadonlySnapshot["status"], error: string): AsterReadonlySnapshot {
  return {
    status,
    source: "asterdex",
    positions: [],
    refreshedAt: new Date().toISOString(),
    error,
  };
}

function safeAsterError(error: unknown) {
  if (error instanceof AsterApiError && error.status > 0) {
    return `Aster read-only API error (${error.status}).`;
  }
  return "Aster read-only account data could not be retrieved.";
}

export async function loadAsterReadonlySnapshot(): Promise<AsterReadonlySnapshot> {
  const userAddress = process.env.ASTER_USER_ADDRESS?.trim();
  const privateKey = process.env.ASTER_API_PRIVATE_KEY?.trim();
  if (!userAddress || !privateKey) {
    return unavailable("not_configured", "Aster read-only credentials are not configured.");
  }

  try {
    const client = new AsterV3Client({
      baseUrl: process.env.ASTER_FUTURES_BASE_URL,
      userAddress,
      privateKey: privateKey as `0x${string}`,
      requestTimeoutMs: 10_000,
      recvWindowMs: 5_000,
      userAgent: "DisDex-DISTerminal-ReadOnly/1.0",
    });
    const [balances, positions, openOrders] = await Promise.all([
      client.getBalances(),
      client.getPositions(),
      client.getOpenOrders(),
    ]);

    const stableRows = balances.filter((row) => STABLE_ASSETS.has(String(row.asset || "").toUpperCase()));
    const walletBalanceUsd = Number(stableRows.reduce((sum, row) => {
      return sum + finite(row.crossWalletBalance ?? row.balance);
    }, 0).toFixed(8));
    const availableBalanceUsd = Number(stableRows.reduce((sum, row) => {
      return sum + finite(row.availableBalance);
    }, 0).toFixed(8));
    const mappedPositions = (Array.isArray(positions) ? positions : [])
      .map((row: AsterPositionRiskRow) => ({
        symbol: String(row.symbol || ""),
        positionAmt: finite(row.positionAmt),
        entryPrice: finite(row.entryPrice),
        markPrice: finite(row.markPrice),
        unrealizedProfit: finite(row.unRealizedProfit ?? row.unrealizedProfit),
        positionSide: row.positionSide,
      }))
      .filter((row) => row.symbol && Math.abs(row.positionAmt) > 1e-12);
    const unrealizedPnlUsd = Number(mappedPositions.reduce((sum, row) => sum + row.unrealizedProfit, 0).toFixed(8));

    return {
      status: "available",
      source: "asterdex",
      accountAddress: userAddress,
      walletBalanceUsd,
      availableBalanceUsd,
      portfolioUsd: Number((walletBalanceUsd + unrealizedPnlUsd).toFixed(8)),
      unrealizedPnlUsd,
      positions: mappedPositions,
      openOrdersCount: Array.isArray(openOrders) ? openOrders.length : 0,
      refreshedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn("Aster read-only account refresh failed:", safeAsterError(error));
    return unavailable("unavailable", safeAsterError(error));
  }
}

