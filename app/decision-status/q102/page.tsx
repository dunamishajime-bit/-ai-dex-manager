import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function Q102DecisionPage() {
  return <main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Decision monitor / Q102</div><h1 className="gold-heading mt-2 text-3xl font-black">Q102 Causal V4 判定状況</h1><p className="mt-3 text-sm leading-7 text-white/75">Q102実stateに加え、Production Causal V4をread-only実行して各通貨の自然Gate、Family、Side、1-slot selectorの選定状況を表示します。</p></header><DecisionStatusPanel logic="q102" /></main>;
}
