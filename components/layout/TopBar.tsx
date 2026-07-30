"use client";

import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { SITE_BRAND_NAME } from "@/lib/site-access";

const PAGE_TITLES: Record<string, string> = {
  "/": "ホーム",
  "/positions": "LIVE状況",
  "/wallets": "ウォレット",
  "/performance": "成績・AI分析",
  "/settings": "設定",
  "/admin": "管理",
  "/history": "トレード履歴",
};

export function TopBar() {
  const pathname = usePathname();
  const { currency } = useCurrency();
  const title = PAGE_TITLES[pathname || "/"] || SITE_BRAND_NAME;

  return (
    <header className="sticky top-0 z-30 border-b border-white/6 bg-[linear-gradient(180deg,rgba(5,8,12,0.94),rgba(4,6,10,0.82))] px-3 py-3 backdrop-blur-2xl md:px-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/70">
            <ShieldAlert className="h-3.5 w-3.5 text-gold-100" />
            {title}
          </div>
          <h1 className="mt-0.5 truncate text-lg font-black tracking-tight text-white md:text-xl">{SITE_BRAND_NAME}</h1>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-semibold text-white/70">
          <span className="hidden rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 md:inline">通貨: {currency}</span>
          <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-amber-100">LIVE: 未確認</span>
        </div>
      </div>
    </header>
  );
}
