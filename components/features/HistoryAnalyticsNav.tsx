"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FileText, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/history", label: "トレード履歴", icon: FileText, exact: true },
  { href: "/history/performance", label: "損益集計", icon: TrendingUp, exact: false },
  { href: "/history/v12", label: "V12", icon: BarChart3, exact: false },
  { href: "/history/pengu", label: "PENGU", icon: BarChart3, exact: false },
  { href: "/history/q102", label: "Q102", icon: BarChart3, exact: false },
  { href: "/history/fet", label: "FET", icon: BarChart3, exact: false },
  { href: "/history/v52", label: "V52", icon: BarChart3, exact: false },
] as const;

export function HistoryAnalyticsNav() {
  const pathname = usePathname();

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
              active
                ? "border-[#8f7a38] bg-[#6d551d]/35 text-[#f2dfa0]"
                : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white/85",
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
