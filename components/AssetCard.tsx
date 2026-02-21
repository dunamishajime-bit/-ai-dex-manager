"use client";

import { Asset } from "@/lib/assets";
import { motion } from "framer-motion";
import { TrendingUp, Activity, ShieldAlert, Zap } from "lucide-react";

interface AssetCardProps {
    asset: Asset;
    onClick: () => void;
}

export default function AssetCard({ asset, onClick }: AssetCardProps) {
    const getStatusColor = (status: string) => {
        switch (status) {
            case "ACTIVE": return "text-blue-400 border-blue-400/30 bg-blue-400/10";
            case "STABLE": return "text-emerald-400 border-emerald-400/30 bg-emerald-400/10";
            case "VOLATILE": return "text-amber-400 border-amber-400/30 bg-amber-400/10";
            default: return "text-white/40 border-white/10 bg-white/5";
        }
    };

    return (
        <motion.div
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClick}
            className="group relative bg-white/5 border border-white/10 rounded-2xl p-5 cursor-pointer overflow-hidden transition-all hover:bg-white/10 hover:border-blue-500/50"
        >
            {/* Ambient Background Effect */}
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />

            <div className="flex justify-between items-start mb-4">
                <div className="flex flex-col">
                    <span className="text-[10px] font-mono text-white/40 tracking-widest uppercase mb-1">{asset.id}</span>
                    <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors uppercase tracking-tight">
                        {asset.name}
                    </h3>
                </div>
                <div className={`px-2 py-1 rounded-md text-[9px] font-black border uppercase tracking-tighter ${getStatusColor(asset.status)}`}>
                    {asset.status}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-white/30 uppercase font-bold">Performance</span>
                    <div className="flex items-center gap-1 text-emerald-400">
                        <TrendingUp className="w-3 h-3" />
                        <span className="text-sm font-mono">{asset.performance >= 0 ? '+' : ''}{asset.performance}%</span>
                    </div>
                </div>
                <div className="flex flex-col gap-1 text-right">
                    <span className="text-[10px] text-white/30 uppercase font-bold">Symbol</span>
                    <span className="text-sm font-mono text-white/80">{asset.symbol}</span>
                </div>
            </div>

            <div className="space-y-2 mb-4">
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${asset.riskScore}%` }}
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-500"
                    />
                </div>
                <div className="flex justify-between text-[8px] text-white/20 uppercase font-bold">
                    <span>Risk Analysis</span>
                    <span>{asset.riskScore}% Accuracy</span>
                </div>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-white/5">
                {asset.metrics.slice(0, 2).map((metric, i) => (
                    <div key={i} className="flex flex-col">
                        <span className="text-[8px] text-white/20 uppercase">{metric.name}</span>
                        <span className="text-[10px] text-white/60 font-mono">{metric.value}</span>
                    </div>
                ))}
            </div>
        </motion.div>
    );
}
