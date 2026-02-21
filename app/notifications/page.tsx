"use client";

import { Bell, Check, Clock, AlertTriangle, TrendingUp, TrendingDown, Info, Trash2 } from "lucide-react";
import { useSimulation } from "@/context/SimulationContext";

export default function NotificationsPage() {
    const { tradeNotifications, dismissNotification, clearNotifications } = useSimulation();

    const markAllAsRead = () => {
        // Since we don't have a 'read' status in the context yet, 
        // we'll just provide a visual feedback or could clear them.
        // User requested 'delete history', so 'Clear All' is more relevant.
    };

    const getIcon = (type: string) => {
        switch (type) {
            case "signal": return <TrendingUp className="w-5 h-5 text-emerald-400" />;
            case "profit": return <TrendingUp className="w-5 h-5 text-gold-400" />;
            case "loss": return <TrendingDown className="w-5 h-5 text-red-400" />;
            case "alert": return <AlertTriangle className="w-5 h-5 text-red-500" />;
            case "strategy": return <Info className="w-5 h-5 text-blue-400" />;
            default: return <Bell className="w-5 h-5 text-gray-400" />;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                        <Bell className="w-6 h-6 text-gold-400" />
                        通知センター
                    </h1>
                    <p className="text-gray-400 text-sm">アラート、シグナル、システム通知の履歴</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={clearNotifications}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors text-sm"
                    >
                        <Trash2 className="w-4 h-4" />
                        すべて削除
                    </button>
                    <button
                        onClick={markAllAsRead}
                        className="flex items-center gap-2 px-4 py-2 bg-gold-500/10 border border-gold-500/20 text-gold-400 rounded-lg hover:bg-gold-500/20 transition-colors text-sm opacity-50 cursor-not-allowed"
                        disabled
                    >
                        <Check className="w-4 h-4" />
                        すべて既読にする
                    </button>
                </div>
            </div>

            <div className="space-y-3">
                {tradeNotifications.length === 0 ? (
                    <div className="py-20 text-center border border-dashed border-gold-500/10 rounded-xl">
                        <Bell className="w-12 h-12 text-gold-500/20 mx-auto mb-4" />
                        <p className="text-gray-500 font-mono text-sm">通知履歴はありません</p>
                    </div>
                ) : (
                    tradeNotifications.map((n) => (
                        <div
                            key={n.id}
                            className={`glass-panel p-4 rounded-xl border border-gold-500/30 bg-gold-500/5 transition-all relative group`}
                        >
                            <button
                                onClick={() => dismissNotification(n.id)}
                                className="absolute top-4 right-4 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                            <div className="flex gap-4">
                                <div className={`mt-1 p-2 rounded-lg bg-black/40`}>
                                    {getIcon(n.type)}
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className={`text-sm md:text-base font-bold text-white`}>
                                            {n.title}
                                        </h3>
                                        <span className="text-xs text-gray-500 flex items-center gap-1 shrink-0 ml-2">
                                            <Clock className="w-3 h-3" />
                                            {new Date(n.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-400 leading-relaxed">
                                        {n.message}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
