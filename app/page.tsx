"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, BookOpen, FileText, Settings, Wallet } from "lucide-react";

import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";
import { CURRENT_DISDEX_STRATEGY } from "@/lib/current-strategy-display";

function Card({ title, value, text }: { title: string; value: string; text: string }) {
  return (
    <div className="panel-gold rounded-[22px] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{title}</div>
      <div className="mt-2 text-[1.35rem] font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/72">{text}</div>
    </div>
  );
}

function QuickLink({ href, title, text, icon: Icon }: { href: string; title: string; text: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Link href={href} className="group rounded-[20px] border border-gold-400/16 bg-white/[0.03] px-4 py-4 transition hover:border-gold-300/40">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white"><Icon className="h-4 w-4 text-gold-100" />{title}</div>
        <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-0.5" />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/72">{text}</p>
    </Link>
  );
}

export default function HomePage() {
  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.06),transparent_30%)]" />
      <div className="relative z-10 space-y-3 p-3 md:p-4">
        <section className="panel-gold rounded-[30px] p-4 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-100/76">Professional DisManager / AsterDEX</div>
              <h1 className="gold-heading mt-3 text-[2rem] font-black tracking-tight md:text-[3rem]">{CURRENT_DISDEX_STRATEGY.name}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/84">
                現在の実売買はV35 Coreを基盤に、PENGU V46を条件付きで組み込むポートフォリオです。研究ラボのWin80／Ultra90表示は研究用であり、実売買の判定とは分離されています。
              </p>
            </div>
            <div className="rounded-[18px] border border-profit/30 bg-profit/10 px-4 py-3 text-right">
              <div className="text-[10px] uppercase tracking-[0.2em] text-profit">Live execution</div>
              <div className="mt-1 text-xl font-black text-white">LIVE</div>
              <div className="mt-1 text-[11px] text-white/65">安全ゲート有効</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-gold-400/25 bg-gold-400/10 px-3 py-1.5 text-[11px] font-semibold text-gold-50">V35 Core</span>
            <span className="rounded-full border border-gold-400/25 bg-gold-400/10 px-3 py-1.5 text-[11px] font-semibold text-gold-50">PENGU V46</span>
            <span className="rounded-full border border-profit/30 bg-profit/10 px-3 py-1.5 text-[11px] font-semibold text-profit">One-way / fail-closed</span>
            <span className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/78">最大Gross {CURRENT_DISDEX_STRATEGY.maximumGross.toFixed(1)}</span>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card title="Strategy" value="V35 + V46" text="現行AsterDEX実売買ロジック" />
          <Card title="Managed symbols" value={`${CURRENT_DISDEX_STRATEGY.managedSymbols.length}銘柄`} text={CURRENT_DISDEX_STRATEGY.managedSymbols.join(" / ")} />
          <Card title="PENGU allocation" value="L 0.15 / S 0.15" text="Funding上限 0.0003" />
          <Card title="Unmanaged" value="決済しない" text="closeUnmanagedPositions=false" />
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <QuickLink href="/positions" title="ダッシュボード" text="V46の残高、ポジション、Gross、安全状態を確認します。" icon={BarChart3} />
          <QuickLink href="/wallets" title="運用ウォレット" text="ウォレット管理画面です。AsterDEXの現行状態はダッシュボードを参照してください。" icon={Wallet} />
          <QuickLink href="/research-lab" title="AI研究ラボ" text="研究結果と議論を確認します。実売買とは分離されています。" icon={BookOpen} />
          <QuickLink href="/history" title="トレード履歴" text="現行V46の状態と、旧履歴との境界を確認します。" icon={FileText} />
          <QuickLink href="/settings" title="設定" text="表示・認証設定を管理します。LIVE取引設定は画面から変更しません。" icon={Settings} />
        </section>

        <LiveDecisionPanel compact />
      </div>
    </main>
  );
}

