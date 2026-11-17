"use client";

import { Activity, ChevronDown } from "lucide-react";
import { CurrentLogicPanel } from "@/components/features/CurrentLogicPanel";

function BannerContent() {
  return (
    <div className="mx-auto w-full max-w-[1600px] min-w-0">
      <CurrentLogicPanel />
    </div>
  );
}

// Keep the existing production header/mobile-collapse layout. The content is
// now sourced from the actual runner pin manifest and systemd, not the old
// shared /current release configuration.
export function LiveProductionBanner({ compact = false }: { compact?: boolean } = {}) {
  return (
    <>
      <details className={"group shrink-0 border-b border-emerald-400/15 bg-[linear-gradient(90deg,rgba(6,30,27,0.96),rgba(7,13,21,0.96))] " + (compact ? "" : "md:hidden")}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[11px] text-white/80 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2 font-bold text-emerald-200">
            <Activity className="h-3.5 w-3.5" />
            運用ロジック情報
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-white/55">
            詳細
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
          </span>
        </summary>
        <div className="border-t border-emerald-400/10 px-4 pb-3 pt-2">
          <BannerContent />
        </div>
      </details>

      <section className={"hidden shrink-0 border-b border-emerald-400/15 bg-[linear-gradient(90deg,rgba(6,30,27,0.96),rgba(7,13,21,0.96))] px-3 py-2 md:px-6 " + (compact ? "" : "md:block")}>
        <BannerContent />
      </section>
    </>
  );
}
