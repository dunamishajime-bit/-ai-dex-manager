import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";
import { LivePerformanceDashboard } from "@/components/features/LivePerformanceDashboard";

/** Same 30-second runner snapshot as the five-logic overview. This page cannot submit orders. */
export default function FetDecisionPage() {
  return (
    <main className="min-w-0 space-y-5 overflow-x-hidden p-3 sm:p-4 md:p-6">
      <header className="panel-gold min-w-0 rounded-[28px] p-4 md:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-100/70">Production / FET BRK48</div>
        <h1 className="gold-heading mt-2 text-2xl font-black md:text-3xl">FET 稼働・判定・実績</h1>
        <p className="mt-3 break-words text-sm text-white/70">本番FETのstate・稼働SHAを現在のProduction SHAと照合し、約定履歴に基づく損益を表示します。未取得情報は推測せず表示しません。</p>
      </header>
      <DecisionStatusPanel logic="fet" />
      <div className="min-w-0 overflow-x-auto rounded-[28px] border border-white/10 bg-black/20 p-3">
        <LivePerformanceDashboard logic="FET" title="FET 実約定損益・月次履歴" />
      </div>
    </main>
  );
}
