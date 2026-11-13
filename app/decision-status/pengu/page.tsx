import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function PenguDecisionPage() {
  return <main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Decision monitor / PENGU</div><h1 className="gold-heading mt-2 text-3xl font-black">PENGU 判定状況</h1><p className="mt-3 text-sm leading-7 text-white/75">Long V2 Final、Short V20、Recovery V8の判定、cooldown、共有risk、建玉・保護状態を表示します。</p></header><DecisionStatusPanel logic="pengu" /></main>;
}
