"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, FileText, Home, Settings, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { icon: Home, label: "ホーム", href: "/", matchPrefix: false },
  { icon: BarChart3, label: "ダッシュ", href: "/positions", matchPrefix: false },
  { icon: Activity, label: "AIラボ", href: "/research-lab", matchPrefix: true },
  { icon: Wallet, label: "ウォレット", href: "/wallets", matchPrefix: false },
  { icon: FileText, label: "履歴", href: "/history", matchPrefix: false },
  { icon: Settings, label: "設定", href: "/settings", matchPrefix: false },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#7c6d38]/30 bg-[#06090f]/95 backdrop-blur-xl safe-area-bottom md:hidden">
      <div className="flex items-stretch">
        {NAV_ITEMS.map((item) => (
          <BottomNavItem key={item.href} {...item} />
        ))}
      </div>
    </nav>
  );
}

function BottomNavItem({ icon: Icon, label, href, matchPrefix }: (typeof NAV_ITEMS)[number]) {
  const pathname = usePathname();
  const isActive = matchPrefix ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;

  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 py-2 text-center transition-all duration-200",
        isActive ? "text-[#f0df9c]" : "text-white/45 hover:text-white/72 active:text-[#f0df9c]",
      )}
    >
      {isActive ? <div className="absolute left-1/2 top-0 h-0.5 w-7 -translate-x-1/2 rounded-full bg-[#d4b45a]" /> : null}
      <Icon className="h-4 w-4" />
      <span className="truncate text-[8px] leading-none">{label}</span>
    </Link>
  );
}
