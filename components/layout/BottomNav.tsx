"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BrainCircuit, Crosshair, Settings, Star } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
    { icon: LayoutDashboard, label: "ホーム", href: "/" },
    { icon: BrainCircuit, label: "AI評議会", href: "/ai-agents" },
    { icon: Crosshair, label: "ポジション", href: "/positions" },
    { icon: Star, label: "ウォッチ", href: "/watchlist" },
    { icon: Settings, label: "設定", href: "/settings" },
];

export function BottomNav() {
    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gold-500/15 bg-black/90 backdrop-blur-xl safe-area-bottom md:hidden">
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
                "relative flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-center transition-all duration-200",
                isActive ? "text-gold-400" : "text-gray-600 hover:text-gray-400 active:text-gold-400"
            )}
        >
            {isActive ? (
                <div className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-gold-400 shadow-[0_0_6px_rgba(255,215,0,0.6)]" />
            ) : null}
            <Icon className={cn("h-5 w-5", isActive && "drop-shadow-[0_0_4px_rgba(255,215,0,0.6)]")} />
            <span className={cn("text-[9px] font-mono leading-none", isActive ? "text-gold-400" : "text-gray-600")}>
                {label}
            </span>
        </Link>
    );
}
