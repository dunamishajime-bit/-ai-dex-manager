import { NextResponse } from "next/server";
import { AsterV3Client } from "@/lib/aster-v3-client";

export const dynamic = "force-dynamic";

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET() {
  try {
    const address = process.env.ASTER_USER_ADDRESS || "";
    const client = new AsterV3Client({
      baseUrl: process.env.ASTER_FUTURES_BASE_URL,
      userAddress: address,
      privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
      userAgent: "DisDex-Aster-Account-Display/1.0",
    });
    if (!client.hasTradingCredentials()) {
      return NextResponse.json({ ok: false, error: "Aster account credentials are not configured." }, { status: 503 });
    }
    const [balances, positions] = await Promise.all([client.getBalances(), client.getPositions()]);
    const usdt = balances.find((row) => String(row.asset || "").toUpperCase() === "USDT");
    const activePositions = positions
      .map((row) => ({
        symbol: row.symbol,
        quantity: number(row.positionAmt),
        entryPrice: number(row.entryPrice),
        markPrice: number(row.markPrice),
        unrealizedPnl: number(row.unRealizedProfit ?? row.unrealizedProfit),
        leverage: number(row.leverage),
        positionSide: row.positionSide,
      }))
      .filter((row) => Math.abs(row.quantity) > 1e-12);
    return NextResponse.json({
      ok: true,
      source: "Aster authenticated futures account",
      address,
      usdtBalance: number(usdt?.balance),
      usdtAvailable: number(usdt?.availableBalance),
      usdtCrossWalletBalance: number(usdt?.crossWalletBalance),
      unrealizedPnl: activePositions.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      positions: activePositions,
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Aster account unavailable." }, { status: 502 });
  }
}
