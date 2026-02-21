"use client";

import { useSimulation } from "@/context/SimulationContext";
import { ShieldAlert, TrendingUp, Zap, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export function RiskManagement() {
    const {
        riskTolerance, setRiskTolerance,
        stopLossThreshold, setStopLossThreshold,
        takeProfitThreshold, setTakeProfitThreshold,
        isFlashEnabled, setIsFlashEnabled,
        allowedStartTokens, setAllowedStartTokens
    } = useSimulation();

    return (
        <div className="px-3 py-2 space-y-3">
            <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                <h3 className="text-[9px] font-black tracking-widest text-white uppercase">Risk Management</h3>
            </div>

            {/* AI Trading Tendency (Risk Tolerance) */}
            <div className="space-y-1.5">
                <div className="flex justify-between items-end">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <TrendingUp className="w-2.5 h-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">AI Tendency</span>
                    </div>
                    <span className={cn(
                        "text-[9px] font-mono font-bold",
                        riskTolerance >= 4 ? "text-rose-400" : riskTolerance >= 2 ? "text-gold-400" : "text-emerald-400"
                    )}>
                        {riskTolerance === 1 ? "Passive" :
                            riskTolerance === 2 ? "Cautious" :
                                riskTolerance === 3 ? "Balanced" :
                                    riskTolerance === 4 ? "Aggressive" : "Degenerate"}
                    </span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={riskTolerance}
                    onChange={(e) => setRiskTolerance(parseInt(e.target.value))}
                    className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-gold-500 border border-white/5"
                />
            </div>

            {/* Settlement (Stop Loss) */}
            <div className="space-y-1.5">
                <div className="flex justify-between items-end">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <Target className="w-2.5 h-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">Stop Loss</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-rose-400">
                        {stopLossThreshold}%
                    </span>
                </div>
                <input
                    type="range"
                    min="-20"
                    max="-1"
                    step="1"
                    value={stopLossThreshold}
                    onChange={(e) => setStopLossThreshold(parseInt(e.target.value))}
                    className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-rose-500 border border-white/5"
                />
            </div>

            {/* Take Profit (Settlement) */}
            <div className="space-y-1.5">
                <div className="flex justify-between items-end">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <TrendingUp className="w-2.5 h-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">Take Profit</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-emerald-400">
                        +{takeProfitThreshold}%
                    </span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={takeProfitThreshold}
                    onChange={(e) => setTakeProfitThreshold(parseInt(e.target.value))}
                    className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-emerald-500 border border-white/5"
                />
            </div>

            {/* Flash Trade Toggle */}
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
                    <div className={cn(
                        "absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all duration-300",
                        isFlashEnabled ? "right-0.5 bg-gold-400" : "left-0.5 bg-gray-500"
                    )} />
                </button>
            </div>

            {/* Auto-Trade Start Funds */}
            <div className="pt-2 border-t border-white/5 space-y-2">
                <div className="flex items-center gap-1.5 text-gray-400 mb-1">
                    <Target className="w-2.5 h-2.5" />
                    <span className="text-[8px] font-bold uppercase tracking-widest pl-1">Start Funds</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                    {["BNB", "BTC", "SOL", "POL"].map((token) => (
                        <label key={token} className="flex items-center justify-between group cursor-pointer">
                            <span className="text-[10px] font-bold text-gray-400 group-hover:text-gold-400 transition-colors uppercase tracking-widest">{token}</span>
                            <input
                                type="checkbox"
                                checked={allowedStartTokens.includes(token)}
                                onChange={(e) => {
                                    if (e.target.checked) {
                                        setAllowedStartTokens([...allowedStartTokens, token]);
                                    } else {
                                        setAllowedStartTokens(allowedStartTokens.filter(t => t !== token));
                                    }
                                }}
                                className="w-3 h-3 rounded bg-black border border-white/10 accent-gold-500 cursor-pointer"
                            />
                        </label>
                    ))}
                </div>
                <p className="text-[7px] text-gold-500/40 leading-tight pt-1">
                    ※ 選択された通貨のみを自動トレード資金として使用します。
                </p>
            </div>
        </div>
    );
}
