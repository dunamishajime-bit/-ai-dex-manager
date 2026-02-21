"use client";

import { useSimulation } from "@/context/SimulationContext";
import { Play, Zap, ShieldAlert, Shield, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function DemoSettingsPage() {
    const { startFixedDemo, demoStrategy, setDemoStrategy, initialTradeSymbol, setInitialTradeSymbol, isDemoMode } = useSimulation();
    const router = useRouter();

    const handleStartDemo = () => {
        startFixedDemo(initialTradeSymbol);
        router.push("/");
    };

    return (
        <div className="flex-1 p-4 md:p-8 overflow-y-auto w-full max-w-7xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/">
                    <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-400" />
                    </button>
                </Link>
                <h1 className="text-2xl font-black text-white italic tracking-wider">DEMO SETTINGS</h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column - Instructions & Status */}
                <div className="space-y-6">
                    <div className="glass-panel border-gold-500/30 p-6 rounded-3xl relative overflow-hidden">
                        <div className="absolute -top-10 -right-10 w-40 h-40 bg-gold-500/10 rounded-full blur-3xl pointer-events-none" />
                        <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                            <Play className="w-5 h-5 text-gold-400 fill-gold-400" />
                            AI Demo Trading
                        </h2>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            DEMO環境では、実際の資金をリスクにさらすことなく、AIエージェントの自動取引パフォーマンスを体験できます。
                            市場のリアルタイムデータに基づき、選択した初期資産とリスクプロファイルに応じてAIが自律的にトレードを実施します。
                        </p>

                        <div className="mt-6 p-4 rounded-xl bg-black/40 border border-white/10">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Current Status</h3>
                            <div className="flex items-center gap-3">
                                <div className={cn("w-3 h-3 rounded-full", isDemoMode ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-gray-600")} />
                                <span className={cn("font-mono font-bold", isDemoMode ? "text-emerald-400" : "text-gray-500")}>
                                    {isDemoMode ? "ACTIVE (Running)" : "INACTIVE (Stopped)"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column - Configuration */}
                <div className="space-y-6">
                    <div className="glass-panel p-6 rounded-3xl border-white/5">
                        {/* Initial Asset Selection */}
                        <div className="mb-8">
                            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-gold-500/20 text-gold-400 flex items-center justify-center text-xs font-black">1</span>
                                初期資産の選択
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {[
                                    { symbol: "BNB", amount: "5.00", label: "Binance Native" },
                                    { symbol: "USDT", amount: "100.00", label: "Stable Starter" },
                                    { symbol: "USD1", amount: "300.00", label: "Yield Farmer" },
                                ].map((asset) => (
                                    <button
                                        key={asset.symbol}
                                        type="button"
                                        onClick={() => setInitialTradeSymbol(asset.symbol)}
                                        className={cn(
                                            "flex flex-col p-4 rounded-2xl border transition-all text-left",
                                            initialTradeSymbol === asset.symbol
                                                ? "bg-gold-500/20 border-gold-500 text-gold-400 shadow-[0_0_15px_rgba(255,215,0,0.15)]"
                                                : "bg-white/5 border-white/10 text-gray-500 hover:bg-white/10"
                                        )}
                                    >
                                        <div className="text-[10px] font-black uppercase opacity-60 mb-1">{asset.label}</div>
                                        <div className="flex items-end justify-between w-full">
                                            <div className="text-xl font-bold text-white">{asset.symbol}</div>
                                            <div className="text-sm font-mono font-bold">{asset.amount}</div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Strategy Selection */}
                        <div className="mb-8">
                            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-gold-500/20 text-gold-400 flex items-center justify-center text-xs font-black">2</span>
                                トレード戦略
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {[
                                    { id: "AGGRESSIVE", label: "アグレッシブ", icon: Zap, color: "text-amber-400", desc: "高頻度・5分間隔" },
                                    { id: "MODERATE", label: "モデレート", icon: ShieldAlert, color: "text-gold-400", desc: "標準・15分間隔" },
                                    { id: "CONSERVATIVE", label: "コンサバティブ", icon: Shield, color: "text-emerald-400", desc: "慎重・30分間隔" },
                                ].map((s) => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => setDemoStrategy(s.id as any)}
                                        className={cn(
                                            "flex flex-col items-center text-center p-4 rounded-2xl border transition-all cursor-pointer h-full justify-center",
                                            demoStrategy === s.id
                                                ? "bg-gold-500/20 border-gold-500 text-gold-400 shadow-[0_0_15px_rgba(255,215,0,0.2)]"
                                                : "bg-white/5 border-white/10 text-gray-500 hover:bg-white/10"
                                        )}
                                    >
                                        <s.icon className={cn("w-6 h-6 mb-2", demoStrategy === s.id ? s.color : "text-gray-600")} />
                                        <span className="text-xs font-bold text-white">{s.label}</span>
                                        <span className="text-[10px] mt-1 opacity-60">{s.desc}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="pt-4 border-t border-white/10">
                            <button
                                onClick={handleStartDemo}
                                className="w-full py-4 px-6 rounded-2xl bg-gold-500 text-black text-sm font-black shadow-[0_10px_20px_rgba(255,215,0,0.2)] hover:shadow-[0_15px_30px_rgba(255,215,0,0.3)] hover:-translate-y-0.5 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                            >
                                <Play className="w-4 h-4 fill-black" />
                                {isDemoMode ? "RESTART DEMO" : "START DEMO TRADE"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
