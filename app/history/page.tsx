"use client";

import { Card } from "@/components/ui/Card";
import { useSimulation } from "@/context/SimulationContext";
import { Download, ExternalLink } from "lucide-react";

export default function HistoryPage() {
    const { transactions } = useSimulation();

    const handleExport = () => {
        const headers = ["ID", "日時", "タイプ", "取引 (J-DEX)", "数量", "通貨シンボル", "チェーン", "価格 (¥)", "手数料 (¥)", "PnL (¥)", "TxHash"];
        const rows = transactions.map(tx => {
            const date = new Date(tx.timestamp).toLocaleString("ja-JP");
            return [
                tx.id, date, tx.type, tx.pair || `${tx.symbol}/JPY`,
                tx.amount, tx.symbol, tx.chain || "Ethereum",
                tx.price, tx.fee, tx.pnl || 0, tx.txHash
            ].join(",");
        });
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "j-dex_trade_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-transparent">
                    トレード履歴
                </h1>
                <button
                    onClick={handleExport}
                    className="flex items-center gap-2 bg-gold-500/10 hover:bg-gold-500/20 text-gold-500 border border-gold-500/50 px-4 py-2 rounded transition-colors"
                >
                    <Download className="w-4 h-4" />
                    <span>CSVエクスポート</span>
                </button>
            </div>

            <Card title="最近の取引" glow="gold">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-400 uppercase bg-white/5 border-b border-white/10">
                            <tr>
                                <th className="px-4 py-3">日時</th>
                                <th className="px-4 py-3">タイプ</th>
                                <th className="px-4 py-3">通貨ペア</th>
                                <th className="px-4 py-3">数量</th>
                                <th className="px-4 py-3 text-gold-500">シンボル</th>
                                <th className="px-4 py-3 text-gold-500">チェーン</th>
                                <th className="px-4 py-3">価格 (¥)</th>
                                <th className="px-4 py-3">手数料 (¥)</th>
                                <th className="px-4 py-3">実現損益 (¥)</th>
                                <th className="px-4 py-3">Tx Hash</th>
                            </tr>
                        </thead>
                        <tbody>
                            {transactions.map((tx) => (
                                <tr key={tx.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <td className="px-4 py-3 font-mono text-gray-300">
                                        {new Date(tx.timestamp).toLocaleString("ja-JP")}
                                    </td>
                                    <td className={`px-4 py-3 font-bold ${tx.type === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                                        {tx.type === "BUY" ? "購入" : "売却"}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-gray-300">
                                        {tx.pair || `${tx.symbol}/JPY`}
                                    </td>
                                    <td className="px-4 py-3 font-mono">{tx.amount.toFixed(4)}</td>
                                    <td className="px-4 py-3 font-bold text-gold-400">{tx.symbol}</td>
                                    <td className="px-4 py-3 text-gray-400 text-xs">{tx.chain || "Ethereum"}</td>
                                    <td className="px-4 py-3 font-mono">¥{tx.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                    <td className="px-4 py-3 font-mono text-gray-400">¥{tx.fee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                    <td className={`px-4 py-3 font-mono font-bold ${(tx.pnl || 0) > 0 ? "text-emerald-400" : (tx.pnl || 0) < 0 ? "text-red-400" : "text-gray-500"}`}>
                                        {tx.pnl ? `¥${tx.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "-"}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-gold-500 hover:underline cursor-pointer flex items-center gap-1">
                                        {tx.txHash ? (
                                            <a href={tx.chain === "Polygon" ? `https://polygonscan.com/tx/${tx.txHash}` : `https://etherscan.io/tx/${tx.txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                                                {tx.txHash.substring(0, 6)}...{tx.txHash.substring(tx.txHash.length - 4)}
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        ) : "-"}
                                    </td>
                                </tr>
                            ))}
                            {transactions.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                                        取引履歴がありません
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
