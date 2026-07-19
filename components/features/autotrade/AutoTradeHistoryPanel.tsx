"use client";

import { History, ShieldCheck } from "lucide-react";

import { CurrentStrategyStatus } from "@/components/features/strategy/CurrentStrategyStatus";

export function AutoTradeHistoryPanel({ compact: _compact = false }: { compact?: boolean }) {
  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-white"><History className="h-4 w-4 text-gold-100" />V46実売買の状態履歴</div>
      <div className="mt-3 rounded-[18px] border border-gold-400/18 bg-black/20 px-4 py-3 text-[11px] leading-6 text-white/72">
        <div className="flex items-center gap-2 font-bold text-gold-100"><ShieldCheck className="h-4 w-4" />旧combined履歴APIとは分離</div>
        <p className="mt-1">現行V46はdurable state、pending照合、ポジション照合を基準に動作します。旧自動売買履歴をV46の約定履歴として混在表示しません。</p>
      </div>
      <div className="mt-3"><CurrentStrategyStatus /></div>
    </section>
  );
}

