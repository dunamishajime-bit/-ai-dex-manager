// AUTO_CONTINUE: enabled
"use client";

import { useSimulation } from "@/context/SimulationContext";
import { ShieldAlert, TrendingUp, Zap, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export function RiskManagement() {
    const {
        riskTolerance,
        setRiskTolerance,
        stopLossThreshold,
        setStopLossThreshold,
        takeProfitThreshold,
        setTakeProfitThreshold,
        isFlashEnabled,
        setIsFlashEnabled,
    } = useSimulation();

    return (
        <div className="px-3 py-2 space-y-3">
            <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                <h3 className="text-[9px] font-black tracking-widest text-white uppercase">Risk Management</h3>
            </div>

            <div className="space-y-1.5">
                <div className="flex justify-between items-end">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <TrendingUp className="w-2.5 h-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">AI Tendency</span>
                    </div>
                    <span
                        className={cn(
                            "text-[9px] font-mono font-bold",
                            riskTolerance >= 4 ? "text-rose-400" : riskTolerance >= 2 ? "text-gold-400" : "text-emerald-400"
                        )}
                    >
                        {riskTolerance === 1
                            ? "Passive"
                            : riskTolerance === 2
                                ? "Cautious"
                                : riskTolerance === 3
                                    ? "Balanced"
                                    : riskTolerance === 4
                                        ? "Aggressive"
                                        : "Degenerate"}
                    </span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={riskTolerance}
                    onChange={(e) => setRiskTolerance(parseInt(e.target.value, 10))}
                    className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-gold-500 border border-white/5"
                />
            </div>

            <div className="space-y-1.5">
                <div className="flex justify-between items-end">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <Target className="w-2.5 h-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">Stop Loss</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-rose-400">{stopLossThreshold}%</span>
                </div>
                <input
                    type="range"
                    min="-20"
                    max="-1"
                    step="1"
                    value={stopLossThreshold}
                    onChange={(e) => setStopLossThreshold(parseInt(e.target.value, 10))}
                    className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-rose-500 border border-white/5"
                />
            </div>

            <div className="space-y-1.5">
                <div className="flex justify-between items-end">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <TrendingUp className="w-2.5 h-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">Take Profit</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-emerald-400">+{takeProfitThreshold}%</span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={takeProfitThreshold}
                    onChange={(e) => setTakeProfitThreshold(parseInt(e.target.value, 10))}
                    className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-emerald-500 border border-white/5"
                />
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-white/5">
                <div className="flex items-center gap-1.5 text-gray-400">
                    <Zap className="w-2.5 h-2.5" />
                    <span className="text-[8px] font-bold uppercase tracking-tighter">Flash Mode</span>
                </div>
                <button
                    onClick={() => setIsFlashEnabled(!isFlashEnabled)}
                    className={cn(
                        "w-7 h-3.5 rounded-full relative transition-colors duration-300",
                        isFlashEnabled ? "bg-gold-500/40" : "bg-white/10"
                    )}
                >
                    <div
                        className={cn(
                            "absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all duration-300",
                            isFlashEnabled ? "right-0.5 bg-gold-400" : "left-0.5 bg-gray-500"
                        )}
                    />
                </button>
            </div>
        </div>
    );
}
