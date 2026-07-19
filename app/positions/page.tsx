"use client";

import { Activity, ShieldCheck } from "lucide-react";

import { AutoTradeHistoryPanel } from "@/components/features/autotrade/AutoTradeHistoryPanel";
import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";

export default function PositionsPage() {
  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.07)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.10),transparent_20%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_26%)]" />
      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-100/72"><ShieldCheck className="h-3.5 w-3.5" />Current dashboard</div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="gold-heading text-[1.7rem] font-black tracking-tight sm:text-[2rem] md:text-[2.8rem]">現行LIVE運用ダッシュボード</h1>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-white/82">AsterDEXのV35 Core＋PENGU V46だけを基準に、口座スナップショット、管理対象ポジション、注文安全状態を表示します。</p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-profit/25 bg-profit/10 px-4 py-2 text-[11px] text-profit"><Activity className="h-4 w-4" />V46 durable state同期</div>
          </div>
        </header>

        <LiveDecisionPanel />

        <section className="rounded-[22px] border border-gold-400/16 bg-white/[0.025] px-4 py-4 text-[11px] leading-6 text-white/70">
          <div className="font-bold text-gold-100">表示上の注意</div>
          <p className="mt-1">このページの現行残高・ポジション表示はV46 runnerのdurable stateを正とします。旧Web3運用ウォレット表示や旧combined runnerの判定は、現行LIVEロジックの状態として混在させません。</p>
        </section>

        <AutoTradeHistoryPanel />
      </div>
    </main>
  );
}

