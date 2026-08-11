import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (
    <main className="space-y-4 p-4 md:p-6">
      <header className="panel-gold rounded-[28px] p-5 md:p-7">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">
          Read-only runtime decision monitor
        </div>
        <h1 className="gold-heading mt-2 text-3xl font-black">判定状況</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/75">
          V96 Crypto、PENGU_DUAL_LS_V2_FINAL、V52 StockがVPSへ保存した実Runner判定だけを読み取り表示します。
          スナップショットが欠損・古い場合やLIVEサービス停止中は、公開価格から発火候補を推測しません。
          この画面から注文・取消・建玉変更は行いません。
        </p>
      </header>
      <DecisionStatusPanel />
    </main>
  );
}
