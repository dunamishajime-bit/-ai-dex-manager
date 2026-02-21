"use client";

import { useEffect, useState } from "react";
import { AIHistoryItem, getHistoryItems, clearHistory, deleteHistoryItems } from "@/lib/history-service";
import { Card } from "@/components/ui/Card";
import { Clock, Trash2, ChevronRight, Eye, TrendingUp, TrendingDown, Minus, CheckSquare, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentCouncil } from "@/components/features/AgentCouncil";
import { X, Check } from "lucide-react";

export default function HistoryPage() {
    const [items, setItems] = useState<AIHistoryItem[]>([]);
    const [selectedItem, setSelectedItem] = useState<AIHistoryItem | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    useEffect(() => {
        setItems(getHistoryItems());
    }, []);

    const handleClear = () => {
        if (confirm("全ての履歴を削除してもよろしいですか？")) {
            clearHistory();
            setItems([]);
            setSelectedIds([]);
        }
    };

    const handleDeleteSelected = () => {
        if (selectedIds.length === 0) return;
        if (confirm(`${selectedIds.length}件の履歴を削除してもよろしいですか？`)) {
            deleteHistoryItems(selectedIds);
            setItems(getHistoryItems());
            setSelectedIds([]);
            setIsSelectionMode(false);
        }
    };

    const toggleId = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleString("ja-JP", {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        });
    };

    return (
        <div className="p-6 max-w-7xl mx-auto w-full space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                        <span className="bg-gradient-to-r from-gold-400 to-white bg-clip-text text-transparent">
                            COUNCIL ARCHIVES
                        </span>
                    </h1>
                    <p className="text-gray-400 text-sm font-mono mt-1">過去の意思決定と戦略ログ</p>
                </div>
                <div className="flex items-center gap-2">
                    {items.length > 0 && (
                        <>
                            <button
                                onClick={() => {
                                    setIsSelectionMode(!isSelectionMode);
                                    setSelectedIds([]);
                                }}
                                className={cn(
                                    "px-3 py-1.5 text-xs rounded border transition-colors flex items-center gap-2",
                                    isSelectionMode
                                        ? "bg-gold-500 text-black border-gold-500"
                                        : "text-gold-400 border-gold-400/30 hover:bg-gold-500/10"
                                )}
                            >
                                {isSelectionMode ? <Check className="w-3 h-3" /> : <CheckSquare className="w-3 h-3" />}
                                {isSelectionMode ? "選択終了" : "複数選択"}
                            </button>

                            {isSelectionMode && selectedIds.length > 0 ? (
                                <button
                                    onClick={handleDeleteSelected}
                                    className="px-3 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex items-center gap-2"
                                >
                                    <Trash2 className="w-3 h-3" /> {selectedIds.length}件を削除
                                </button>
                            ) : (
                                <button
                                    onClick={handleClear}
                                    className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 rounded border border-red-900/50 transition-colors flex items-center gap-2"
                                >
                                    <Trash2 className="w-3 h-3" /> 全て削除
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {items.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-gray-500 bg-white/5 rounded-xl border border-white/5">
                    <Clock className="w-12 h-12 mb-4 opacity-50" />
                    <p>No history records found.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {items.map((item) => (
                        <div
                            key={item.id}
                            onClick={() => isSelectionMode ? setSelectedIds(prev => prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id]) : setSelectedItem(item)}
                            className="cursor-pointer relative"
                        >
                            <Card className={cn(
                                "p-4 hover:bg-white/5 transition-all group border-l-4",
                                selectedIds.includes(item.id) ? "border-l-gold-500 bg-gold-500/5" : "border-l-transparent"
                            )}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        {isSelectionMode && (
                                            <div onClick={(e) => toggleId(item.id, e)} className="p-1">
                                                {selectedIds.includes(item.id) ? (
                                                    <CheckSquare className="w-5 h-5 text-gold-500" />
                                                ) : (
                                                    <Square className="w-5 h-5 text-gray-500" />
                                                )}
                                            </div>
                                        )}
                                        <div className={cn(
                                            "w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold",
                                            item.action === "BUY" ? "bg-green-500/20 text-green-400 border border-green-500/30" :
                                                item.action === "SELL" ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                                                    "bg-gray-500/20 text-gray-400 border border-gray-500/30"
                                        )}>
                                            {item.action === "BUY" && <TrendingUp className="w-6 h-6" />}
                                            {item.action === "SELL" && <TrendingDown className="w-6 h-6" />}
                                            {item.action === "HOLD" && <Minus className="w-6 h-6" />}
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-lg flex items-center gap-2">
                                                {item.coinName}
                                                <span className="text-sm text-gray-400 font-mono">({item.coinSymbol})</span>
                                            </h3>
                                            <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" /> {formatDate(item.timestamp)}
                                                </span>
                                                <span className="flex items-center gap-1 text-gold-400">
                                                    MVP: {item.mvpAgent}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <div className="text-xs text-gray-500 uppercase">Confidence</div>
                                            <div className="text-xl font-mono text-gold-400">{item.confidence}%</div>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-white transition-colors" />
                                    </div>
                                </div>
                            </Card>
                        </div>
                    ))}
                </div>
            )}

            {/* Detail Modal */}
            {selectedItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-cyber-black w-full max-w-5xl max-h-[90vh] rounded-2xl border border-white/10 flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    {selectedItem.coinName} Analysis Log
                                    <span className={cn(
                                        "px-2 py-0.5 text-xs rounded border",
                                        selectedItem.action === "BUY" ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                                    )}>{selectedItem.action}</span>
                                </h2>
                                <p className="text-xs text-gray-400 font-mono">{formatDate(selectedItem.timestamp)}</p>
                            </div>
                            <button onClick={() => setSelectedItem(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-black/40">
                            <AgentCouncil
                                messages={selectedItem.discussion.messages}
                                result={selectedItem.discussion.result}
                                symbol={selectedItem.coinSymbol}
                                isAutoPlay={false}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
