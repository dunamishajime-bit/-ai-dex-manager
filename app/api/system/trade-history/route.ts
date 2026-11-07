import { NextRequest, NextResponse } from "next/server";

import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";
import { loadTradeHistoryEntries } from "@/lib/server/trade-history-db";
import { selectTradeHistorySource } from "@/lib/server/trade-history-source";
import { requestHasSignedOwnerSession } from "@/lib/server/session-auth";

export const dynamic = "force-dynamic";

/**
 * This is an OWNER-only, read-only history view. The local trade ledger alone
 * cannot show all Aster fills (e.g. a newly filled XRP order). Never label
 * bundled/legacy ledger records as official exchange confirmations.
 */
export async function GET(req: NextRequest) {
  if (!requestHasSignedOwnerSession(req)) {
    return NextResponse.json({ ok: false, error: "ログインが必要です。" }, { status: 401 });
  }
  try {
    const [official, local] = await Promise.all([
      loadAsterTradeHistory(),
      loadTradeHistoryEntries(),
    ]);
    const selected = selectTradeHistorySource(official.entries, local);
    const notice = official.error
      ? `Aster約定照合に制限があります: ${official.error}。未取得の銘柄・期間が残る場合があります。`
      : selected.source === "aster"
        ? "Aster取引所の約定履歴を取得しました。各行は1約定です。同じ注文IDの複数行は分割約定であり、注文合計とは異なります。"
        : "Asterの約定履歴は取得できていません。ローカル台帳の履歴であり、現在の全約定・保有を保証しません。";

    return NextResponse.json({
      ok: true,
      entries: selected.entries,
      source: selected.source,
      officialTradeCount: official.entries.length,
      localTradeCount: local.length,
      refreshedAt: official.refreshedAt,
      historyNotice: notice,
      sourceIncomplete: !!official.error || official.source !== "aster",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "取引履歴の照合に失敗しました。",
      detail: error instanceof Error ? error.message : "Unknown history error",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
