"use client";

import { RefreshCw, ShieldCheck } from "lucide-react";
import { useDisterminalTrades } from "@/hooks/useDisterminalTrades";
import { DataCard, ReadOnlyNotice, SourceLine, formatUsd } from "@/components/disterminal/ReadOnlyCard";

export default function HistoryPage() {
  const { data, loading, refresh } = useDisterminalTrades();
  const trades = data?.ok ? data.closedTrades : [];
  const netPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const wins = trades.filter((trade) => trade.netPnl > 0).length;
  return (
    <main className="space-y-4">
      <section className="rounded-3xl border border-gold-400/16 bg-[#06090f] p-5 text-white md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/70"><ShieldCheck className="h-4 w-4" />AsterDEX fills</div>
            <h1 className="mt-2 text-3xl font-black">トレード履歴</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">AsterDEX userTradesをV96 Crypto / V52 Stockに分類し、未決済Entryを利益・損失へ含めずFIFOで決済済み取引だけを表示します。</p>
          </div>
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/75"><RefreshCw className="h-4 w-4" />更新</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <DataCard label="Closed Trades" value={data?.ok ? String(trades.length) : loading ? "取得中…" : "取得不能"} />
          <DataCard label="Net PnL" value={data?.ok ? formatUsd(netPnl) : loading ? "取得中…" : "取得不能"} />
          <DataCard label="Win Rate" value={data?.ok && trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) + "%" : data?.ok ? "データなし" : "未確認"} />
        </div>
      </section>
      {!data?.ok ? <ReadOnlyNotice tone="warning">Aster約定履歴を取得できません。過去取引を0件へ置き換えていません。</ReadOnlyNotice> : null}
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 px-5 py-4"><h2 className="font-bold">決済済み取引</h2><p className="mt-1 text-xs text-white/50">{data?.ok ? "約定数: " + data.fills : "source未確認"}</p></div>
        {loading ? <div className="p-5 text-sm text-white/60">Aster約定履歴を取得中…</div> : trades.length === 0 && data?.ok ? <div className="p-5 text-sm text-white/60">決済済み取引は確認されていません。未決済Entryはここへ表示しません。</div> : null}
        <div className="divide-y divide-white/8">
          {trades.map((trade) => (
            <div key={trade.id} className="grid gap-3 px-5 py-4 text-sm lg:grid-cols-[0.8fr_0.8fr_1fr_1fr_1fr]">
              <div><div className="font-bold">{trade.symbol}</div><div className="mt-1 text-xs text-white/50">{trade.strategy} / {trade.side}</div></div>
              <div className="text-xs text-white/60">Entry<br />{new Date(trade.entryAt).toLocaleString("ja-JP")}<br />{trade.entryPrice}</div>
              <div className="text-xs text-white/60">Exit<br />{new Date(trade.exitAt).toLocaleString("ja-JP")}<br />{trade.exitPrice}</div>
              <div className="text-xs text-white/60">数量 {trade.quantity}<br />保有 {trade.holdingMinutes}分<br />理由 {trade.exitReason}</div>
              <div className={trade.netPnl >= 0 ? "text-emerald-200" : "text-rose-200"}>Net {formatUsd(trade.netPnl)}<div className="mt-1 text-xs text-white/50">Gross {formatUsd(trade.grossPnl)} / 手数料 {formatUsd(trade.commission)}</div></div>
            </div>
          ))}
        </div>
      </section>
      <SourceLine source={data?.ok ? data.source : "AsterDEX userTrades"} fetchedAt={data?.fetchedAt} />
    </main>
  );
}
