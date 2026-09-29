import Link from "next/link";
import { IDLE_PRIORITY_SHORT_POLICY } from "@/config/idlePriorityShortPolicy";

const rows=Object.entries(IDLE_PRIORITY_SHORT_POLICY.routes);
export default function IdlePriorityDecisionPage(){
 return <main className="space-y-4 p-4 text-white">
  <header className="panel-gold rounded-[28px] p-5">
   <div className="text-[10px] uppercase tracking-[0.28em] text-gold-100/70">Idle Priority SHORT</div>
   <h1 className="mt-2 text-2xl font-black">Idle Priority 判定状況</h1>
   <p className="mt-2 text-sm text-white/75">通常5ロジックがIdleの時だけ評価。通常ロジックが同時刻に成立した場合は通常側を優先します。Gross 1.00x / Aster 5x Cross。</p>
   <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100">LIVE有効化は 495→63→61→48勝 のdeterministic parity certificate成立後のみです。</div>
  </header>
  <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
   {rows.map(([symbol,r])=><div key={symbol} className="panel-gold rounded-[22px] p-4">
    <div className="text-lg font-black">{symbol.replace("USDT","")}</div>
    <div className="mt-1 text-[10px] text-gold-100/70">{r.route}</div>
    <div className="mt-3 space-y-1 text-xs text-white/75"><div>方向: SHORT</div><div>候補型: {r.archetype}</div><div>保有: {r.holdHours}h</div><div>Cooldown: 12h</div></div>
   </div>)}
  </section>
  <section className="panel-gold rounded-[24px] p-4 text-sm text-white/75">
   <div>共通判定: closed H1 / ret12 / ret24 / BTC24 / rel24 / Volume Ratio / ATR / Breakdown</div>
   <div className="mt-2">Admission: baseline open・same timestamp・pending・sidecar exposureを確認し、Full 1.00xと5x Cross readbackが揃わなければ見送ります。</div>
  </section>
  <Link href="/positions" className="inline-block text-sm text-gold-100">← ダッシュボード</Link>
 </main>
}
