"use client";

import { Card } from "@/components/ui/Card";
import { Shield, Sliders, PlayCircle, StopCircle } from "lucide-react";
import { useSimulation } from "@/context/SimulationContext";
import { cn } from "@/lib/utils";

export function ControlPanel() {
    const {
        isSimulating,
        toggleSimulation,
        riskTolerance,
        setRiskTolerance,
        stopLossThreshold,
        setStopLossThreshold,
        takeProfitThreshold,
        setTakeProfitThreshold,
        selectedCurrency,
        setSelectedCurrency
    } = useSimulation();

    return (
        <Card title="システム制御" glow="none" className="h-full">
            <div className="flex-1 space-y-4">

                <div className={cn(
                    "flex items-center justify-between p-3 rounded border transition-colors duration-300",
                    isSimulating ? "border-white/10 bg-white/5" : "border-red-500/30 bg-red-500/5"
                )}>
                    <div className="flex items-center gap-3">
                        <Shield className={cn("w-5 h-5 transition-colors", isSimulating ? "text-gray-400" : "text-red-500 animate-pulse")} />
                        <div>
                            <div className="text-sm font-medium text-white">
                                {isSimulating ? "緊急停止" : "システム停止中"}
                            </div>
                            <div className="text-xs text-gray-500">
                                {isSimulating ? "自動取引を停止します" : "手動で取引が無効化されました"}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={toggleSimulation}
                        className={cn(
                            "p-2 rounded border transition-all duration-200 active:scale-95",
                            isSimulating
                                ? "bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20"
                                : "bg-neon-green/10 text-neon-green border-neon-green/30 hover:bg-neon-green/20"
                        )}
                    >
                        {isSimulating ? <StopCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                    </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded border border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="text-gold-500 bg-gold-500/10 p-1.5 rounded">
                            <Shield className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-white">リスク許容度</div>
                            <div className="text-xs text-gray-500">
                                {riskTolerance === 1 ? "極めて保守的" :
                                    riskTolerance === 2 ? "保守的" :
                                        riskTolerance === 3 ? "中立" :
                                            riskTolerance === 4 ? "積極的" : "極めて積極的"}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-lg font-mono text-gold-400">{riskTolerance}/5</span>
                        <input
                            type="range"
                            min="1"
                            max="5"
                            value={riskTolerance}
                            onChange={(e) => setRiskTolerance(parseInt(e.target.value))}
                            className="w-24 accent-gold-500 cursor-pointer"
                        />
                    </div>
                </div>

                {/* Stop Loss Control */}
                <div className="flex items-center justify-between p-3 rounded border border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="text-red-500 bg-red-500/10 p-1.5 rounded">
                            <Shield className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-white">損切りライン (Stop Loss)</div>
                            <div className="text-xs text-gray-500">
                                {stopLossThreshold}% で強制決済
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-400">{stopLossThreshold}%</span>
                        <input
                            type="range"
                            min="-20"
                            max="-1"
                            value={stopLossThreshold}
                            onChange={(e) => setStopLossThreshold(parseInt(e.target.value))}
                            className="w-24 accent-red-500 cursor-pointer"
                        />
                    </div>
                </div>

                {/* Take Profit Control */}
                <div className="flex items-center justify-between p-3 rounded border border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="text-gold-400 bg-gold-400/10 p-1.5 rounded">
                            <Shield className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-white">利確ライン (Take Profit)</div>
                            <div className="text-xs text-gray-500">
                                +{takeProfitThreshold}% で50%決済
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-400">+{takeProfitThreshold}%</span>
                        <input
                            type="range"
                            min="1"
                            max="50"
                            value={takeProfitThreshold}
                            onChange={(e) => setTakeProfitThreshold(parseInt(e.target.value))}
                            className="w-24 accent-gold-500 cursor-pointer"
                        />
                    </div>
                </div>

            </div>
        </Card>
    );
}
