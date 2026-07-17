import { MessageSquareText, ShieldCheck } from "lucide-react";

import DiscussionLogViewer from "@/components/research-lab/DiscussionLogViewer";
import ResearchLabSubnav from "@/components/research-lab/ResearchLabSubnav";

export default function ResearchDiscussionPage() {
  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.09),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(253,224,71,0.08),transparent_30%)]" />
      <div className="relative z-10 space-y-4 p-3 md:p-5">
        <section className="rounded-[26px] border border-gold-400/18 bg-[linear-gradient(180deg,rgba(17,18,20,0.92),rgba(6,8,12,0.96))] p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/75">
                <MessageSquareText className="h-4 w-4" />
                AI Research Debate Archive
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">議論内容</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/68">
                既定表示は現行メインWIN80_ULTRA90_TOP1_V1を直接扱う研究会議です。Score80/90、Confidence、Trigger、RR、Volume、Top-1、50%分割、70%Rotationについて、提案・反論・CIO判断を保存します。
                旧deep-c* Champion会議は削除せず、アーカイブ切替時だけ表示します。
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-sky-500/10 px-4 py-2 text-xs font-bold text-sky-100">
              <ShieldCheck className="h-4 w-4" />
              Current Main First
            </div>
          </div>
        </section>

        <ResearchLabSubnav />
        <DiscussionLogViewer />
      </div>
    </main>
  );
}
