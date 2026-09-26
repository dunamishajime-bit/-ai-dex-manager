import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return <main className="space-y-4 p-4 md:p-6">
    <header className="panel-gold rounded-[28px] p-5 md:p-7">
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only LIVE decision monitor</div>
      <h1 className="gold-heading mt-2 text-3xl font-black">判定状況</h1>
      <p className="mt-3 max-w-4xl text-sm leading-7 text-white/75">V12 / PENGU / FET / Q102 / V52 をロジック別に表示します。各カードと実runnerサマリーから判定・Gate・建玉状態を確認できます。</p>
    </header>
    <DecisionStatusPanel logic="overview" />
  </main>;
}
