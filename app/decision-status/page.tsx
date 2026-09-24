import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return <main className="min-w-0 space-y-4 overflow-x-hidden p-3 sm:p-4 md:p-6">
    <header className="panel-gold min-w-0 overflow-hidden rounded-[24px] p-4 sm:rounded-[28px] sm:p-5 md:p-7 [overflow-wrap:anywhere]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] sm:text-xs sm:tracking-[0.24em] text-gold-100/70">Read-only LIVE decision monitor</div>
      <h1 className="gold-heading mt-2 text-2xl font-black sm:text-3xl">判定状況</h1>
      <p className="mt-3 max-w-4xl text-sm leading-7 text-white/75">V12 / PENGU / Q102 / FET / V52 をロジック別ページに分けました。各カードから実runnerの判定・Gate・建玉状態を確認できます。</p>
    </header>
    <DecisionStatusPanel logic="overview" />
  </main>;
}
