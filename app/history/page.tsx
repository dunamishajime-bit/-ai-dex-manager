"use client";

import { Card } from "@/components/ui/Card";
import { useSimulation } from "@/context/SimulationContext";
import { Download, ExternalLink } from "lucide-react";

function getExplorerUrl(chain: string | undefined, txHash: string) {
    if (chain === "Polygon") {
        return `https://polygonscan.com/tx/${txHash}`;
    }
    return `https://bscscan.com/tx/${txHash}`;
}

export default function HistoryPage() {
    const { transactions } = useSimulation();

    const handleExport = () => {
        const headers = ["ID", "日時", "タイプ", "通貨ペア", "数量", "シンボル", "チェーン", "価格(¥)", "手数料(¥)", "実現損益(¥)", "TxHash"];
        const rows = transactions.map((tx) => {
            const date = new Date(tx.timestamp).toLocaleString("ja-JP");
            return [
                tx.id,
                date,
                tx.type,
                tx.pair || `${tx.symbol}/USDT`,
                tx.amount,
                tx.symbol,
                tx.chain || "BNB Chain",
                tx.price,
                tx.fee,
                tx.pnl || 0,
                tx.txHash,
            ].join(",");
        });

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "dis-terminal_trade_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <h1 className="bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-2xl font-bold text-transparent">
                    トレード履歴
                </h1>
                <button
                    onClick={handleExport}
                    className="flex items-center gap-2 rounded border border-gold-500/50 bg-gold-500/10 px-4 py-2 text-gold-500 transition-colors hover:bg-gold-500/20"
                >
                    <Download className="h-4 w-4" />
                    <span>CSVエクスポート</span>
                </button>
            </div>

            <Card title="最近の取引" glow="gold">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-white/10 bg-white/5 text-xs uppercase text-gray-400">
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
                                <tr key={tx.id} className="border-b border-white/5 transition-colors hover:bg-white/5">
                                    <td className="px-4 py-3 font-mono text-gray-300">
                                        {new Date(tx.timestamp).toLocaleString("ja-JP")}
                                    </td>
                                    <td className={`px-4 py-3 font-bold ${tx.type === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                                        {tx.type === "BUY" ? "買い" : "売り"}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-gray-300">
                                        {tx.pair || `${tx.symbol}/USDT`}
                                    </td>
                                    <td className="px-4 py-3 font-mono">{tx.amount.toFixed(6)}</td>
                                    <td className="px-4 py-3 font-bold text-gold-400">{tx.symbol}</td>
                                    <td className="px-4 py-3 text-xs text-gray-400">{tx.chain || "BNB Chain"}</td>
                                    <td className="px-4 py-3 font-mono">¥{tx.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                    <td className="px-4 py-3 font-mono text-gray-400">¥{tx.fee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                    <td className={`px-4 py-3 font-mono font-bold ${(tx.pnl || 0) > 0 ? "text-emerald-400" : (tx.pnl || 0) < 0 ? "text-red-400" : "text-gray-500"}`}>
                                        {tx.pnl ? `¥${tx.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "-"}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-gold-500">
                                        {tx.txHash ? (
                                            <a
                                                href={getExplorerUrl(tx.chain, tx.txHash)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 hover:underline"
                                            >
                                                {tx.txHash.substring(0, 6)}...{tx.txHash.substring(tx.txHash.length - 4)}
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        ) : (
                                            "-"
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {transactions.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
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
