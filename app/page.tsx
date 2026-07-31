"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, FileText, Settings, ShieldCheck, Wallet } from "lucide-react";
import { useDisterminalAccount } from "@/hooks/useDisterminalAccount";
import { useDisterminalLiveStatus } from "@/hooks/useDisterminalLiveStatus";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { DataCard, ReadOnlyNotice, SourceLine, formatUsd } from "@/components/disterminal/ReadOnlyCard";

function QuickLink({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof Wallet }) {
  return (
    <Link href={href} className="group rounded-2xl border border-gold-400/16 bg-black/20 p-4 transition hover:border-gold-300/40">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold text-white"><Icon className="h-4 w-4 text-gold-100" />{title}</span>
        <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-1" />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/65">{detail}</p>
    </Link>
  );
}

export default function HomePage() {
  const { data: account, loading: accountLoading } = useDisterminalAccount();
  const { data: live, loading: liveLoading } = useDisterminalLiveStatus();
  const liveConfirmed = live?.state === "ACTIVE";
  const liveLabel = liveLoading ? "LIVE状態を確認中" : liveConfirmed ? "LIVE稼働確認済み" : "LIVE状態未確認";

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)] md:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
      <div className="relative z-10 space-y-4">
        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="panel-gold rounded-[30px] p-5 md:p-7">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />DISTerminal</div>
            <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">V96 Crypto + V52 Stock 統合LIVE</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/78">AsterDEXの読み取り専用口座情報、ポジション、注文、約定履歴を確認します。画面から注文は作成しません。</p>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className={"rounded-full border px-3 py-1.5 " + (liveConfirmed ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100" : "border-amber-400/25 bg-amber-500/10 text-amber-100")}>{liveLabel}</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V96 Daily Loss {config.v96DailyLossPct}%</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V52 Daily Loss {config.v52DailyLossPct}%</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">最大Gross {config.maximumGross.toFixed(1)} / PENGU {config.penguInitialGross.toFixed(2)}</span>
            </div>
            {live?.reason ? <p className="mt-3 text-xs text-white/55">{live.reason}</p> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <DataCard label="Aster Wallet Balance" value={account?.ok ? formatUsd(account.walletBalanceUsd) : accountLoading ? "取得中…" : "取得不能"} detail="Aster read-only account API" />
            <DataCard label="Equity" value={account?.ok ? formatUsd(account.equityUsd) : accountLoading ? "取得中…" : "取得不能"} />
            <DataCard label="Available" value={account?.ok ? formatUsd(account.availableBalanceUsd) : accountLoading ? "取得中…" : "取得不能"} />
            <DataCard label="Managed Positions" value={account?.ok ? String(account.positions.length) : accountLoading ? "取得中…" : "未確認"} detail={account?.ok ? "V96/V52対象" : "0を代用していません"} />
          </div>
        </section>
        {!account?.ok ? <ReadOnlyNotice tone="warning">Aster口座データを確認できません。取得失敗を0として表示していません。</ReadOnlyNotice> : null}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLink href="/positions" title="LIVE状況 / ポジション" detail="V96 Crypto・V52 Stockの建玉とOpen Ordersを読み取り確認" icon={BarChart3} />
          <QuickLink href="/wallets" title="Aster口座" detail="残高、Equity、Available、Margin、口座識別子を確認" icon={Wallet} />
          <QuickLink href="/history" title="トレード履歴" detail="Aster約定をV96/V52別にFIFO照合して表示" icon={FileText} />
          <QuickLink href="/performance" title="成績・分析" detail="決済済み約定の統計と読み取り専用分析" icon={Settings} />
        </section>
        <SourceLine source={account?.ok ? account.source : "AsterDEX read-only account API"} fetchedAt={account?.fetchedAt} />
      </div>
    </main>
  );
}
