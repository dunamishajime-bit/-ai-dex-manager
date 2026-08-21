import { NextResponse } from "next/server";
import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AccountSnapshot = {
  totalMarginBalance?: string | number;
  totalWalletBalance?: string | number;
  availableBalance?: string | number;
  totalMaintMargin?: string | number;
  totalInitialMargin?: string | number;
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

function maskAddress(value: string) {
  const address = value.trim();
  if (address.length <= 12) return `${address.slice(0, 4)}***${address.slice(-3)}`;
  return `${address.slice(0, 6)}***${address.slice(-4)}`;
}

export async function GET() {
  const config = loadAsterDexClientConfig();
  if (!config) {
    return NextResponse.json(
      { ok: false, error: "Aster read-only configuration is unavailable." },
      { status: 503 },
    );
  }

  try {
    const client = new AsterDexClient(config);
    const [account, positionRisk, openOrders] = await Promise.all([
      client.getAccount() as Promise<AccountSnapshot>,
      client.getPositionRisk() as Promise<PositionRisk[]>,
      client.getOpenOrders() as Promise<OpenOrder[]>,
    ]);

    const positions = (Array.isArray(positionRisk) ? positionRisk : [])
      .map((position) => {
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
      .filter((position): position is NonNullable<typeof position> => Boolean(position))
      .sort((left, right) => right.notionalUsd - left.notionalUsd);

    const orders = (Array.isArray(openOrders) ? openOrders : []).map((order) => ({
      symbol: String(order.symbol || "").toUpperCase(),
      side: String(order.side || "").toUpperCase(),
      type: String(order.type || ""),
      status: String(order.status || ""),
      quantity: finite(order.origQty),
      protection: bool(order.reduceOnly) || bool(order.closePosition) || /STOP|TAKE_PROFIT/i.test(String(order.type || "")),
    }));

    return NextResponse.json({
      ok: true,
      capturedAt: new Date().toISOString(),
      account: {
        balanceUsd: finite(account?.totalMarginBalance || account?.totalWalletBalance),
        availableUsd: finite(account?.availableBalance),
        maintenanceMarginUsd: finite(account?.totalMaintMargin),
        initialMarginUsd: finite(account?.totalInitialMargin),
        unrealizedPnlUsd: finite(account?.totalUnrealizedProfit),
      },
      wallet: {
        address: maskAddress(config.userAddress),
        venue: "AsterDEX",
        ownerConnected: Boolean(config.userAddress),
      },
      positions,
      orders: {
        count: orders.length,
        protectionCount: orders.filter((order) => order.protection).length,
        items: orders,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to read Aster live portfolio." },
      { status: 502 },
    );
  }
}
