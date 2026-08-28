import { Activity, ShieldCheck } from "lucide-react";

import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return <main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/75"><Activity className="h-4 w-4" />DECISION MONITOR / READ ONLY</div><h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">判定状況</h1><p className="mt-3 max-w-4xl text-sm leading-7 text-white/68">V12・PENGU Dual LS V2 / Short V20・V52 Top2を、実候補→実Gate→最終工程→発注・約定照合の段階で表示します。PENGUのLong/Shortは分離し、V52は株式市場として表示します。</p><div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-400/8 px-3 py-1.5 text-[11px] font-semibold text-emerald-100"><ShieldCheck className="h-3.5 w-3.5" />HPから注文・取消・決済は行いません</div></header><DecisionStatusPanel /></main>;
}
