import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (<main className="space-y-4 p-4 md:p-6"><header className="panel-gold min-w-0 rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">判定状況（読み取り専用）</div><h1 className="gold-heading mt-2 break-words text-2xl font-black sm:text-3xl">V12 / PENGU / V52 / Quality102 判定状況</h1><p className="mt-3 max-w-4xl break-words text-sm leading-7 text-white/75">VPSの最新runnerデータをもとに、候補・判定・建玉・注文Gateの状態を表示します。HPから注文や決済は行いません。</p><div className="mt-4 break-words rounded-2xl border border-amber-400/25 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-100/85">Quality102 Causal V4：1 slot / 最大1.00x。Crypto 2.00x、Total 2.50x。V12・PENGU・V52を優先し、条件未確認時は発注しません。</div></header><DecisionStatusPanel /></main>);
}
