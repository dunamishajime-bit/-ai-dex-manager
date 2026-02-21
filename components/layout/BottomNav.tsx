"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BrainCircuit, Crosshair, Settings, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

const NAV_ITEMS = [
    { icon: LayoutDashboard, label: "ホーム", href: "/" },
    { icon: BrainCircuit, label: "AI評議会", href: "/ai-agents" },
    { icon: Crosshair, label: "ポジション", href: "/positions" },
    { icon: Star, label: "ウォッチ", href: "/watchlist" },
    { icon: Settings, label: "設定", href: "/settings" },
];

export function BottomNav() {
    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-t border-gold-500/15 safe-area-bottom">
            <div className="flex items-stretch">
                {NAV_ITEMS.map((item) => (
                    <BottomNavItem key={item.href} {...item} />
                ))}
            </div>
        </nav>
    );
}

function BottomNavItem({ icon: Icon, label, href }: typeof NAV_ITEMS[0]) {
    const pathname = usePathname();
    const isActive = pathname === href;

    return (
        <Link
            href={href}
            className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 text-center transition-all duration-200 relative",
                isActive
                    ? "text-gold-400"
                    : "text-gray-600 hover:text-gray-400 active:text-gold-400"
            )}
        >
            {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gold-400 rounded-full shadow-[0_0_6px_rgba(255,215,0,0.6)]" />
            )}
            <Icon className={cn("w-5 h-5", isActive && "drop-shadow-[0_0_4px_rgba(255,215,0,0.6)]")} />
            <span className={cn("text-[9px] font-mono leading-none", isActive ? "text-gold-400" : "text-gray-600")}>
                {label}
            </span>
        </Link>
    );
}
