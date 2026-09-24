import { FetDecisionPanel } from "@/components/features/FetDecisionPanel";

export default function FetDecisionPage() {
  return (
    <main className="space-y-4 p-4 md:p-6">
      <header className="panel-gold rounded-[28px] p-5 md:p-7">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only LIVE decision monitor / FET</div>
        <h1 className="gold-heading mt-2 text-3xl font-black">FET BRK48 判定・稼働状況</h1>
        <p className="mt-3 text-sm leading-7 text-white/75">
          本番FET runner stateから、稼働確認・建玉・保護STOP記録・pending・Grossを表示します。
          現在のシグナル詳細はrunner stateに保存されていない場合、推測せず未取得と表示します。
        </p>
      </header>
      <FetDecisionPanel />
    </main>
  );
}
