"use client";

import { useEffect, useState } from "react";
import { useSimulation } from "@/context/SimulationContext";
import { ShieldAlert, TrendingUp, Zap, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export function RiskManagement() {
    const {
        riskTolerance, setRiskTolerance,
        stopLossThreshold, setStopLossThreshold,
        takeProfitThreshold, setTakeProfitThreshold,
        isFlashEnabled, setIsFlashEnabled,
        addMessage,
    } = useSimulation();
    const [saveNotice, setSaveNotice] = useState<"saved" | "error" | null>(null);

    const handleSave = () => {
        const payload = {
            tolerance: riskTolerance,
            stopLoss: stopLossThreshold,
            takeProfit: takeProfitThreshold,
        };
        try {
            localStorage.setItem("jdex_risk_settings", JSON.stringify(payload));
            addMessage("SYSTEM", "リスク設定を保存しました。", "SYSTEM");
            setSaveNotice("saved");
        } catch (e) {
            addMessage("SYSTEM", "リスク設定の保存に失敗しました。", "ALERT");
            setSaveNotice("error");
        }
    };

    useEffect(() => {
        if (!saveNotice) return;
        const timer = window.setTimeout(() => setSaveNotice(null), 2200);
        return () => window.clearTimeout(timer);
    }, [saveNotice]);

    return (
        <div className="px-3 py-2 space-y-3">
            <div className="mb-1 flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                <h3 className="text-[9px] font-black uppercase tracking-widest text-white">Risk Management</h3>
            </div>

            <div className="space-y-1.5">
                <div className="flex items-end justify-between">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <TrendingUp className="h-2.5 w-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">AI Tendency</span>
                    </div>
                    <span
                        className={cn(
                            "text-[9px] font-mono font-bold",
                            riskTolerance >= 4 ? "text-rose-400" : riskTolerance >= 2 ? "text-gold-400" : "text-emerald-400",
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
                    onChange={(e) => setRiskTolerance(parseInt(e.target.value))}
                    className="h-1 w-full cursor-pointer appearance-none rounded-full border border-white/5 bg-white/5 accent-gold-500"
                />
            </div>

            <div className="space-y-1.5">
                <div className="flex items-end justify-between">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <Target className="h-2.5 w-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">Stop Loss</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-rose-400">
                        {stopLossThreshold}%
                    </span>
                </div>
                <input
                    type="range"
                    min="-5"
                    max="-1"
                    step="1"
                    value={stopLossThreshold}
                    onChange={(e) => setStopLossThreshold(parseInt(e.target.value))}
                    className="h-1 w-full cursor-pointer appearance-none rounded-full border border-white/5 bg-white/5 accent-rose-500"
                />
            </div>

            <div className="space-y-1.5">
                <div className="flex items-end justify-between">
                    <div className="flex items-center gap-1.5 text-gray-400">
                        <TrendingUp className="h-2.5 w-2.5" />
                        <span className="text-[8px] font-bold uppercase tracking-tighter">Take Profit</span>
                    </div>
                    <span className="text-[9px] font-mono font-bold text-emerald-400">
                        +{takeProfitThreshold}%
                    </span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={takeProfitThreshold}
                    onChange={(e) => setTakeProfitThreshold(parseInt(e.target.value))}
                    className="h-1 w-full cursor-pointer appearance-none rounded-full border border-white/5 bg-white/5 accent-emerald-500"
                />
            </div>

            <div className="flex items-center justify-between border-t border-white/5 pt-1">
                <div className="flex items-center gap-1.5 text-gray-400">
                    <Zap className="h-2.5 w-2.5" />
                    <span className="text-[8px] font-bold uppercase tracking-tighter">Flash Mode</span>
                </div>
                <button
                    onClick={() => setIsFlashEnabled(!isFlashEnabled)}
                    className={cn(
                        "relative h-3.5 w-7 rounded-full transition-colors duration-300",
                        isFlashEnabled ? "bg-gold-500/40" : "bg-white/10",
                    )}
                >
                    <div
                        className={cn(
                            "absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all duration-300",
                            isFlashEnabled ? "right-0.5 bg-gold-400" : "left-0.5 bg-gray-500",
                        )}
                    />
                </button>
            </div>

            <div className="pt-2">
                <button
                    onClick={handleSave}
                    className="w-full rounded-md border border-gold-500/40 bg-gold-500/15 px-3 py-2 text-[10px] font-bold text-gold-200 hover:border-gold-400 hover:bg-gold-500/25 transition-colors"
                >
                    設定を保存
                </button>
                {saveNotice === "saved" ? (
                    <p className="mt-1 text-center text-[10px] font-bold text-emerald-400">保存しました</p>
                ) : null}
                {saveNotice === "error" ? (
                    <p className="mt-1 text-center text-[10px] font-bold text-rose-400">保存に失敗しました</p>
                ) : null}
            </div>
        </div>
    );
}
