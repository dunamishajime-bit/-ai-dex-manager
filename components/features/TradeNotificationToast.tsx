"use client";

import { useSimulation } from "@/context/SimulationContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingUp, TrendingDown } from "lucide-react";
import { useEffect } from "react";

export function TradeNotificationToast() {
    const { tradeNotifications, dismissNotification } = useSimulation();

    // Auto-dismiss after 8 seconds
    useEffect(() => {
        if (tradeNotifications.length === 0) return;
        const latest = tradeNotifications[0];
        const timer = setTimeout(() => {
            dismissNotification(latest.id);
        }, 8000);
        return () => clearTimeout(timer);
    }, [tradeNotifications, dismissNotification]);

    return (
        <div className="fixed bottom-4 left-[216px] z-50 flex flex-col gap-2 max-w-xs">
            <AnimatePresence>
                {tradeNotifications.slice(0, 3).map((notif) => (
                    <motion.div
                        key={notif.id}
                        initial={{ x: -100, opacity: 0, scale: 0.9 }}
                        animate={{ x: 0, opacity: 1, scale: 1 }}
                        exit={{ x: -100, opacity: 0, scale: 0.9 }}
                        transition={{ type: "spring", damping: 20 }}
                        className={`bg-[#0d1117] border rounded-xl p-3 shadow-2xl backdrop-blur-lg ${notif.type === "BUY"
                            ? "border-emerald-500/30 shadow-emerald-500/10"
                            : "border-red-500/30 shadow-red-500/10"
                            }`}
                    >
                        <div className="flex items-start gap-3">
                            <div className={`p-1.5 rounded-lg ${notif.type === "BUY" ? "bg-emerald-500/20" : "bg-red-500/20"
                                }`}>
                                {notif.type === "BUY" ? (
                                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                                ) : (
                                    <TrendingDown className="w-4 h-4 text-red-400" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="text-xs font-bold text-gold-400">{notif.agentName}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${notif.type === "BUY"
                                        ? "bg-emerald-500/20 text-emerald-400"
                                        : "bg-red-500/20 text-red-400"
                                        }`}>
                                        {notif.type}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-300 leading-relaxed">{notif.message}</p>
                                <p className="text-[10px] text-gray-600 mt-1 font-mono">{notif.symbol}</p>
                            </div>
                            <button
                                onClick={() => dismissNotification(notif.id)}
                                className="text-gray-600 hover:text-gray-400 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
