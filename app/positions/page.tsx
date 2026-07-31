"use client";

import { RefreshCw, ShieldCheck } from "lucide-react";
import { useDisterminalAccount } from "@/hooks/useDisterminalAccount";
import { useDisterminalLiveStatus } from "@/hooks/useDisterminalLiveStatus";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { DataCard, ReadOnlyNotice, SourceLine, formatUsd } from "@/components/disterminal/ReadOnlyCard";

export default function PositionsPage() {
  const { data: account, loading, refresh } = useDisterminalAccount();
  const { data: live } = useDisterminalLiveStatus();
  const positions = account?.ok ? account.positions : [];
  const liveConfirmed = live?.state === "ACTIVE";

  return (
    <main className="space-y-4">
      <section className="rounded-3xl border border-gold-400/16 bg-[#06090f] p-5 text-white md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/70"><ShieldCheck className="h-4 w-4" />DISTerminal LIVE monitor</div>
            <h1 className="mt-2 text-3xl font-black">LIVE状況 / ポジション</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">実際のAsterDEX読み取り結果だけを表示します。画面から注文・決済・手動実行はできません。</p>
          </div>
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/75"><RefreshCw className="h-4 w-4" />更新</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DataCard label="LIVE" value={liveConfirmed ? "稼働確認済み" : "未確認"} detail={live?.reason} />
          <DataCard label="Executor" value={config.executor} detail="設定値。実稼働は別途状態ソースで確認" />
          <DataCard label="Open Orders" value={account?.ok && account.openOrderCount !== null ? String(account.openOrderCount) : loading ? "取得中…" : "未確認"} />
          <DataCard label="Total Gross Limit" value={config.maximumGross.toFixed(1)} detail="Portfolio設定値" />
        </div>
      </section>
      {!account?.ok ? <ReadOnlyNotice tone="warning">Aster建玉・Open Ordersを取得できません。取得不能を0件として扱っていません。</ReadOnlyNotice> : null}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-lg font-bold">現在の管理対象建玉</h2>
          <p className="mt-1 text-xs text-white/50">V96: {config.cryptoSymbols.join(", ")} / V52: {config.stockSymbols.join(", ")}</p>
          <div className="mt-4 space-y-2">
            {loading ? <p className="text-sm text-white/60">取得中…</p> : positions.length === 0 && account?.ok ? <p className="text-sm text-white/60">現在、AsterDEXから建玉は確認されていません。</p> : null}
            {positions.map((position) => (
              <div key={position.symbol} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3"><span className="font-bold">{position.symbol}</span><span className={position.side === "LONG" ? "text-emerald-200" : "text-rose-200"}>{position.side}</span></div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-white/65"><span>数量: {position.quantity}</span><span>Entry: {position.entryPrice ?? "未取得"}</span><span>Mark: {position.markPrice ?? "未取得"}</span><span>uPnL: {formatUsd(position.unrealizedPnl)}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-lg font-bold">リスク・安全状態</h2>
          <div className="mt-4 space-y-3 text-sm text-white/70">
            <div className="flex justify-between gap-3"><span>V96 Daily Loss</span><strong className="text-white">{config.v96DailyLossPct}%</strong></div>
            <div className="flex justify-between gap-3"><span>V52 Daily Loss</span><strong className="text-white">{config.v52DailyLossPct}%</strong></div>
            <div className="flex justify-between gap-3"><span>PENGU初期Gross</span><strong className="text-white">{config.penguInitialGross.toFixed(2)}</strong></div>
            <div className="flex justify-between gap-3"><span>Execution Parity / Override</span><strong className="text-amber-100">実状態を確認中</strong></div>
            <div className="flex justify-between gap-3"><span>Kill Switch</span><strong className="text-amber-100">実状態を確認中</strong></div>
          </div>
          <ReadOnlyNotice>この画面は読み取り専用です。状態が取得できない場合、LIVE稼働を推測表示しません。</ReadOnlyNotice>
        </div>
      </section>
      <SourceLine source={account?.ok ? account.source : "AsterDEX read-only account API"} fetchedAt={account?.fetchedAt} />
    </main>
  );
}
