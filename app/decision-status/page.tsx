import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (<main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only LIVE decision monitor</div><h1 className="gold-heading mt-2 text-3xl font-black">V12 / PENGU V2・Short V20・Recovery V8 / V52 Top2 判定状況</h1><p className="mt-3 max-w-4xl text-sm leading-7 text-white/75">VPSで稼働中のV12 X1.00 ALL（H1×2の確定2時間足、Top2・最大2建玉）、PENGU Dual LS V2 / Short V20 / Recovery V8（確定H1）、V52 Aster-only Top2の発火候補→確定足→通常Long/Short→Recovery V8補助判定→建玉・容量→共有risk/Kill Switch→注文Window→約定照合を表示します。HPは読み取り専用で、実LIVE runnerのEntry/Exit・注文・決済を置き換えません。</p></header><DecisionStatusPanel /></main>);
}
