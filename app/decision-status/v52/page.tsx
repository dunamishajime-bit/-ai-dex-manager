import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function V52DecisionPage() {
  return <main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Decision monitor / V52</div><h1 className="gold-heading mt-2 text-3xl font-black">V52 判定状況</h1><p className="mt-3 text-sm leading-7 text-white/75">V50 / V11_EQ、米国株時間窓、basis、net edge、spread、Stock Gross、注文許可状態を表示します。</p></header><DecisionStatusPanel logic="v52" /></main>;
}
