import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (<main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">読み取り専用モニター</div><h1 className="gold-heading mt-2 text-3xl font-black">判定状況</h1><p className="mt-3 max-w-4xl text-sm leading-7 text-white/75">V12・PENGU・FET・V52・Quality102の候補、判定Gate、建玉、注文状態をVPSの実データから表示します。HPから売買操作は行いません。</p><div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-100/85">Quality102 Causal V4は1枠の補完ロジック、FETはBRK48残余枠ロジックです。未証明の経路は安全側で停止します。上限：Q102 0.50x / Crypto 2.00x / Total 2.50x。</div></header><DecisionStatusPanel /></main>);
}
