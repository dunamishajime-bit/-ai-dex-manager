"use client";

import { Card } from "@/components/ui/Card";
import { useSimulation, Chain } from "@/context/SimulationContext";
import { Layers, Globe, Coins, CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ChainSettingsPage() {
    const {
        activeChains, toggleChain,
        targetTop100, setTargetTop100,
        targetAllCurrencies, setTargetAllCurrencies,
        targetMemeCoins, setTargetMemeCoins
    } = useSimulation();

    const chains: { id: Chain; name: string; color: string }[] = [
        { id: "BNB", name: "BNB Chain", color: "text-yellow-400" },
        { id: "POLYGON", name: "Polygon (MATIC)", color: "text-purple-400" },
    ];

    return (
        <div className="p-6 max-w-4xl mx-auto w-full space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-white mb-2">CHAIN & ASSET SETTINGS</h1>
                <p className="text-gray-400 font-mono">取引対象のブロックチェーンと資産クラスの設定</p>
            </div>

            {/* Active Chains */}
            <Card title="Active Chains (接続チェーン)" glow="secondary">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {chains.map((chain) => {
                        const isActive = activeChains.includes(chain.id);
                        return (
                            <div
                                key={chain.id}
                                onClick={() => toggleChain(chain.id)}
                                className={cn(
                                    "p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                                    isActive
                                        ? "bg-gold-500/10 border-gold-500 shadow-[0_0_10px_rgba(255,215,0,0.1)]"
                                        : "bg-black/30 border-white/5 hover:bg-white/5 hover:border-white/10"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn("p-2 rounded-lg bg-black/50", chain.color)}>
                                        <Layers className="w-6 h-6" />
                                    </div>
                                    <span className={cn("font-bold", isActive ? "text-white" : "text-gray-500")}>
                                        {chain.name}
                                    </span>
                                </div>
                                {isActive ? <CheckCircle2 className="w-6 h-6 text-gold-500" /> : <Circle className="w-6 h-6 text-gray-700" />}
                            </div>
                        );
                    })}
                </div>
            </Card>

            {/* Asset Scope Settings */}
            <Card title="Asset Scope Settings (取引対象設定)" glow="primary">
                <div className="space-y-6">
                    <p className="text-sm text-gray-400">AIが取引・分析の対象とする銘柄の範囲を設定します。</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div
                            onClick={() => {
                                setTargetAllCurrencies(true);
                                setTargetTop100(false);
                            }}
                            className={cn(
                                "p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                                targetAllCurrencies
                                    ? "bg-gold-500/10 border-gold-500 shadow-[0_0_10px_rgba(255,215,0,0.1)]"
                                    : "bg-black/30 border-white/5 hover:bg-white/5"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-black/50 text-gold-500">
                                    <Globe className="w-6 h-6" />
                                </div>
                                <div>
                                    <div className={cn("font-bold", targetAllCurrencies ? "text-white" : "text-gray-500")}>全ての通貨</div>
                                    <div className="text-[10px] text-gray-500">全銘柄を対象（推奨）</div>
                                </div>
                            </div>
                            {targetAllCurrencies ? <CheckCircle2 className="w-6 h-6 text-gold-500" /> : <Circle className="w-6 h-6 text-gray-700" />}
                        </div>

                        <div
                            onClick={() => {
                                setTargetAllCurrencies(false);
                                setTargetTop100(true);
                            }}
                            className={cn(
                                "p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                                targetTop100
                                    ? "bg-gold-500/10 border-gold-500 shadow-[0_0_10px_rgba(255,215,0,0.1)]"
                                    : "bg-black/30 border-white/5 hover:bg-white/5"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-black/50 text-blue-400">
                                    <Coins className="w-6 h-6" />
                                </div>
                                <div>
                                    <div className={cn("font-bold", targetTop100 ? "text-white" : "text-gray-500")}>トップ100</div>
                                    <div className="text-[10px] text-gray-500">時価総額上位100銘柄に限定</div>
                                </div>
                            </div>
                            {targetTop100 ? <CheckCircle2 className="w-6 h-6 text-gold-500" /> : <Circle className="w-6 h-6 text-gray-700" />}
                        </div>
                    </div>

                    <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                        <div>
                            <h4 className="font-bold text-white flex items-center gap-2">ミームコインを優先</h4>
                            <p className="text-xs text-gray-400 mt-1">pump.fun や低時価総額のボラティリティが高い銘柄を積極的に狙います。</p>
                        </div>
                        <div
                            onClick={() => setTargetMemeCoins(!targetMemeCoins)}
                            className={cn("w-12 h-6 rounded-full p-1 transition-colors flex items-center cursor-pointer", targetMemeCoins ? "bg-gold-500 justify-end" : "bg-gray-700 justify-start")}
                        >
                            <div className="w-4 h-4 rounded-full bg-black shadow-md" />
                        </div>
                    </div>
                </div>
            </Card>


        </div>
    );
}
