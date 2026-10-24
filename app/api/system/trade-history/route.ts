import { NextRequest, NextResponse } from "next/server";

import { loadAsterTradeHistory } from "@/lib/server/aster-trade-history";
import { loadCurrentProductionRuntime } from "@/lib/server/current-production-runtime";
import { loadTradeHistoryEntries } from "@/lib/server/trade-history-db";
import { selectTradeHistorySource } from "@/lib/server/trade-history-source";
import { loadV12V4HpObservability } from "@/lib/server/v12-v4-hp-observability";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(req: NextRequest) {
  const authenticated = req.cookies.get("disdex_auth")?.value === "1";
  if (!authenticated) return NextResponse.json({ ok: false, readOnly: true, tradingMutation: 0, error: "Authentication required." }, { status: 401, headers });
  const localEntries = await loadTradeHistoryEntries();
  const [aster, runtime, v12V4] = await Promise.all([
    authenticated ? loadAsterTradeHistory() : Promise.resolve({ entries: [], source: "unavailable" as const, refreshedAt: new Date().toISOString(), error: "Authentication required for Aster account history." }),
    loadCurrentProductionRuntime().catch(() => null),
    loadV12V4HpObservability().catch(() => null),
  ]);
  // Official Aster fills are authoritative when present. If the account has no
  // official fills yet, expose the existing recovered ledger as an explicit,
  // read-only fallback so the calendar is not silently empty.
  const selected = selectTradeHistorySource(aster.source === "aster" ? aster.entries : [], localEntries);
  const entries = selected.entries;
  entries.sort((left, right) => Date.parse(right.executedAt) - Date.parse(left.executedAt));
  const officialEntries = aster.source === "aster" ? aster.entries : [];
  const localLedgerMerged = selected.source === "aster" && entries.length > officialEntries.length;

  return NextResponse.json({
    ok: true,
    entries,
    sources: {
      aster: aster.source,
      localLedgerFallback: selected.source === "local-fallback",
      localLedgerMerged,
    },
    officialHistory: selected.source === "aster",
    historySource: selected.source,
    historyNotice: selected.source === "local-fallback"
      ? "Aster公式約定が0件のため、保存済みの取引ledgerを読み取り専用で表示しています。"
      : localLedgerMerged
        ? "Aster公式約定に保存済みledgerの未取得分を重複排除して補完表示しています。"
        : undefined,
    historyRange: "90d",
    refreshedAt: aster.refreshedAt,
    readOnlyError: aster.error,
    runtime: {
      commonReleaseSha: runtime?.releaseSha ?? null,
      commonRuntimeSynchronized: runtime?.runtimeLineage.synchronized ?? false,
      v12V4ReleaseSha: v12V4?.actual.v4ReleaseSha ?? null,
      v12V4Status: v12V4?.displayStatus ?? "UNAVAILABLE",
      checkedAt: runtime?.checkedAt ?? (v12V4 ? new Date(v12V4.timestamps.checkedAt).toISOString() : null),
    },
  }, { headers });
}
