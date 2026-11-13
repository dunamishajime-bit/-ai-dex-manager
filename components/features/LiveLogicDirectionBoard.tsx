"use client";

import Link from "next/link";
import { Activity, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Gate = {
  state?: string;
  kind?: string;
};

type LiveRow = {
  id: string;
  symbol: string;
  logic: string;
  side: string;
  sourceRoute?: string;
  fresh?: boolean;
  reason?: string;
  href?: string;
  checkedAt?: number;
  gates?: Gate[];
};

type RankingResponse = {
  ok: boolean;
  checkedAt: number;
  runtimeSha: string;
  rows: LiveRow[];
};

function logicLabel(value: string) {
  return value === "V12_V4" ? "V12 V4" : value;
}

function sideClass(side: string) {
  if (side === "LONG") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (side === "SHORT") return "border-rose-400/30 bg-rose-500/10 text-rose-100";
  return "border-white/15 bg-white/[0.04] text-white/65";
}

function signalState(row: LiveRow) {
  if (!row.fresh) return "STALE / 未確認";
  const signalGates = (row.gates ?? []).filter((gate) => gate.kind !== "execution");
  if (!signalGates.length) return "Signal Gate未取得";
  return signalGates.every((gate) => gate.state === "OK") ? "Signal Gate OK" : "Signal Gate未通過";
}

function dedupe(rows: LiveRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [row.symbol, row.logic, row.side, row.sourceRoute ?? ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function LiveLogicDirectionBoard() {
  const [snapshot, setSnapshot] = useState<RankingResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/system/realtime-ranking", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(body?.error || "取得失敗");
      setSnapshot(body as RankingResponse);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取得失敗");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const rows = useMemo(() => {
    const source = dedupe((snapshot?.rows ?? []).filter((row) => row.logic !== "MARKET"));
    return source.sort((a, b) => {
      const sideRank = (row: LiveRow) => row.side === "LONG" || row.side === "SHORT" ? 0 : 1;
      return sideRank(a) - sideRank(b)
        || Number(Boolean(b.fresh)) - Number(Boolean(a.fresh))
        || a.symbol.localeCompare(b.symbol)
        || a.logic.localeCompare(b.logic)
        || (a.sourceRoute ?? "").localeCompare(b.sourceRoute ?? "");
    });
  }, [snapshot]);

  const longCount = rows.filter((row) => row.side === "LONG").length;
  const shortCount = rows.filter((row) => row.side === "SHORT").length;
  const waitCount = rows.filter((row) => row.side !== "LONG" && row.side !== "SHORT").length;

  return (
    <section className="rounded-[18px] border border-gold-400/18 bg-[#070b12] p-3 md:p-4" data-testid="live-logic-direction-board">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <Activity className="h-4 w-4 text-gold-100" />
            LIVEロジック方向
          </div>
          <p className="mt-1 text-[10px] leading-5 text-white/55">
            各LIVEロジックがどの通貨をLONG / SHORT / WAITとして観測しているかを表示します。方向表示と実発注可否は別で、Gate状態も併記します。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-emerald-100">LONG {longCount}</span>
          <span className="rounded-full border border-rose-400/25 bg-rose-500/10 px-2 py-1 text-rose-100">SHORT {shortCount}</span>
          <span className="rounded-full border border-white/15 px-2 py-1 text-white/55">WAIT {waitCount}</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full border border-gold-400/20 px-2 py-1 text-gold-100 disabled:opacity-50"
          >
            <RefreshCw className={busy ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
            更新
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200">{error}。前回成功データがあればそのまま表示します。</p> : null}

      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <Link
            key={[row.symbol, row.logic, row.side, row.sourceRoute ?? ""].join("|")}
            href={row.href || "/decision-status"}
            className="min-w-0 rounded-xl border border-white/10 bg-white/[0.025] p-2.5 transition hover:border-gold-300/30 hover:bg-gold-400/[0.035]"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-white">{row.symbol.replace(/USDT$/, "")}</div>
                <div className="mt-0.5 truncate text-[10px] font-semibold text-gold-100">{logicLabel(row.logic)}</div>
              </div>
              <span className={"shrink-0 rounded-full border px-2 py-1 text-[10px] font-black " + sideClass(row.side)}>
                {row.side || "方向未取得"}
              </span>
            </div>
            <div className="mt-2 break-words text-[9px] leading-4 text-white/60">
              route: <span className="text-white/80">{row.sourceRoute || "route未取得"}</span>
            </div>
            <div className="mt-1 text-[9px] font-semibold text-white/50">{signalState(row)}</div>
            {row.reason ? <div className="mt-1 max-h-8 overflow-hidden text-[9px] leading-4 text-white/40">{row.reason}</div> : null}
          </Link>
        ))}
      </div>

      {!rows.length && snapshot ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-white/45">
          現在取得できるLIVEロジック方向データはありません。
        </div>
      ) : null}

      <div className="mt-2 text-right text-[9px] text-white/35">
        {snapshot ? "runtime " + snapshot.runtimeSha.slice(0, 12) + "… / " + new Date(snapshot.checkedAt).toLocaleTimeString("ja-JP") : "取得中"}
      </div>
    </section>
  );
}
