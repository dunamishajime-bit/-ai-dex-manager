"use client";

import { useState, useEffect } from "react";
import { useSimulation } from "@/context/SimulationContext";
import { getRecommendedDEXs } from "@/lib/dex-service";
import { Card } from "@/components/ui/Card";
import { Plus, Trash2, Power, Settings2, Check, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function TradingPipelineManager() {
    const { tradingPipelines, addPipeline, removePipeline, togglePipeline } = useSimulation();
    const [isAdding, setIsAdding] = useState(false);
    const [baseToken, setBaseToken] = useState("");
    const [targetToken, setTargetToken] = useState("USDT");
    const [selectedDEXs, setSelectedDEXs] = useState<string[]>([]);
    const [recommendedDEXs, setRecommendedDEXs] = useState<string[]>([]);

    useEffect(() => {
        if (baseToken.length >= 2) {
            const dexs = getRecommendedDEXs(baseToken) || [];
            setRecommendedDEXs(dexs);

            if (selectedDEXs.length === 0 && dexs.length > 0 && typeof dexs[0] === "string") {
                setSelectedDEXs([dexs[0]]);
            }
        } else {
            setRecommendedDEXs([]);
        }
    }, [baseToken, selectedDEXs.length]);

    const handleAdd = () => {
        if (!baseToken || !targetToken || selectedDEXs.length === 0) return;
        addPipeline(baseToken, targetToken, selectedDEXs);
        setBaseToken("");
        setSelectedDEXs([]);
        setIsAdding(false);
    };

    const toggleDEX = (dex: string) => {
        setSelectedDEXs((prev) =>
            prev.includes(dex)
                ? prev.filter((d) => d !== dex)
                : prev.length < 5 ? [...prev, dex] : prev
        );
    };

    return (
        <Card title="トレード・パイプライン管理" glow="secondary" className="h-full border-gold-500/30">
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                        AIが提案した通貨ペアとDEXの組み合わせを管理します。
                    </p>
                    <button
                        onClick={() => setIsAdding(!isAdding)}
                        className="rounded-lg border border-gold-500/30 bg-gold-500/10 p-1.5 text-gold-400 transition-all hover:bg-gold-500/20"
                    >
                        {isAdding ? <Settings2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </button>
                </div>

                {isAdding && (
                    <div className="animate-in slide-in-from-top-2 fade-in space-y-4 rounded-xl border border-gold-500/20 bg-white/5 p-4 duration-300">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="mb-1 block text-[10px] font-bold uppercase text-gray-400">基軸通貨 (Base)</label>
                                <input
                                    value={baseToken}
                                    onChange={(e) => setBaseToken(e.target.value.toUpperCase())}
                                    placeholder="e.g. ASTR"
                                    className="w-full rounded-lg border border-white/10 bg-black/40 p-2 text-sm text-white outline-none focus:border-gold-500/50"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-[10px] font-bold uppercase text-gray-400">対象通貨 (Target)</label>
                                <input
                                    value={targetToken}
                                    onChange={(e) => setTargetToken(e.target.value.toUpperCase())}
                                    placeholder="USDT"
                                    className="w-full rounded-lg border border-white/10 bg-black/40 p-2 text-sm text-white outline-none focus:border-gold-500/50"
                                />
                            </div>
                        </div>

                        {recommendedDEXs.length > 0 && (
                            <div className="space-y-2">
                                <label className="block text-[10px] font-bold uppercase text-gray-400">利用DEX候補 (推奨)</label>
                                <div className="flex flex-wrap gap-2">
                                    {recommendedDEXs.map((dex) => (
                                        <button
                                            key={dex}
                                            onClick={() => toggleDEX(dex)}
                                            className={cn(
                                                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all",
                                                selectedDEXs.includes(dex)
                                                    ? "border-gold-500 bg-gold-500 text-black shadow-[0_0_10px_rgba(255,215,0,0.3)]"
                                                    : "border-white/10 bg-white/5 text-gray-400 hover:border-gold-500/30"
                                            )}
                                        >
                                            {selectedDEXs.includes(dex) && <Check className="h-3 w-3" />}
                                            {dex}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleAdd}
                            disabled={!baseToken || selectedDEXs.length === 0}
                            className="w-full rounded-lg bg-gold-500 py-2 text-sm font-black text-black shadow-lg shadow-gold-500/20 transition-all hover:bg-gold-400 disabled:opacity-50"
                        >
                            パイプラインを追加
                        </button>
                    </div>
                )}

                <div className="space-y-3">
                    {tradingPipelines.length === 0 ? (
                        <div className="rounded-2xl border-2 border-dashed border-white/5 py-8 text-center">
                            <p className="text-xs italic text-gray-600">登録されたパイプラインはありません</p>
                        </div>
                    ) : (
                        tradingPipelines.map((pipeline) => (
                            <div
                                key={pipeline.id}
                                className={cn(
                                    "flex items-center justify-between rounded-xl border p-3 transition-all",
                                    pipeline.isActive ? "border-gold-500/20 bg-gold-500/5" : "border-white/5 bg-black/20 opacity-60"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn("rounded-lg p-2", pipeline.isActive ? "bg-gold-500/20 text-gold-400" : "bg-white/5 text-gray-600")}>
                                        <Zap className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-black text-white">{pipeline.baseToken}</h4>
                                            <span className="text-xs text-gray-600">/</span>
                                            <span className="text-xs font-bold text-gray-400">{pipeline.targetToken}</span>
                                        </div>
                                        <div className="mt-1 flex gap-1">
                                            {pipeline.selectedDEXs.map((dex) => (
                                                <span key={dex} className="rounded border border-white/5 bg-white/5 px-1 text-[8px] uppercase text-gray-500">
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
                                            "rounded-lg p-1.5 transition-colors",
                                            pipeline.isActive ? "text-emerald-400 hover:bg-emerald-400/10" : "text-gray-600 hover:bg-white/5"
                                        )}
                                    >
                                        <Power className="h-4 w-4" />
                                    </button>
                                    <button
                                        onClick={() => removePipeline(pipeline.id)}
                                        className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-red-400/10 hover:text-red-400"
                                    >
                                        <Trash2 className="h-4 w-4" />
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
