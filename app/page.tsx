Exit code: 0
Wall time: 1 seconds
Output:
"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, Coins, Settings, Wallet } from "lucide-react";

import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";
import { useSimulation } from "@/context/SimulationContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";

function SummaryCard({ title, value, text, tone = "default" }: { title: string; value: string; text: string; tone?: "default" | "profit" | "loss" }) {
  return <div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-gold-100/72">{title}</div><div className={`mt-2 text-[1.45rem] font-black ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-white"}`}>{value}</div><div className="mt-1 text-[11px] leading-5 text-white/78">{text}</div></div>;
}

function QuickLink({ href, title, text, icon: Icon }: { href: string; title: string; text: string; icon: React.ComponentType<{ className?: string }> }) {
  return <Link href={href} className="group rounded-[22px] border border-gold-400/16 bg-white/[0.03] px-4 py-4 transition hover:border-gold-300/36"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold text-white"><Icon className="h-4 w-4 text-gold-100" />{title}</div><ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-0.5" /></div><p className="mt-2 text-[11px] leading-5 text-white/76">{text}</p></Link>;
}

export default function HomePage() {
  const { activeStrategies, tradeNotifications } = useSimulation();
  const { wallet, asterAccount } = useOperationalWallet();
  const accountAvailable = asterAccount?.status === "available";
  const portfolio = accountAvailable ? asterAccount.portfolioUsd : undefined;
  const available = accountAvailable ? asterAccount.availableBalanceUsd : undefined;
  const positions = accountAvailable ? asterAccount.positions.length : undefined;

  return <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
    <div className="relative z-10 space-y-3 p-3 md:p-4">
      <section className="grid gap-3 xl:grid-cols-[1.06fr_0.94fr]">
        <div className="panel-gold rounded-[30px] p-4 md:p-5"><div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-100/76">DISTerminal</div><h1 className="gold-heading mt-3 text-[2.2rem] font-black tracking-tight md:text-[3rem]">AsterDEX運用状況</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-white/86">残高・ポジション・取引履歴は、取得できる場合にAsterDEXの読み取り専用データを表示します。取得不能時にゼロや推測値へ置き換えません。</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-gold-400/20 px-3 py-1.5 text-[11px] text-gold-50">AsterDEX公式残高</span><span className="rounded-full border border-gold-400/20 px-3 py-1.5 text-[11px] text-gold-50">公式約定履歴</span><span className="rounded-full border border-gold-400/20 px-3 py-1.5 text-[11px] text-gold-50">読み取り専用</span></div></div>
        <div className="grid gap-3"><SummaryCard title="Current Portfolio" value={portfolio === undefined ? "取得不能" : `$${portfolio.toFixed(2)}`} text={available === undefined ? "AsterDEX口座情報を確認できません" : `利用可能残高 $${available.toFixed(2)} / ポジション ${positions ?? 0}`} tone={portfolio === undefined ? "loss" : "default"} /><SummaryCard title="Aster口座データ" value={accountAvailable ? "確認済み" : asterAccount?.status === "not_configured" ? "未設定" : "取得不能"} text={asterAccount?.refreshedAt ? `最終確認 ${new Date(asterAccount.refreshedAt).toLocaleString("ja-JP")}` : "最終確認時刻 未確認"} tone={accountAvailable ? "profit" : "loss"} /></div>
      </section>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><QuickLink href="/wallets" title="運用ウォレット" text="AsterDEX口座の残高・利用可能残高・ポジションを確認します。" icon={Wallet} /><QuickLink href="/positions" title="ダッシュボード" text="AsterDEX公式ポジションと稼働情報を確認します。" icon={BarChart3} /><QuickLink href="/history" title="トレード履歴" text="AsterDEX公式の過去約定だけを表示します。" icon={Coins} /><QuickLink href="/settings" title="設定" text="ログインと基本設定を確認します。" icon={Settings} /></section>
      <section className="grid gap-3 md:grid-cols-3"><SummaryCard title="Strategies" value={`${activeStrategies.length}`} text="画面で読み込まれている戦略数です。" /><SummaryCard title="Notifications" value={`${tradeNotifications.length}`} text="最新の通知件数です。" /><SummaryCard title="Positions" value={positions === undefined ? "未確認" : `${positions}`} text="AsterDEX公式ポジション件数です。" /></section>
      <LiveDecisionPanel compact />
      {!accountAvailable ? <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">AsterDEX口座情報を取得できないため、LIVE残高・ポジションを推測表示していません。</div> : null}
      {wallet?.note ? <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">運用メモ: {wallet.note}</div> : null}
    </div>
  </main>;
}

