import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (<main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only decision monitor</div><h1 className="gold-heading mt-2 text-3xl font-black">判定状況</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-white/75">V96 CryptoとV52 Stockの対象銘柄を、完成済み1時間足の公開市場データで読み取り表示します。ここでの表示は発火候補の監視であり、注文・取消・建玉変更は行いません。</p></header><DecisionStatusPanel /></main>);
}
