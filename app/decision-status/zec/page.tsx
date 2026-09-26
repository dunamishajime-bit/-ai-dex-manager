import { HypeZecDecisionPanel } from "@/components/features/HypeZecDecisionPanel";
import { LivePerformanceDashboard } from "@/components/features/LivePerformanceDashboard";
export default function ZecDecisionPage(){
  return <main className="min-w-0 space-y-5 overflow-x-hidden p-3 sm:p-4 md:p-6">
    <header className="panel-gold rounded-[28px] p-4 md:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-100/70">Read-only Production / ZEC_LONG</p>
      <h1 className="gold-heading mt-2 text-2xl font-black md:text-3xl">ZEC 発火判定・稼働状態</h1>
      <p className="mt-3 text-sm leading-6 text-white/70">BTC、通貨のモメンタム、EMA20乖離、1分足のブレイク確認を並列表示します。公開足Gateと実発注可能判定は分けて表示します。</p>
    </header>
    <HypeZecDecisionPanel strategy="ZEC_LONG" />
    <section className="min-w-0 rounded-[28px] border border-white/10 bg-black/20 p-3">
      <LivePerformanceDashboard logic="ZEC" title="ZEC 実約定・累積/月次損益" />
    </section>
  </main>;
}
