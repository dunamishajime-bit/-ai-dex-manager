import { NextResponse } from "next/server";

import {
  fetchRealtimeMarketSnapshot,
  normalizeRealtimeSymbols,
  realtimeSnapshotLabel,
  scoreRealtimeSnapshot,
} from "@/lib/server/realtime-market";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = normalizeRealtimeSymbols(searchParams.get("symbols"));

  const results = await Promise.allSettled(symbols.map((symbol) => fetchRealtimeMarketSnapshot(symbol)));
  const snapshots = results.map((result, index) => {
    const symbol = symbols[index];
    if (result.status === "fulfilled") {
      const snapshot = result.value;
      return {
        ...snapshot,
        realtimeScore: scoreRealtimeSnapshot(snapshot),
        realtimeLabel: realtimeSnapshotLabel(snapshot),
      };
    }
    return {
      symbol,
      pair: `${symbol}USDT`,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    source: "binance",
    usage: "reference_only",
    note: "リアルタイム相場の参考データです。現時点ではこのAPI単体で発注は行いません。",
    snapshots,
  });
}
