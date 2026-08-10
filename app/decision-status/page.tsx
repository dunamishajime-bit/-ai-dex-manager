import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (
    <main className="space-y-4 p-4 md:p-6">
      <header className="panel-gold rounded-[28px] p-5 md:p-7">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only decision monitor</div>
        <h1 className="gold-heading mt-2 text-3xl font-black">判定状況</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/75">PENGU Dual LS V1とV52 Stockを分けて表示します。実ランナーの判定スナップショットが取得できない場合は、発火候補を推測せず取得不能として表示します。</p>
      </header>
      <DecisionStatusPanel />
    </main>
  );
}
