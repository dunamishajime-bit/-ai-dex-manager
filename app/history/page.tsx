"use client";

import Link from "next/link";
import { FileText, ShieldCheck } from "lucide-react";

import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";

export default function HistoryPage() {
  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-100/72"><FileText className="h-3.5 w-3.5" />Execution history</div>
          <h1 className="gold-heading mt-2 text-[1.8rem] font-black tracking-tight md:text-[2.6rem]">現行ロジックの状態・履歴</h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-white/82">V35 Core＋PENGU V46のdurable stateと最新の安全状態を表示します。旧combined／旧Web3の履歴を現行V46の約定履歴として表示しないように分離しています。</p>
        </header>

        <LiveDecisionPanel />

        <section className="rounded-[22px] border border-white/10 bg-white/[0.025] p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck className="h-4 w-4 text-gold-100" />過去履歴の扱い</div>
          <p className="mt-2 text-[12px] leading-6 text-white/72">旧runnerや旧チェーン取引の履歴は保存データとして残る場合がありますが、現在のAsterDEX V46注文とは別物です。現在の管理対象ポジション・残高・安全状態はダッシュボードで確認してください。</p>
          <Link href="/positions" className="mt-3 inline-flex rounded-full border border-gold-400/30 bg-gold-400/10 px-4 py-2 text-[11px] font-bold text-gold-100 hover:bg-gold-400/20">ダッシュボードで現行状態を見る</Link>
        </section>
      </div>
    </main>
  );
}

