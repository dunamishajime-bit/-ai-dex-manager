"use client";

import {
    Activity, LayoutDashboard, Settings, ShieldAlert, Layers, BrainCircuit,
    Crosshair, BarChart3, Star, Bell, Globe, Shield, Menu, X, Newspaper, Clock, Bot, Play
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { SystemCore } from "@/components/features/SystemCore";
import { RiskManagement } from "@/components/features/RiskManagement";

const navItems = [
    { icon: LayoutDashboard, label: "DIS TERMINAL", href: "/" },
    { icon: BrainCircuit, label: "AI評議会", href: "/ai-agents" },
    { icon: Clock, label: "評議会履歴", href: "/ai-agents/history" },
    { icon: Bot, label: "TraderChat", href: "/trader-chat" },
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
            {/* Mobile hamburger */}
            <button
                onClick={() => setMobileOpen(true)}
                className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-cyber-darker/90 border border-gold-500/20 text-gold-400"
            >
                <Menu className="w-5 h-5" />
            </button>

            {/* Mobile overlay */}
            {mobileOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/60 z-40"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* Sidebar */}
            <div className={cn(
                "h-screen flex flex-col border-r border-gold-500/10 bg-black/50 backdrop-blur-2xl transition-all duration-500 z-50 shadow-[4px_0_30px_rgba(0,0,0,0.5)]",
                "w-56 shrink-0",
                "fixed md:relative",
                mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0 shadow-none md:shadow-[4px_0_30px_rgba(0,0,0,0.5)]"
            )}>
                {/* Ambient glow behind logo */}
                <div className="absolute top-0 left-0 w-full h-32 bg-gold-500/5 blur-[50px] pointer-events-none" />

                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-3 border-b border-gold-500/10 relative">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center text-black font-bold text-xs shadow-[0_0_15px_rgba(255,215,0,0.4)]">
                        Dis
                    </div>
                    <div>
                        <h2 className="text-xs font-bold bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-transparent">
                            DIS TERMINAL
                        </h2>
                        <p className="text-[8px] text-gold-500/50 font-mono">AI TRADING v5.0</p>
                    </div>

                    {/* Mobile close */}
                    <button
                        onClick={() => setMobileOpen(false)}
                        className="md:hidden absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Nav */}
                <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 scrollbar-thin scrollbar-thumb-gold-500/10">
                    {navItems.map((item, idx) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs transition-all duration-200 group relative overflow-hidden stagger-item btn-micro",
                                    isActive
                                        ? "bg-gold-500/10 text-gold-400 border border-gold-500/20 shadow-[0_0_15px_rgba(255,215,0,0.05)] neon-border-anim"
                                        : "text-gray-500 hover:text-gray-300 hover:bg-gold-500/5"
                                )}
                                style={{ animationDelay: `${idx * 0.04}s` }}
                            >
                                {isActive && (
                                    <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-gold-500 to-transparent" />
                                )}
                                <item.icon className={cn(
                                    "w-4 h-4 transition-colors",
                                    isActive ? "text-gold-500" : "text-gray-600 group-hover:text-gray-400"
                                )} />
                                <span className="truncate">{item.label}</span>
                                {isActive && (
                                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-gold-500 shadow-[0_0_5px_rgba(255,215,0,0.5)]" />
                                )}
                            </Link>
                        );
                    })}
                </nav>

                {/* Risk Management Section */}
                <div className="border-t border-gold-500/10 py-1">
                    <RiskManagement />
                </div>

                {/* System Core Integration (Miniaturized) */}
                <div className="border-t border-gold-500/10">
                    <SystemCore />
                </div>

                {/* Footer */}
                <div className="border-t border-gold-500/10 p-2">
                    <div className="flex items-center gap-2 text-[8px] font-mono text-gold-500/30">
                        <Shield className="w-2.5 h-2.5" />
                        <span>SECURED BY AI AGENTS</span>
                    </div>
                </div>
            </div>
        </>
    );
}
