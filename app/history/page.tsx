"use client";

import { Download, RefreshCw } from "lucide-react";

import { useAsterTradeActivity, type AsterTradeEntry } from "@/hooks/useAsterTradeActivity";
import { useCurrency } from "@/context/CurrencyContext";

function formatNumber(value?: number, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return value.toLocaleString("ja-JP", { maximumFractionDigits: digits });
}

function strategyLabel(strategy?: AsterTradeEntry["strategyId"]) {
  if (strategy === "PENGU") return "PENGU V2";
  if (strategy === "V52") return "V52";
  if (strategy === "V12") return "V12";
  return "その他";
}

export default function HistoryPage() {
  const { entries, activity, loading, error, refresh } = useAsterTradeActivity();
  const { formatPrice } = useCurrency();

  const exportCsv = () => {
    const headers = ["日時", "ロジック", "銘柄", "売買", "状態", "数量", "損益USD"];
    const rows = entries.map((entry) => [entry.executedAt, strategyLabel(entry.strategyId), `${entry.destSymbol}/${entry.sourceSymbol}`, entry.action, entry.tradeStatus || "-", entry.destAmount, entry.netPnlUsd ?? entry.realizedPnlUsd ?? ""].join(","));
    const link = document.createElement("a");
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent([headers.join(","), ...rows].join("\n"))}`;
    link.download = "asterdex-trade-history.csv";
    link.click();
  };

  return (
    <main className="min-h-full space-y-5 rounded-[28px] border border-gold-400/16 bg-[#04060a] p-4 text-white md:p-6">
      <header className="panel-gold rounded-[30px] p-5 md:p-7"><div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/75">Aster official history</div><h1 className="gold-heading mt-3 text-3xl font-black md:text-5xl">自動売買履歴</h1><p className="mt-3 text-sm leading-7 text-white/75">V12・PENGU V2・V52の約定履歴をAsterDEXから読み取り、簡潔に表示します。</p></header>
      <section className="grid gap-3 sm:grid-cols-4"><div className="panel-gold rounded-[22px] p-4"><div className="text-xs text-white/55">全履歴</div><div className="mt-2 text-2xl font-black">{entries.length}</div></div><div className="panel-gold rounded-[22px] p-4"><div className="text-xs text-white/55">24時間</div><div className="mt-2 text-2xl font-black">{activity.recent24h.total}</div></div><div className="panel-gold rounded-[22px] p-4"><div className="text-xs text-white/55">V12 / PENGU</div><div className="mt-2 text-2xl font-black">{activity.recent24h.byStrategy.V12} / {activity.recent24h.byStrategy.PENGU}</div></div><div className="panel-gold rounded-[22px] p-4"><div className="text-xs text-white/55">V52</div><div className="mt-2 text-2xl font-black">{activity.recent24h.byStrategy.V52}</div></div></section>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />再読み込み</button><button type="button" onClick={exportCsv} className="inline-flex items-center gap-2 rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-sm text-gold-200 hover:bg-gold-500/20"><Download className="h-4 w-4" />CSV出力</button></div>
      {error ? <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}
      <section className="panel-gold rounded-[28px] p-4 md:p-5"><div className="mb-3 text-sm font-black">Aster約定一覧</div><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="border-b border-white/10 text-xs text-white/45"><tr><th className="px-3 py-3">日時</th><th className="px-3 py-3">ロジック</th><th className="px-3 py-3">銘柄</th><th className="px-3 py-3">売買</th><th className="px-3 py-3">状態</th><th className="px-3 py-3">数量</th><th className="px-3 py-3">損益</th></tr></thead><tbody>{entries.map((entry) => { const pnl = entry.netPnlUsd ?? entry.realizedPnlUsd; return <tr key={entry.id} className="border-b border-white/5"><td className="px-3 py-3 font-mono text-xs text-white/65">{new Date(entry.executedAt).toLocaleString("ja-JP")}</td><td className="px-3 py-3 font-semibold text-gold-100">{strategyLabel(entry.strategyId)}</td><td className="px-3 py-3">{entry.destSymbol || entry.sourceSymbol}</td><td className={entry.action === "BUY" ? "px-3 py-3 text-emerald-300" : "px-3 py-3 text-rose-300"}>{entry.action === "BUY" ? "買い" : "売り"}</td><td className="px-3 py-3 text-white/65">{entry.tradeStatus === "closed" ? "決済済み" : entry.tradeStatus === "open" ? "保有中" : entry.tradeStatus || "照合"}</td><td className="px-3 py-3 font-mono text-xs">{formatNumber(entry.destAmount, 6)}</td><td className={`px-3 py-3 font-mono text-xs ${Number(pnl || 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{pnl === undefined ? "-" : formatPrice(pnl)}</td></tr>; })}{!loading && entries.length === 0 ? <tr><td colSpan={7} className="px-3 py-12 text-center text-white/50">表示できるAster約定履歴がありません。</td></tr> : null}</tbody></table></div></section>
      <p className="text-xs leading-5 text-white/50">表示元: {entries.length ? "AsterDEX公式約定履歴" : "履歴取得待ち"}。この画面から注文操作はできません。</p>
    </main>
  );
}
