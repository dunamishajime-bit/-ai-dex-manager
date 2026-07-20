"use client";

import { ShieldCheck } from "lucide-react";

export function ManualTradeRunPanel() {
  return (
    <section className="rounded-[22px] border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck className="h-4 w-4 text-gold-100" />旧手動実行導線</div>
      <p className="mt-2 text-[12px] leading-6 text-white/70">旧combined runnerへ直接注文する手動ボタンは現行画面から外しています。V46はsystemd runnerのLIVE二重ゲート、口座ロック、pending照合を経由します。</p>
    </section>
  );
}

