"use client";

import { RefreshCw, ShieldCheck } from "lucide-react";
import { useDisterminalAccount } from "@/hooks/useDisterminalAccount";
import { useDisterminalTrades } from "@/hooks/useDisterminalTrades";
import { DataCard, ReadOnlyNotice, SourceLine, formatUsd } from "@/components/disterminal/ReadOnlyCard";

export default function PerformancePage() {
  const { data: account } = useDisterminalAccount();
  const { data, loading, refresh } = useDisterminalTrades();
  const trades = data?.ok ? data.closedTrades : [];
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const maxLossStreak = trades.reduce((state, trade) => {
    const current = trade.netPnl < 0 ? state.current + 1 : 0;
    return { current, max: Math.max(state.max, current) };
  }, { current: 0, max: 0 }).max;
  const byStrategy = (strategy: "V96" | "V52") => trades.filter((trade) => trade.strategy === strategy);

  return (
    <main className="space-y-4">
      <section className="rounded-3xl border border-gold-400/16 bg-[#06090f] p-5 text-white md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/70"><ShieldCheck className="h-4 w-4" />Performance / read-only analysis</div>
            <h1 className="mt-2 text-3xl font-black">成績・AI分析</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">AsterDEXの決済済み約定だけから決定論的な統計を計算します。AI分析は提案のみで、注文・設定・LIVE制御を行いません。</p>
          </div>
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/75"><RefreshCw className="h-4 w-4" />更新</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DataCard label="Equity" value={account?.ok ? formatUsd(account.equityUsd) : "未確認"} />
          <DataCard label="Net PnL" value={data?.ok ? formatUsd(trades.reduce((sum, trade) => sum + trade.netPnl, 0)) : loading ? "取得中…" : "取得不能"} />
          <DataCard label="Profit Factor" value={data?.ok ? (grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : "—") : "未確認"} />
          <DataCard label="Max Loss Streak" value={data?.ok ? String(maxLossStreak) : "未確認"} />
        </div>
      </section>
      {!data?.ok ? <ReadOnlyNotice tone="warning">決済履歴を取得できないため、成績を0や空の成功値として表示していません。</ReadOnlyNotice> : null}
      <section className="grid gap-4 sm:grid-cols-2">
        {(["V96", "V52"] as const).map((strategy) => {
          const rows = byStrategy(strategy);
          const pnl = rows.reduce((sum, trade) => sum + trade.netPnl, 0);
          return <div key={strategy} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><h2 className="text-lg font-bold">{strategy} {strategy === "V96" ? "Crypto" : "Stock"}</h2><div className="mt-4 grid grid-cols-2 gap-3"><DataCard label="決済数" value={data?.ok ? String(rows.length) : "未確認"} /><DataCard label="Net PnL" value={data?.ok ? formatUsd(pnl) : "未確認"} /><DataCard label="勝率" value={data?.ok && rows.length ? ((rows.filter((trade) => trade.netPnl > 0).length / rows.length) * 100).toFixed(1) + "%" : data?.ok ? "データなし" : "未確認"} /><DataCard label="平均損益" value={data?.ok && rows.length ? formatUsd(pnl / rows.length) : "未確認"} /></div></div>;
        })}
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-bold">AI取引分析</h2>
        <ReadOnlyNotice>現在の公開UIでは、Aster約定の決済済みデータが取得できる場合のみ分析を表示します。APIキー未設定、認証失敗、通信失敗時は「取得不能」とし、推測や注文提案の自動実行は行いません。</ReadOnlyNotice>
        <div className="mt-4 grid gap-3 text-sm text-white/70 md:grid-cols-3"><div>良かった点: 決済済み取引のNet PnLを戦略別に分離します。</div><div>改善候補: 手数料・保有時間・連敗を確認します。</div><div>判断範囲: 読み取り専用。LIVE設定は変更しません。</div></div>
      </section>
      <SourceLine source={data?.ok ? data.source : "AsterDEX userTrades"} fetchedAt={data?.fetchedAt} />
    </main>
  );
}
