import { FetDecisionPanel } from "@/components/features/FetDecisionPanel";
import { LivePerformanceDashboard } from "@/components/features/LivePerformanceDashboard";

export default function FetDecisionPage() {
  return (
    <main className="min-w-0 space-y-5 overflow-x-hidden p-3 sm:p-4 md:p-6">
      <header className="panel-gold min-w-0 overflow-hidden rounded-[24px] p-4 sm:rounded-[28px] sm:p-5 md:p-7">
        <div className="break-words text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-100/70 sm:text-xs sm:tracking-[0.24em] [overflow-wrap:anywhere]">
          Read-only LIVE decision monitor / FET
        </div>
        <h1 className="gold-heading mt-2 break-words text-2xl font-black sm:text-3xl [overflow-wrap:anywhere]">
          FET BRK48 LONG 判定・損益・稼働状況
        </h1>
        <p className="mt-3 max-w-4xl break-words text-sm leading-6 text-white/75 sm:leading-7 [overflow-wrap:anywhere]">
          本番FET runner state、Aster公開1時間足のBRK48判定、建玉・保護STOP、Gross、実約定ベースの累積損益・月次損益・勝率を同じページで確認できます。
          判定表示は読み取り専用で、発注・取消・建玉変更は行いません。
        </p>
      </header>

      <FetDecisionPanel />

      <section className="panel-gold min-w-0 overflow-hidden rounded-[28px] p-4 md:p-5">
        <LivePerformanceDashboard logic="FET" title="FET BRK48 LONG 実績・損益" />
      </section>
    </main>
  );
}
