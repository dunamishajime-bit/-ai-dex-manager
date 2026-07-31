"use client";

import { RefreshCw, ShieldCheck } from "lucide-react";
import { useDisterminalAccount } from "@/hooks/useDisterminalAccount";
import { DataCard, ReadOnlyNotice, SourceLine, formatUsd } from "@/components/disterminal/ReadOnlyCard";

export default function WalletsPage() {
  const { data: account, loading, refresh } = useDisterminalAccount();
  return (
    <main className="space-y-4">
      <section className="rounded-3xl border border-gold-400/16 bg-[#06090f] p-5 text-white md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/70"><ShieldCheck className="h-4 w-4" />AsterDEX account</div>
            <h1 className="mt-2 text-3xl font-black">Aster口座 / 残高</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/65">AsterDEX公式の認証付き読み取りAPIから取得した口座情報です。入金、出金、ウォレット作成、注文操作はこの画面では行いません。</p>
          </div>
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/75"><RefreshCw className="h-4 w-4" />更新</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DataCard label="Wallet Balance" value={account?.ok ? formatUsd(account.walletBalanceUsd) : loading ? "取得中…" : "取得不能"} />
          <DataCard label="Equity" value={account?.ok ? formatUsd(account.equityUsd) : loading ? "取得中…" : "取得不能"} />
          <DataCard label="Available" value={account?.ok ? formatUsd(account.availableBalanceUsd) : loading ? "取得中…" : "取得不能"} />
          <DataCard label="Margin Balance" value={account?.ok ? formatUsd(account.marginBalanceUsd) : loading ? "取得中…" : "取得不能"} />
        </div>
      </section>
      {!account?.ok ? <ReadOnlyNotice tone="warning">Aster残高を取得できません。実残高0と取得失敗を区別しています。</ReadOnlyNotice> : null}
      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-lg font-bold">口座情報</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><div className="text-xs text-white/50">Aster user address</div><div className="mt-1 font-mono text-sm">{account?.ok ? account.accountAddress ?? "未取得" : "未確認"}</div></div>
          <div><div className="text-xs text-white/50">Unrealized PnL</div><div className="mt-1 text-lg font-bold">{account?.ok ? formatUsd(account.unrealizedPnlUsd) : "未確認"}</div></div>
          <div><div className="text-xs text-white/50">Open Orders</div><div className="mt-1 text-lg font-bold">{account?.ok && account.openOrderCount !== null ? account.openOrderCount : "未確認"}</div></div>
          <div><div className="text-xs text-white/50">Positions</div><div className="mt-1 text-lg font-bold">{account?.ok ? account.positions.length : "未確認"}</div></div>
        </div>
      </section>
      <SourceLine source={account?.ok ? account.source : "AsterDEX read-only account API"} fetchedAt={account?.fetchedAt} />
    </main>
  );
}
