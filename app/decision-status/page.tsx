import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (<main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only decision monitor</div><h1 className="gold-heading mt-2 text-3xl font-black">V12 / V52 判定状況</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-white/75">V12 X1.00 ALLとV52 Stockの対象銘柄を、完成済み公開市場データで読み取り表示します。これは参考判定であり、実LIVE runnerのEntry/Exitや注文を置き換えません。</p></header><DecisionStatusPanel /></main>);
}
