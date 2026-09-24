import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function V12DecisionPage() {
  return <main className="min-w-0 space-y-4 overflow-x-hidden p-3 sm:p-4 md:p-6"><header className="panel-gold min-w-0 overflow-hidden rounded-[24px] p-4 sm:rounded-[28px] sm:p-5 md:p-7 [overflow-wrap:anywhere]"><div className="text-[10px] font-semibold uppercase tracking-[0.16em] sm:text-xs sm:tracking-[0.24em] text-gold-100/70">Decision monitor / V12</div><h1 className="gold-heading mt-2 text-2xl font-black sm:text-3xl">V12 判定状況</h1><p className="mt-3 text-sm leading-7 text-white/75">raw候補順位、実runner signalEligible、Entry Quality、共有risk、建玉・容量、発注・約定までを表示します。</p></header><DecisionStatusPanel logic="v12" /></main>;
}
