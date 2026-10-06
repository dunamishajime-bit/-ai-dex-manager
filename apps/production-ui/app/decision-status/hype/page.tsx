import { HypeDecisionPanel } from "@/components/features/HypeDecisionPanel";
import { LivePerformanceDashboard } from "@/components/features/LivePerformanceDashboard";
export default function HypeDecisionPage(){
  return <main className="min-w-0 space-y-5 overflow-x-hidden p-3 sm:p-4 md:p-6">
    <header className="panel-gold rounded-[28px] p-4 md:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-100/70">Read-only Production / HYPE_LONG</p>
      <h1 className="gold-heading mt-2 text-2xl font-black md:text-3xl">HYPE75 発火判定・稼働状態</h1>
      <p className="mt-3 text-sm leading-6 text-white/70">確定H1のEMA12/48、regime slope、24h breakout、Gross1.5と実Runnerの最新判定を表示します。Entry・Exit・STOPは検証済みHYPE75を維持しています。</p>
    </header>
    <HypeDecisionPanel strategy="HYPE_LONG" />
    <section className="min-w-0 rounded-[28px] border border-white/10 bg-black/20 p-3">
      <LivePerformanceDashboard logic="HYPE" title="HYPE 実約定・累積/月次損益" />
    </section>
  </main>;
}
