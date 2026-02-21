import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sun, TrendingUp, X } from "lucide-react";
import { useSimulation } from "@/context/SimulationContext";

export function MorningReportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const { portfolio, tradingPipelines } = useSimulation();

    if (!isOpen) return null;

    const isAutoTradeActive = tradingPipelines.some(p => p.isActive);
    const balance = portfolio.totalValue;

    // Mock "What-if" data: 1.5% hypothetical gain on balance if not trading
    const whatIfProfit = Math.floor(balance * 0.015);

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    className="w-full max-w-2xl bg-zinc-900 border border-gold-500/30 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(255,215,0,0.1)]"
                >
                    {/* Header */}
                    <div className="relative h-32 bg-gradient-to-r from-gold-600 to-gold-400 p-6 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-white/20 rounded-full">
                                <Sun className="w-8 h-8 text-white animate-pulse" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black text-black">MORNING REPORT</h2>
                                <p className="text-black/60 font-bold text-xs">{new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-black/10 rounded-full transition-colors">
                            <X className="w-6 h-6 text-black" />
                        </button>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Highlights */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 p-4 rounded-xl border border-white/10 relative overflow-hidden">
                                <label className="text-[10px] text-gray-500 font-bold uppercase">前日の収益</label>
                                {isAutoTradeActive ? (
                                    <>
                                        <div className="text-2xl font-black text-emerald-400">+¥12,450</div>
                                        <div className="text-[10px] text-emerald-500/70 font-bold">前日比 +1.2%</div>
                                    </>
                                ) : (
                                    <>
                                        <div className="text-2xl font-black text-gray-400">¥0</div>
                                        <div className="text-[9px] text-gold-400/80 font-bold mt-1 leading-tight">
                                            自動トレード未設定です。設定していれば約 <span className="text-emerald-400">+¥{whatIfProfit.toLocaleString()}</span> の収益が見込めました。
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                                <label className="text-[10px] text-gray-500 font-bold uppercase">現在ポートフォリオ</label>
                                <div className="text-2xl font-black text-gold-400">¥{balance.toLocaleString()}</div>
                                <div className="text-[10px] text-gold-500/70 font-bold">総運用資金残高</div>
                            </div>
                        </div>

                        {/* AI Insight */}
                        <div className="flex gap-4 items-start bg-gold-500/5 p-4 rounded-xl border border-gold-500/20">
                            <img src="/avatars/biz.png" className="w-12 h-12 rounded-full border-2 border-gold-500/50" />
                            <div className="space-y-2">
                                <h4 className="text-xs font-bold text-gold-400">Biz からのアドバイス</h4>
                                <p className="text-sm text-gray-200 leading-relaxed italic">
                                    {isAutoTradeActive
                                        ? "「おはようございます。昨日は戦略が見事に目的を達成しました。本日はSOLの出来高が急増しており、新しい戦略を練っています。」"
                                        : "「おはようございます。現在は自動トレードが稼働していません。現在の市場は非常に活発で、お気に入りの銘柄にも大きなチャンスが訪れています。まずは少額からでも設定をお試しください。」"}
                                </p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="space-y-3">
                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest">本日の注目アクション</h4>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => onClose()} className="w-full py-4 bg-gold-500 hover:bg-gold-400 text-black font-black rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg">
                                    <TrendingUp className="w-5 h-5" />
                                    {isAutoTradeActive ? "AI評議会の分析を確認" : "自動トレード・パイプラインを設定"}
                                </button>
                                <button onClick={onClose} className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-400 text-sm font-bold rounded-xl transition-all">
                                    ダッシュボードへ戻る
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
