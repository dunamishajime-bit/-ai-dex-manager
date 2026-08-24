import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (<main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only LIVE decision monitor</div><h1 className="gold-heading mt-2 text-3xl font-black">V12 / PENGU V20 / V52 判定状況</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-white/75">VPSで稼働中のV12 X1.00 ALL Top2、PENGU Dual LS V2（Short V20）、V52 Aster-onlyの判定足・候補選定・停止理由を整理して表示します。HPは読み取り専用で、実LIVE runnerのEntry/Exit・注文・決済を置き換えません。</p></header><DecisionStatusPanel /></main>);
}
