"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";

import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { useLogicStatus } from "@/hooks/useLogicStatus";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

export function DecisionStatusPanel() {
  const { snapshot, refresh: refreshPortfolio } = useLivePortfolio();
  const { snapshot: logic, loading, refresh: refreshLogic } = useLogicStatus();
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  useEffect(() => setRefreshedAt(new Date().toISOString()), [logic?.generatedAt, snapshot?.capturedAt]);
  const refresh = async () => { await Promise.all([refreshPortfolio(), refreshLogic()]); setRefreshedAt(new Date().toISOString()); };
  const held = new Map((snapshot?.positions || []).map((position) => [position.symbol, position]));
  const v12Blocked = logic?.v12.status !== "running";
  const stockSymbols = config.stockSymbols;

  const renderSymbol = (symbol: string, sleeve: "V12" | "V52") => {
    const position = held.get(symbol);
    const serviceRunning = sleeve === "V12" ? logic?.v12.status === "running" : logic?.v52.status === "running";
    const status = position ? "保有中" : !serviceRunning ? "停止 / 要確認" : "判定待機";
    const reason = position ? `Aster実建玉 ${position.side} / 数量 ${position.quantity}` : !serviceRunning ? (sleeve === "V12" ? logic?.v12.reason || "V12 runnerがFail Closed" : "V52 runnerが停止中") : "現在のrunner状態で建玉なし。発火条件の未達または待機中です。";
    return <article key={symbol} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full border border-gold-400/25 text-[10px] font-bold text-gold-100">{sleeve}</span><span className="font-bold">{symbol}</span></div><span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${status === "保有中" ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100" : status.startsWith("停止") ? "border-rose-400/35 bg-rose-500/10 text-rose-100" : "border-white/15 bg-white/[0.04] text-white/70"}`}>{status}</span></div><p className="mt-2 text-xs leading-5 text-white/70">{reason}</p></article>;
  };

  if (loading && !logic) return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/60">VPS runnerの判定状態を取得しています…</div>;
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60"><span className="flex items-center gap-2">{logic?.status === "running" ? <ShieldCheck className="h-4 w-4 text-emerald-300" /> : <ShieldAlert className="h-4 w-4 text-rose-300" />}VPS runnerの実状態 / 読み取り専用</span><span>確認: {refreshedAt ? new Date(refreshedAt).toLocaleString("ja-JP") : "未取得"}</span><button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80 hover:bg-white/[0.08]"><RefreshCw className="h-4 w-4" />再確認</button></div>{v12Blocked ? <div className="flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"><ShieldAlert className="mt-0.5 h-4 w-4" />V12はFail Closedです。候補表示だけで注文可能とは判定しません: {logic?.v12.reason || "要確認"}</div> : null}<div className="grid gap-4 xl:grid-cols-2"><section className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-lg font-bold"><Activity className="h-5 w-5 text-gold-100" />V12 X1.00 ALL</div><p className="mt-2 text-xs text-white/55">{logic?.v12.service.unit || "service"} / 実建玉とrunner状態のみ表示</p><div className="mt-4 space-y-2">{config.v12Symbols.map((symbol) => renderSymbol(symbol, "V12"))}</div></section><section className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-lg font-bold"><Activity className="h-5 w-5 text-gold-100" />V52 Stock</div><p className="mt-2 text-xs text-white/55">{logic?.v52.service.unit || "service"} / 市場時間・参照ゲートはVPS側が判定</p><div className="mt-4 space-y-2">{stockSymbols.map((symbol) => renderSymbol(symbol, "V52"))}</div></section></div></div>;
}
