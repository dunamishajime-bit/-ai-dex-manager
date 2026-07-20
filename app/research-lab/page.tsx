import { Activity, CheckCircle2, Clock3, Database, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp } from "lucide-react";

import SettlementAnalysisPanel from "@/components/research-lab/SettlementAnalysisPanel";
import ResearchLabSubnav from "@/components/research-lab/ResearchLabSubnav";
import { CURRENT_DISDEX_STRATEGY } from "@/lib/current-strategy-display";

function StatCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: React.ComponentType<{ className?: string }> }) {
  return <div className="rounded-[22px] border border-gold-400/16 bg-white/[0.035] p-4"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/70">{label}</span><Icon className="h-4 w-4 text-gold-100" /></div><div className="mt-3 text-xl font-black text-white">{value}</div><p className="mt-2 text-[11px] leading-5 text-white/68">{note}</p></div>;
}

const PIPELINE = [
  "実約定したreduce-only決済を耐久状態から検知",
  "Entry／Exit価格・数量・方向・決済理由を紐付け",
  "決済前の完成済み市場足からMFE／MAEを測定",
  "利益・損失のどちらでも良かった点／悪かった点を記録",
  "利益を伸ばせた可能性と具体的な改善仮説を提示",
  "改善案はBT／OOSで検証し、Liveロジックへ自動変更しない",
];

export default function ResearchLabPage() {
  return <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.11),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.07),transparent_30%)]" />
    <div className="relative z-10 space-y-4 p-3 md:p-5">
      <section className="rounded-[28px] border border-gold-400/18 bg-[linear-gradient(180deg,rgba(17,18,20,0.92),rgba(6,8,12,0.96))] p-5 md:p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/75"><Activity className="h-4 w-4" />AI研究ラボ</div><h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Trade Outcome Research Lab</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-white/76">現在の実売買ロジックで決済された取引を一件ずつ検証し、利益が出た場合も損失が出た場合も、何が良くて何が悪かったか、さらに利益を伸ばせた可能性があったかを分析します。</p></div><div className="flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-xs font-bold text-cyan-100"><Sparkles className="h-4 w-4" />POST_SETTLEMENT_ANALYSIS</div></div></section>

      <section className="rounded-[22px] border border-emerald-400/22 bg-emerald-500/[0.055] p-4 text-sm leading-7 text-emerald-50/82"><div className="flex items-center gap-2 font-bold text-emerald-50"><ShieldCheck className="h-4 w-4" />実売買との境界</div><p className="mt-1">対象は <b>{CURRENT_DISDEX_STRATEGY.name}</b>（最大Gross {CURRENT_DISDEX_STRATEGY.maximumGross.toFixed(1)}）です。分析は研究用の記録であり、APIキー・口座・注文・ポジション・実売買設定を自動変更しません。</p></section>

      <ResearchLabSubnav />
      <SettlementAnalysisPanel />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><StatCard label="Current strategy" value="V35 + PENGU V46" note="AsterDEX実売買の決済を分析" icon={Target} /><StatCard label="Trigger" value="Settlement" note="一定時間ごとではなく決済完了時" icon={Clock3} /><StatCard label="Evidence" value="Fill + candles" note="実約定と完成済み市場足" icon={Database} /><StatCard label="Outcome" value="Profit / Loss" note="プラス・マイナスを同じ基準で評価" icon={TrendingUp} /><StatCard label="Live change" value="禁止" note="改善案は検証後に手動承認" icon={ShieldCheck} /></section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]"><div className="rounded-[24px] border border-gold-400/16 bg-white/[0.035] p-4 md:p-5"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-gold-100" /><h2 className="font-bold">決済後分析パイプライン</h2></div><div className="mt-4 grid gap-3 md:grid-cols-2">{PIPELINE.map((item, index) => <div key={item} className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold-400/24 bg-gold-400/10 text-xs font-black text-gold-50">{index + 1}</div><span className="text-sm font-semibold text-white/86">{item}</span></div>)}</div></div><div className="space-y-4"><div className="rounded-[24px] border border-emerald-400/18 bg-emerald-500/[0.055] p-4 md:p-5"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-200" /><h2 className="font-bold text-emerald-50">分析の考え方</h2></div><p className="mt-3 text-sm leading-7 text-emerald-50/75">勝ちでも「もっと伸ばせたか」をMFEと回収率で確認し、負けでも「途中で利益機会があったか」を確認します。反実仮想は証明済みの改善ではなく、次のBT／OOS検証候補として扱います。</p></div><div className="rounded-[24px] border border-rose-400/18 bg-rose-500/[0.055] p-4 md:p-5"><div className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-rose-200" /><h2 className="font-bold text-rose-50">旧時間駆動研究</h2></div><p className="mt-3 text-sm leading-7 text-rose-50/75">旧Win80／Ultra90の定時研究・旧Championログは現行の決済分析対象から外しました。今後のラボ表示は現行V35＋PENGU V46の決済イベントを基準にします。</p></div></div></section>

      <section className="rounded-[24px] border border-white/10 bg-white/[0.025] p-4 md:p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-white/55" /><div><h2 className="font-bold text-white/85">Evidenceポリシー</h2><p className="mt-2 text-sm leading-7 text-white/60">手数料・Fundingのincome明細が取得できない場合は概算と明示し、MFE／MAEの足粒度も表示します。分析結果だけで実売買ロジックを変更せず、改善案は別途BT／OOSで再検証します。</p></div></div></section>
    </div>
  </main>;
}
