"use client";

import { useState, useEffect } from "react";
import { useSimulation, TradingPipeline } from "@/context/SimulationContext";
import { getRecommendedDEXs } from "@/lib/dex-service";
import { Card } from "@/components/ui/Card";
import { Plus, Trash2, Power, Settings2, Check, ExternalLink, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function TradingPipelineManager() {
    const { tradingPipelines, addPipeline, removePipeline, togglePipeline } = useSimulation();
    const [isAdding, setIsAdding] = useState(false);

    // Form state
    const [baseToken, setBaseToken] = useState("");
    const [targetToken, setTargetToken] = useState("USDT");
    const [selectedDEXs, setSelectedDEXs] = useState<string[]>([]);
    const [recommendedDEXs, setRecommendedDEXs] = useState<string[]>([]);

    // Update recommendations when base token changes
    useEffect(() => {
        if (baseToken.length >= 2) {
            const dexs = getRecommendedDEXs(baseToken);
            setRecommendedDEXs(dexs);
            // Auto-select top recommendation if none selected
            if (selectedDEXs.length === 0) {
                setSelectedDEXs([dexs[0]]);
            }
        } else {
            setRecommendedDEXs([]);
        }
    }, [baseToken]);

    const handleAdd = () => {
        if (!baseToken || !targetToken || selectedDEXs.length === 0) return;
        addPipeline(baseToken, targetToken, selectedDEXs);
        setBaseToken("");
        setSelectedDEXs([]);
        setIsAdding(false);
    };

    const toggleDEX = (dex: string) => {
        setSelectedDEXs(prev =>
            prev.includes(dex)
                ? prev.filter(d => d !== dex)
                : prev.length < 5 ? [...prev, dex] : prev
        );
    };

    return (
        <Card title="トレード・パイプライン管理" glow="secondary" className="h-full border-gold-500/30">
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <p className="text-xs text-gray-500">
                        AIが取引を許可された通貨ペアとDEXのリストです。
                    </p>
                    <button
                        onClick={() => setIsAdding(!isAdding)}
                        className="p-1.5 bg-gold-500/10 text-gold-400 border border-gold-500/30 rounded-lg hover:bg-gold-500/20 transition-all"
                    >
                        {isAdding ? <Settings2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </button>
                </div>

                {/* Add Form */}
                {isAdding && (
                    <div className="p-4 bg-white/5 border border-gold-500/20 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] text-gray-400 font-bold uppercase mb-1 block">基軸通貨 (Base)</label>
                                <input
                                    value={baseToken}
                                    onChange={(e) => setBaseToken(e.target.value.toUpperCase())}
                                    placeholder="e.g. ASTR"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white focus:border-gold-500/50 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] text-gray-400 font-bold uppercase mb-1 block">対象通貨 (Target)</label>
                                <input
                                    value={targetToken}
                                    onChange={(e) => setTargetToken(e.target.value.toUpperCase())}
                                    placeholder="USDT"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white focus:border-gold-500/50 outline-none"
                                />
                            </div>
                        </div>

                        {recommendedDEXs.length > 0 && (
                            <div className="space-y-2">
                                <label className="text-[10px] text-gray-400 font-bold uppercase block">利用DEX選択 (推奨)</label>
                                <div className="flex flex-wrap gap-2">
                                    {recommendedDEXs.map(dex => (
                                        <button
                                            key={dex}
                                            onClick={() => toggleDEX(dex)}
                                            className={cn(
                                                "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5",
                                                selectedDEXs.includes(dex)
                                                    ? "bg-gold-500 text-black border-gold-500 shadow-[0_0_10px_rgba(255,215,0,0.3)]"
                                                    : "bg-white/5 text-gray-400 border-white/10 hover:border-gold-500/30"
                                            )}
                                        >
                                            {selectedDEXs.includes(dex) && <Check className="w-3 h-3" />}
                                            {dex}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleAdd}
                            disabled={!baseToken || selectedDEXs.length === 0}
                            className="w-full py-2 bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-black font-black rounded-lg transition-all text-sm shadow-lg shadow-gold-500/20"
                        >
                            パイプラインを承認
                        </button>
                    </div>
                )}

                {/* Pipeline List */}
                <div className="space-y-3">
                    {tradingPipelines.length === 0 ? (
                        <div className="py-8 text-center border-2 border-dashed border-white/5 rounded-2xl">
                            <p className="text-gray-600 text-xs italic">登録されたパイプラインはありません</p>
                        </div>
                    ) : (
                        tradingPipelines.map(pipeline => (
                            <div
                                key={pipeline.id}
                                className={cn(
                                    "p-3 rounded-xl border flex items-center justify-between transition-all",
                                    pipeline.isActive ? "bg-gold-500/5 border-gold-500/20" : "bg-black/20 border-white/5 opacity-60"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "p-2 rounded-lg",
                                        pipeline.isActive ? "bg-gold-500/20 text-gold-400" : "bg-white/5 text-gray-600"
                                    )}>
                                        <Zap className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-black text-white">{pipeline.baseToken}</h4>
                                            <span className="text-xs text-gray-600">/</span>
                                            <span className="text-xs text-gray-400 font-bold">{pipeline.targetToken}</span>
                                        </div>
                                        <div className="flex gap-1 mt-1">
                                            {pipeline.selectedDEXs.map(dex => (
                                                <span key={dex} className="text-[8px] px-1 bg-white/5 text-gray-500 rounded border border-white/5 uppercase">
                                                    {dex}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => togglePipeline(pipeline.id)}
                                        className={cn(
                                            "p-1.5 rounded-lg transition-colors",
                                            pipeline.isActive ? "text-emerald-400 hover:bg-emerald-400/10" : "text-gray-600 hover:bg-white/5"
                                        )}
                                    >
                                        <Power className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => removePipeline(pipeline.id)}
                                        className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </Card>
    );
}
