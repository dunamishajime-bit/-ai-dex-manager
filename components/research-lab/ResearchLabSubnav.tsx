"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, MessagesSquare } from "lucide-react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/research-lab", label: "研究結果", icon: BarChart3, exact: true },
  { href: "/research-lab/discussions", label: "議論内容", icon: MessagesSquare, exact: false },
] as const;

export default function ResearchLabSubnav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-2 rounded-[18px] border border-white/8 bg-black/25 p-2">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-colors",
              active
                ? "border-gold-400/30 bg-gold-400/12 text-gold-50"
                : "border-transparent text-white/55 hover:border-white/10 hover:bg-white/[0.035] hover:text-white",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
