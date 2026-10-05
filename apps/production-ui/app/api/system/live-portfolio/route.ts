import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { NextResponse } from "next/server";
import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";
import { deriveAsterAccountMetrics } from "@/lib/server/aster-account-metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AccountSnapshot = {
  totalMarginBalance?: string | number;
  totalWalletBalance?: string | number;
  availableBalance?: string | number;
  totalUnrealizedProfit?: string | number;
  assets?: unknown[];
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

async function readV12Usage() {
  const statePath = String(process.env.V12_X1_ALL_STATE_PATH || "").trim();
  if (!statePath || !isAbsolute(statePath)) return null;
  try {
    const raw = JSON.parse(await readFile(statePath, "utf8")) as { activePositions?: Array<{ symbol?: string; gross?: number }> };
    const positions = Array.isArray(raw.activePositions) ? raw.activePositions : [];
    return {
      positionCount: positions.length,
      gross: positions.reduce((sum, position) => sum + finite(position.gross), 0),
      symbols: positions.map((position) => String(position.symbol || "").toUpperCase()).filter(Boolean),
    };
  } catch {
    return null;
  }
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
    const [account, positionRisk, openOrders, v12Usage] = await Promise.all([
      client.getAccount() as Promise<AccountSnapshot>,
      client.getPositionRisk() as Promise<PositionRisk[]>,
      client.getOpenOrders() as Promise<OpenOrder[]>,
      readV12Usage(),
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

    const accountMetrics = deriveAsterAccountMetrics(account);

    const orders = (Array.isArray(openOrders) ? openOrders : []).map((order) => {
      const reduceOnly = bool(order.reduceOnly);
      const closePosition = bool(order.closePosition);
      const type = String(order.type || "");
      return {
        symbol: String(order.symbol || "").toUpperCase(),
        side: String(order.side || "").toUpperCase(),
        type,
        status: String(order.status || ""),
        quantity: finite(order.origQty),
        reduceOnly,
        closePosition,
        protection: reduceOnly || closePosition || /STOP|TAKE_PROFIT/i.test(type),
      };
    });

    return NextResponse.json({
      ok: true,
      capturedAt: new Date().toISOString(),
      account: {
        balanceUsd: accountMetrics.balanceUsd,
        availableUsd: accountMetrics.availableUsd,
        unrealizedPnlUsd: accountMetrics.unrealizedPnlUsd,
      },
      positions,
      strategyUsage: {
        v12: v12Usage,
      },
      orders: {
        count: orders.length,
        protectionCount: orders.filter((order) => order.protection).length,
        entryOrderCount: orders.filter((order) => !order.protection).length,
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
