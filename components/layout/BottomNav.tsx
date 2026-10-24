"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, CalendarDays, FileText, Home, Settings, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { BOTTOM_NAV_LAYOUT, BOTTOM_NAV_ROUTES } from "@/components/layout/bottom-nav-contract";

const NAV_ITEMS = [
  { icon: Home, ...BOTTOM_NAV_ROUTES[0] },
  { icon: BarChart3, ...BOTTOM_NAV_ROUTES[1] },
  { icon: Activity, ...BOTTOM_NAV_ROUTES[2] },
  { icon: BarChart3, ...BOTTOM_NAV_ROUTES[3] },
  { icon: Wallet, ...BOTTOM_NAV_ROUTES[4] },
  { icon: CalendarDays, ...BOTTOM_NAV_ROUTES[5] },
  { icon: FileText, ...BOTTOM_NAV_ROUTES[6] },
  { icon: Settings, ...BOTTOM_NAV_ROUTES[7] },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#7c6d38]/30 bg-[#06090f]/95 backdrop-blur-xl safe-area-bottom md:hidden">
      <div className={BOTTOM_NAV_LAYOUT.overflowClass}>
        <div className={`flex ${BOTTOM_NAV_LAYOUT.stripClass} items-stretch`}>
          {NAV_ITEMS.map((item) => (
            <BottomNavItem key={item.href} {...item} />
          ))}
        </div>
      </div>
    </nav>
  );
}

function BottomNavItem({ icon: Icon, label, href }: (typeof NAV_ITEMS)[number]) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      aria-label={href === "/realtime" ? "リアルタイム" : label}
      className={cn(
        `relative flex ${BOTTOM_NAV_LAYOUT.itemMinWidthClass} flex-none flex-col items-center justify-center gap-1 px-1 py-2 text-center transition-all duration-200`,
        isActive ? "text-[#f0df9c]" : "text-white/45 hover:text-white/72 active:text-[#f0df9c]",
      )}
    >
      {isActive ? <div className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full bg-[#d4b45a]" /> : null}
      <Icon className="h-5 w-5" />
      <span className="text-[9px] leading-none">{label}</span>
    </Link>
  );
}
