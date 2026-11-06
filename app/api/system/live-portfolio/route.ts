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
  positions?: PositionRisk[];
};

type PositionRisk = {
  symbol?: string;
  positionAmt?: string | number;
  entryPrice?: string | number;
  markPrice?: string | number;
  unRealizedProfit?: string | number;
  unrealizedProfit?: string | number;
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

type NormalizedPosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  positionSide: string;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  markVerified: boolean;
  pnlVerified: boolean;
};

function normalizePositions(input: unknown): NormalizedPosition[] | null {
  if (!Array.isArray(input)) return null;
  const normalized: NormalizedPosition[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("ASTER_POSITION_ROW_INVALID");
    const row = item as PositionRisk;
    const amount = Number(row.positionAmt);
    if (!Number.isFinite(amount)) throw new Error("ASTER_POSITION_AMOUNT_INVALID");
    if (amount === 0) continue;
    const symbol = String(row.symbol || "").trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,40}$/.test(symbol)) throw new Error("ASTER_POSITION_SYMBOL_INVALID");
    const quantity = Math.abs(amount);
    const venuePositionSide = String(row.positionSide || "BOTH").trim().toUpperCase();
    const side: "LONG" | "SHORT" = venuePositionSide === "SHORT" ? "SHORT"
      : venuePositionSide === "LONG" ? "LONG"
      : amount < 0 ? "SHORT" : "LONG";
    const entryPrice = finite(row.entryPrice);
    const markPrice = finite(row.markPrice);
    const rawPnl = row.unRealizedProfit ?? row.unrealizedProfit;
    const pnlVerified = rawPnl !== undefined && rawPnl !== null && Number.isFinite(Number(rawPnl));
    normalized.push({
      symbol,
      side,
      positionSide: venuePositionSide,
      quantity,
      entryPrice,
      markPrice,
      notionalUsd: markPrice > 0 ? quantity * markPrice : 0,
      unrealizedPnlUsd: pnlVerified ? finite(rawPnl) : 0,
      markVerified: markPrice > 0,
      pnlVerified,
    });
  }
  return normalized.sort((left, right) => right.notionalUsd - left.notionalUsd);
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
  const responseHeaders = { "Cache-Control": "private, no-store, max-age=0" };
  let config: ReturnType<typeof loadAsterDexClientConfig>;
  try {
    config = loadAsterDexClientConfig();
  } catch {
    return NextResponse.json({ ok: false, error: "Aster read-only configuration invalid." },
      { status: 503, headers: responseHeaders });
  }
  if (!config) {
    return NextResponse.json({ ok: false, error: "Aster read-only configuration is unavailable." },
      { status: 503, headers: responseHeaders });
  }

  try {
    const client = new AsterDexClient(config);
    // Each signed, read-only source is independent: an order API failure
    // must not erase a successfully verified position or balance snapshot.
    const [accountResult, positionResult, ordersResult, v12Result] = await Promise.allSettled([
      client.getAccount() as Promise<AccountSnapshot>,
      client.getPositionRisk() as Promise<PositionRisk[]>,
      client.getOpenOrders() as Promise<OpenOrder[]>,
      readV12Usage(),
    ]);

    const account = accountResult.status === "fulfilled"
      && accountResult.value && typeof accountResult.value === "object"
      ? accountResult.value : null;
    const metrics = account ? deriveAsterAccountMetrics(account) : null;
    const accountAvailable = metrics?.connected === true;

    let riskPositions: NormalizedPosition[] | null = null;
    if (positionResult.status === "fulfilled") {
      try { riskPositions = normalizePositions(positionResult.value); } catch { /* invalid position evidence */ }
    }
    let accountPositions: NormalizedPosition[] | null = null;
    if (Array.isArray(account?.positions)) {
      try { accountPositions = normalizePositions(account.positions); } catch { /* invalid position evidence */ }
    }
    // Only use the independent signed account snapshot as a clearly labeled fallback.
    // Do not claim the account is flat if positionRisk and account disagree.
    const disagreesOnFlat = riskPositions !== null && riskPositions.length === 0
      && accountPositions !== null && accountPositions.length > 0;
    const positions = disagreesOnFlat ? accountPositions!
      : riskPositions ?? accountPositions ?? [];
    const positionSource = disagreesOnFlat ? "ACCOUNT_DISCREPANCY"
      : riskPositions !== null ? "POSITION_RISK"
      : accountPositions !== null ? "ACCOUNT_SNAPSHOT"
      : "UNAVAILABLE";
    const positionsAvailable = positionSource !== "UNAVAILABLE";

    const signedOrders = ordersResult.status === "fulfilled"
      && Array.isArray(ordersResult.value) ? ordersResult.value : null;
    const ordersAvailable = signedOrders !== null;
    const orders = (signedOrders ?? []).map((order) => {
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

    if (!accountAvailable && !positionsAvailable && !ordersAvailable) {
      return NextResponse.json({ ok: false, error: "Signed Aster account, positions and orders are unavailable." },
        { status: 502, headers: responseHeaders });
    }

    return NextResponse.json({
      ok: true,
      readOnly: true,
      capturedAt: new Date().toISOString(),
      availability: {
        account: accountAvailable,
        positions: positionsAvailable,
        orders: ordersAvailable,
      },
      positionSource,
      partial: !accountAvailable || !positionsAvailable || !ordersAvailable
        || positionSource === "ACCOUNT_DISCREPANCY",
      account: {
        balanceUsd: accountAvailable ? metrics!.balanceUsd : 0,
        availableUsd: accountAvailable ? metrics!.availableUsd : 0,
        unrealizedPnlUsd: accountAvailable ? metrics!.unrealizedPnlUsd : 0,
      },
      positions,
      strategyUsage: {
        v12: v12Result.status === "fulfilled" ? v12Result.value : null,
      },
      orders: {
        count: orders.length,
        protectionCount: orders.filter((order) => order.protection).length,
        entryOrderCount: orders.filter((order) => !order.protection).length,
        items: orders,
      },
    }, { headers: responseHeaders });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Aster live portfolio read-only request failed." },
      { status: 502, headers: responseHeaders },
    );
  }
}
