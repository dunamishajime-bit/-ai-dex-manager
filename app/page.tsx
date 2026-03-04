"use client";

import Link from "next/link";
import { ArrowRight, BrainCircuit, CandlestickChart, LayoutDashboard, Newspaper, Settings, Trophy } from "lucide-react";

const quickLinks = [
    {
        href: "/trader-brain",
        title: "TraderBrain",
        description: "Review trades, entry logic, and exit outcomes.",
        icon: BrainCircuit,
    },
    {
        href: "/ai-agents",
        title: "AI Council",
        description: "Open the agent workflow and decision panels.",
        icon: Trophy,
    },
    {
        href: "/strategy",
        title: "Strategy",
        description: "Inspect proposals and active trading settings.",
        icon: CandlestickChart,
    },
    {
        href: "/news",
        title: "News",
        description: "Check the latest market and ecosystem headlines.",
        icon: Newspaper,
    },
    {
        href: "/positions",
        title: "Positions",
        description: "See open positions and current portfolio state.",
        icon: LayoutDashboard,
    },
    {
        href: "/settings",
        title: "Settings",
        description: "Adjust account, demo, and application options.",
        icon: Settings,
    },
];

export default function Home() {
    return (
        <main className="relative flex min-h-full flex-1 flex-col overflow-hidden bg-cyber-black">
            <div className="pointer-events-none absolute inset-0 bg-grid-pattern bg-[size:40px_40px] opacity-[0.03]" />

            <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 p-4 md:p-6">
                <section className="rounded-2xl border border-gold-500/15 bg-[#0d1117]/90 p-6 shadow-2xl shadow-black/40">
                    <div className="max-w-2xl">
                        <div className="text-[10px] font-mono uppercase tracking-[0.35em] text-gold-400/80">
                            DIS TERMINAL
                        </div>
                        <h1 className="mt-3 text-3xl font-black uppercase tracking-tight text-white md:text-5xl">
                            Operations Hub
                        </h1>
                        <p className="mt-4 text-sm leading-7 text-gray-400 md:text-base">
                            The homepage has been switched to a stable shell so the application stays usable while the larger dashboard widgets are being isolated.
                        </p>
                    </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {quickLinks.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="group rounded-2xl border border-gold-500/10 bg-[#0b0f15] p-5 transition-all duration-200 hover:border-gold-500/30 hover:bg-[#111722]"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="rounded-xl border border-gold-500/20 bg-gold-500/10 p-3">
                                    <link.icon className="h-5 w-5 text-gold-400" />
                                </div>
                                <ArrowRight className="h-5 w-5 text-gray-600 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-gold-400" />
                            </div>
                            <h2 className="mt-5 text-lg font-bold text-white">{link.title}</h2>
                            <p className="mt-2 text-sm leading-6 text-gray-400">{link.description}</p>
                        </Link>
                    ))}
                </section>
            </div>
        </main>
    );
}
