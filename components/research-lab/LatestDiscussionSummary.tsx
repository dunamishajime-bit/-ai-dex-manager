"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Gavel, MessageSquareText, RefreshCw } from "lucide-react";

import type { ResearchDashboardPayload } from "@/lib/research-lab/dashboard-types";

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function LatestDiscussionSummary() {
  const [payload, setPayload] = useState<ResearchDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/research-lab/latest", { cache: "no-store" });
      if (!response.ok) return;
      setPayload(await response.json() as ResearchDashboardPayload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const discussion = payload?.latestDiscussion;
  return (
    <section className="rounded-[24px] border border-violet-400/18 bg-[linear-gradient(180deg,rgba(35,22,55,0.42),rgba(7,8,13,0.88))] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-violet-300/15 bg-violet-500/10 p-2.5 text-violet-100">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-100/55">Latest Research Debate</div>
            <h2 className="mt-1 text-lg font-black text-white">最新の議論要約</h2>
          </div>
        </div>
        <a
          href="/research-lab/discussions"
          className="inline-flex items-center gap-2 rounded-xl border border-violet-300/15 bg-violet-500/10 px-4 py-2 text-xs font-bold text-violet-50 hover:bg-violet-500/15"
        >
          議論全文を開く <ArrowRight className="h-4 w-4" />
        </a>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/8 bg-black/20 px-4 py-5 text-xs text-white/45">
          <RefreshCw className="h-4 w-4 animate-spin" /> 議論要約を読み込んでいます
        </div>
      ) : discussion ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_0.72fr]">
          <div className="rounded-[18px] border border-white/8 bg-black/20 p-4">
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/45">
              <span>Cycle {discussion.cycle}</span>
              <span>•</span>
              <span>{formatDateTime(discussion.completedAt)} JST</span>
              <span>•</span>
              <span>{discussion.messageCount}発言</span>
            </div>
            <p className="mt-3 text-sm leading-7 text-white/76">{discussion.summary}</p>
            {discussion.topStrategyIds.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {discussion.topStrategyIds.map((id) => <span key={id} className="rounded-md border border-white/8 bg-white/[0.025] px-2 py-1 font-mono text-[10px] text-white/50">{id}</span>)}
              </div>
            ) : null}
          </div>
          <div className="rounded-[18px] border border-emerald-400/14 bg-emerald-500/[0.055] p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-100/55">
              <Gavel className="h-4 w-4" /> CIO判断
            </div>
            <p className="mt-3 text-sm leading-7 text-emerald-50/76">{discussion.decision}</p>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/15 px-4 py-5 text-xs leading-6 text-white/45">
          議論ログはまだありません。更新後の最初の自動研究Cycleが完了すると、ここに要約とCIO判断が表示されます。
        </div>
      )}
    </section>
  );
}
