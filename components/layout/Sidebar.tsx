"use client";

import {
    Activity,
    BarChart3,
    Bell,
    Bot,
    BrainCircuit,
    Clock,
    Crosshair,
    Layers,
    LayoutDashboard,
    Menu,
    Newspaper,
    Play,
    Settings,
    Shield,
    Star,
    X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SystemCore } from "@/components/features/SystemCore";
import { RiskManagement } from "@/components/features/RiskManagement";
import { cn } from "@/lib/utils";

const navItems = [
    { icon: LayoutDashboard, label: "DIS TERMINAL", href: "/" },
    { icon: BrainCircuit, label: "AI評議会", href: "/ai-agents" },
    { icon: Clock, label: "評議会履歴", href: "/ai-agents/history" },
    { icon: Bot, label: "TraderBrain", href: "/trader-brain" },
    { icon: Newspaper, label: "ニュース", href: "/news" },
    { icon: Bell, label: "通知履歴", href: "/notifications" },
    { icon: Crosshair, label: "ポジション", href: "/positions" },
    { icon: Layers, label: "ストラテジー", href: "/strategy" },
    { icon: BarChart3, label: "パフォーマンス", href: "/performance" },
    { icon: Activity, label: "トレード履歴", href: "/history" },
    { icon: Star, label: "ウォッチリスト", href: "/watchlist" },
    { icon: Play, label: "DEMO設定", href: "/demo" },
    { icon: Settings, label: "設定", href: "/settings" },
];

export function Sidebar() {
    const pathname = usePathname();
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <>
            <button
                onClick={() => setMobileOpen(true)}
                className="fixed left-3 top-3 z-50 rounded-lg border border-gold-500/20 bg-cyber-darker/90 p-2 text-gold-400 md:hidden"
            >
                <Menu className="h-5 w-5" />
            </button>

            {mobileOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/60 md:hidden"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            <div
                className={cn(
                    "fixed z-50 flex h-screen w-56 shrink-0 flex-col border-r border-gold-500/10 bg-black/50 backdrop-blur-2xl shadow-[4px_0_30px_rgba(0,0,0,0.5)] transition-all duration-500 md:relative",
                    mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
                )}
            >
                <div className="pointer-events-none absolute left-0 top-0 h-32 w-full bg-gold-500/5 blur-[50px]" />

                <div className="relative flex items-center gap-2 border-b border-gold-500/10 px-3 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-gold-500 to-gold-600 text-xs font-bold text-black shadow-[0_0_15px_rgba(255,215,0,0.4)]">
                        Dis
                    </div>
                    <div>
                        <h2 className="bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-xs font-bold text-transparent">
                            DIS TERMINAL
                        </h2>
                        <p className="text-[8px] font-mono text-gold-500/50">AI TRADING v5.0</p>
                    </div>
                    <button
                        onClick={() => setMobileOpen(false)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white md:hidden"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2 scrollbar-thin scrollbar-thumb-gold-500/10">
                    {navItems.map((item, idx) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className={cn(
                                    "group relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-1.5 text-xs transition-all duration-200",
                                    isActive
                                        ? "border border-gold-500/20 bg-gold-500/10 text-gold-400 shadow-[0_0_15px_rgba(255,215,0,0.05)]"
                                        : "text-gray-500 hover:bg-gold-500/5 hover:text-gray-300",
                                )}
                                style={{ animationDelay: `${idx * 0.04}s` }}
                            >
                                {isActive && (
                                    <div className="absolute bottom-0 left-0 top-0 w-[2px] bg-gradient-to-b from-transparent via-gold-500 to-transparent" />
                                )}
                                <item.icon
                                    className={cn(
                                        "h-4 w-4 transition-colors",
                                        isActive ? "text-gold-500" : "text-gray-600 group-hover:text-gray-400",
                                    )}
                                />
                                <span className="truncate">{item.label}</span>
                                {isActive && (
                                    <div className="ml-auto h-1.5 w-1.5 rounded-full bg-gold-500 shadow-[0_0_5px_rgba(255,215,0,0.5)]" />
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className="border-t border-gold-500/10 py-1">
                    <RiskManagement />
                </div>

                <div className="border-t border-gold-500/10">
                    <SystemCore />
                </div>

                <div className="border-t border-gold-500/10 p-2">
                    <div className="flex items-center gap-2 text-[8px] font-mono text-gold-500/30">
                        <Shield className="h-2.5 w-2.5" />
                        <span>SECURED BY AI AGENTS</span>
                    </div>
                </div>
            </div>
        </>
    );
}
