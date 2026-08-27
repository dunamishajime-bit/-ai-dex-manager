"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, ChevronRight, CircleDot, Coins, ShieldCheck, Wallet } from "lucide-react";

import { AttentionList, MetricCard, StrategyOverviewCards } from "@/components/features/DecisionUi";
import { useDecisionStatus } from "@/hooks/useDecisionStatus";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { buildDecisionViewModel } from "@/lib/ui/disterminal-ui-view-model";

function checkedAt(value?: string) {
  return value ? new Date(value).toLocaleString("ja-JP") : "未取得";
}

function QuickLink({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof Wallet }) {
  return <Link href={href} className="group rounded-[20px] border border-white/10 bg-black/20 p-3 transition hover:border-gold-300/35 hover:bg-white/[0.04]"><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-bold text-white"><Icon className="h-4 w-4 text-gold-100" />{title}</span><ArrowRight className="h-4 w-4 text-gold-100/65 transition group-hover:translate-x-1" /></div><p className="mt-2 text-[11px] leading-5 text-white/55">{detail}</p></Link>;
}

export default function HomePage() {
  const { snapshot: decisionSnapshot, loading: decisionLoading, error: decisionError } = useDecisionStatus();
  const { snapshot: portfolio, loading: portfolioLoading, error: portfolioError } = useLivePortfolio();
  const model = decisionSnapshot ? buildDecisionViewModel({ ...decisionSnapshot, portfolio: portfolio ? { positions: portfolio.positions.map(({ symbol, side }) => ({ symbol, side })) } : undefined }) : null;
  const positions = portfolio?.positions || [];
  const candidateCount = model?.strategyCards.reduce((sum, card) => sum + (card.observedCandidates ?? 0), 0);
  const signalCount = model?.strategyCards.reduce((sum, card) => sum + (card.eligibleDirections ?? 0), 0);
  const fireCount = model?.strategyCards.filter((card) => card.state === "FIRE").length;
  const status = model?.systemStatus || (decisionLoading ? "確認中" : "未取得");
  const statusClass = status === "LIVE / HEALTHY" ? "border-emerald-300/40 bg-emerald-400/12 text-emerald-100" : status === "確認中" ? "border-amber-300/40 bg-amber-400/12 text-amber-100" : "border-rose-300/40 bg-rose-400/12 text-rose-100";

  return <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white md:p-4">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
    <div className="relative z-10 space-y-4">
      <section className="panel-gold rounded-[28px] p-5 md:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/75"><ShieldCheck className="h-4 w-4" />DISTerminal / SYSTEM STATUS</div><h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">運用状態を3秒で確認</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-white/68">現在の実Runner状態、実候補、Signal、Blockerだけを表示します。細かな条件と発火経路は判定状況で確認できます。</p></div>
          <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end"><span className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-black tracking-[0.12em] ${statusClass}`}><CircleDot className="h-4 w-4" />{status}</span><span className="text-[11px] text-white/45">判定確認：{checkedAt(model?.checkedAt)}</span></div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="実候補" value={candidateCount === undefined ? "—" : String(candidateCount)} detail="Runner snapshotに記録された候補" />
        <MetricCard label="成立Signal" value={signalCount === undefined ? "—" : String(signalCount)} detail="Long / Shortの実判定" tone={signalCount ? "positive" : "default"} />
        <MetricCard label="発火確認" value={fireCount === undefined ? "—" : String(fireCount)} detail="実Runnerの約定・履歴確認" tone={fireCount ? "positive" : "default"} />
        <MetricCard label="実建玉" value={portfolio ? String(positions.length) : "—"} detail={portfolio ? `Aster / ${portfolio.orders.count} open orders` : portfolioLoading ? "Aster取得中" : portfolioError || "未取得"} />
      </section>

      {decisionError ? <div className="rounded-2xl border border-amber-300/25 bg-amber-400/8 px-4 py-3 text-xs leading-5 text-amber-100">判定表示の一部を取得できません：{decisionError}</div> : null}

      <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-100/68">ACTIVE STRATEGIES</div><h2 className="mt-1 text-xl font-black text-white">ロジック別の現在状態</h2></div><Link href="/decision-status" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/75">詳細を見る<ChevronRight className="h-3.5 w-3.5" /></Link></div><div className="mt-4">{model ? <StrategyOverviewCards cards={model.strategyCards} compact /> : <div className="rounded-2xl border border-dashed border-white/12 px-4 py-8 text-center text-sm text-white/50">実Runner状態を確認しています…</div>}</div></section>

      <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-100/68">ATTENTION</div><h2 className="mt-1 text-xl font-black text-white">発火に近い実データ</h2></div><span className="text-[11px] text-white/45">最大3件 / 推測なし</span></div><div className="mt-4">{model ? <AttentionList items={model.attentionItems} /> : <div className="rounded-2xl border border-dashed border-white/12 px-4 py-8 text-center text-sm text-white/50">候補を取得しています…</div>}</div></section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><QuickLink href="/positions" title="Dashboard" detail="残高・損益・建玉・ロジック別の運用俯瞰" icon={BarChart3} /><QuickLink href="/decision-status" title="判定状況" detail="候補からGate・発注照合までの実経路" icon={ShieldCheck} /><QuickLink href="/performance" title="損益カレンダー" detail="実約定の決済損益を日付ごとに確認" icon={Coins} /><QuickLink href="/wallets" title="運用ウォレット" detail="Aster口座とウォレット状態を確認" icon={Wallet} /></section>

      <p className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-[11px] leading-5 text-white/45">HPは読み取り専用です。注文・取消・決済・建玉変更は行いません。ポートフォリオと判定状況は約30秒ごと、手動再確認でも更新します。</p>
    </div>
  </main>;
}
