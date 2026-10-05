"use client";

import { useSimulation } from "@/context/SimulationContext";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingUp, TrendingDown } from "lucide-react";
import { useEffect } from "react";

export function TradeNotificationToast() {
    const { tradeNotifications, dismissNotification } = useSimulation();
    const autoTradeNotifications = tradeNotifications.filter((notification) => notification.autoTradeTarget);

    // Auto-dismiss after 8 seconds
    useEffect(() => {
        if (autoTradeNotifications.length === 0) return;
        const latest = autoTradeNotifications[0];
        if (!latest) return;
        const timer = setTimeout(() => {
            dismissNotification(latest.id);
        }, 8000);
        return () => clearTimeout(timer);
    }, [autoTradeNotifications, dismissNotification]);

    return (
        <div className="fixed left-4 right-4 top-20 z-[100] flex flex-col gap-2 md:left-auto md:right-6 md:top-24 md:max-w-sm pointer-events-none">
            <AnimatePresence>
                {autoTradeNotifications.slice(0, 3).map((notif) => (
                    <motion.div
                        key={notif.id}
                        initial={{ x: 50, opacity: 0, scale: 0.9 }}
                        animate={{ x: 0, opacity: 1, scale: 1 }}
                        exit={{ x: 50, opacity: 0, scale: 0.9 }}
                        transition={{ type: "spring", damping: 20 }}
                        className={`pointer-events-auto bg-[#0d1117] border rounded-xl p-3 shadow-2xl backdrop-blur-lg ${notif.type === "BUY"
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
                                    <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-cyan-500/15 text-cyan-300">
                                        AUTO
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${notif.type === "BUY"
                                        ? "bg-emerald-500/20 text-emerald-400"
                                        : "bg-red-500/20 text-red-400"
                                        }`}>
                                        {notif.type}
                                    </span>
                                </div>
                                <p className="text-xs font-semibold text-white mb-1">{notif.title}</p>
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
