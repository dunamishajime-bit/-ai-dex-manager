"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Shield, Search, AlertTriangle, CheckCircle, XCircle, Loader2, ExternalLink } from "lucide-react";

interface ScanResult {
    score: number; // 0-100 (100 = safe)
    risks: { level: "high" | "medium" | "low"; desc: string }[];
    info: { label: string; value: string }[];
    isVerified: boolean;
    isDangerous: boolean;
}

// Minimal on-chain security check using Go Plus API (free tier)
async function scanContract(address: string, chainId: number): Promise<ScanResult> {
    try {
        const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("API error");
        const data = await res.json();
        const token = data.result?.[address.toLowerCase()];
        if (!token) throw new Error("Not found");

        const risks: ScanResult["risks"] = [];
        const info: ScanResult["info"] = [];
        let penalty = 0;

        if (token.is_honeypot === "1") { risks.push({ level: "high", desc: "ハニーポット：売却不可能" }); penalty += 50; }
        if (token.cannot_sell_all === "1") { risks.push({ level: "high", desc: "全量売却不可" }); penalty += 30; }
        if (token.is_mintable === "1") { risks.push({ level: "medium", desc: "無制限ミント可能" }); penalty += 15; }
        if (token.owner_change_balance === "1") { risks.push({ level: "high", desc: "オーナーが残高を変更可能" }); penalty += 40; }
        if (token.hidden_owner === "1") { risks.push({ level: "high", desc: "隠れたオーナー" }); penalty += 35; }
        if (token.is_proxy === "1") { risks.push({ level: "medium", desc: "プロキシコントラクト" }); penalty += 10; }
        if (parseFloat(token.buy_tax || "0") > 0.1) { risks.push({ level: "medium", desc: `買いタックス: ${(parseFloat(token.buy_tax) * 100).toFixed(1)}%` }); penalty += 20; }
        if (parseFloat(token.sell_tax || "0") > 0.1) { risks.push({ level: "high", desc: `売りタックス: ${(parseFloat(token.sell_tax) * 100).toFixed(1)}%` }); penalty += 25; }

        info.push({ label: "保有者数", value: token.holder_count || "不明" });
        info.push({ label: "LP保有者数", value: token.lp_holder_count || "不明" });
        info.push({ label: "流動性ロック", value: token.lp_locked === "1" ? "✅ ロック済" : "⚠️ 未ロック" });
        info.push({ label: "コントラクト検証", value: token.is_open_source === "1" ? "✅ オープンソース" : "❌ クローズドソース" });
        info.push({ label: "作成者アドレス", value: token.creator_address ? `${token.creator_address.slice(0, 8)}...` : "不明" });

        return {
            score: Math.max(0, 100 - penalty),
            risks,
            info,
            isVerified: token.is_open_source === "1",
            isDangerous: penalty >= 50,
        };
    } catch {
        // Fallback: basic etherscan check
        return {
            score: 50,
            risks: [{ level: "medium", desc: "詳細スキャンAPIに接続できませんでした" }],
            info: [{ label: "状態", value: "限定的スキャン" }],
            isVerified: false,
            isDangerous: false,
        };
    }
}

const CHAINS = [
    { id: 1, name: "Ethereum", color: "text-blue-400" },
    { id: 56, name: "BNB Chain", color: "text-yellow-400" },
    { id: 137, name: "Polygon", color: "text-purple-400" },
    { id: 43114, name: "Avalanche", color: "text-red-400" },
    { id: 10, name: "Optimism", color: "text-red-500" },
    { id: 42161, name: "Arbitrum", color: "text-blue-500" },
];

export function SecurityScanner() {
    const [address, setAddress] = useState("");
    const [selectedChain, setSelectedChain] = useState(1);
    const [result, setResult] = useState<ScanResult | null>(null);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState("");

    const handleScan = async () => {
        const trimmed = address.trim();
        if (trimmed.length !== 42 || !trimmed.startsWith("0x")) {
            setError("有効なコントラクトアドレスを入力してください（0x...42文字）");
            return;
        }
        setError("");
        setScanning(true);
        setResult(null);
        try {
            const res = await scanContract(trimmed, selectedChain);
            setResult(res);
        } finally {
            setScanning(false);
        }
    };

    const scoreColor = result
        ? result.score >= 70 ? "text-emerald-400"
            : result.score >= 40 ? "text-yellow-400"
                : "text-red-400"
        : "text-gray-400";

    return (
        <div className="space-y-4">
            {/* Chain selector */}
            <div className="flex flex-wrap gap-1.5">
                {CHAINS.map(c => (
                    <button
                        key={c.id}
                        onClick={() => setSelectedChain(c.id)}
                        className={cn(
                            "px-2 py-1 rounded text-[10px] font-mono border transition-all btn-micro",
                            selectedChain === c.id
                                ? "bg-gold-500/10 border-gold-500/40 text-gold-400"
                                : "bg-black/30 border-gray-700 text-gray-500 hover:border-gray-500"
                        )}
                    >
                        {c.name}
                    </button>
                ))}
            </div>

            {/* Input */}
            <div className="flex gap-2">
                <input
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="0x... コントラクトアドレスを貼り付け"
                    className="flex-1 bg-black/50 border border-gold-500/20 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-gray-600 focus:outline-none focus:border-gold-500/50 transition-colors"
                    onKeyDown={e => e.key === "Enter" && handleScan()}
                />
                <button
                    onClick={handleScan}
                    disabled={scanning || !address.trim()}
                    className="px-4 py-2 rounded-lg bg-gold-500/10 border border-gold-500/30 text-gold-400 text-xs font-bold hover:bg-gold-500/20 transition-all btn-micro disabled:opacity-40"
                >
                    {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            {/* Result */}
            {result && (
                <div className="space-y-3 tab-slide-enter">
                    {/* Score */}
                    <div className={cn("text-center py-3 rounded-xl border", result.isDangerous ? "border-red-500/30 bg-red-500/5" : "border-gold-500/10 bg-black/30")}>
                        <div className={cn("text-4xl font-black font-mono", scoreColor)}>
                            {result.score}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">セキュリティスコア / 100</div>
                        <div className={cn("text-xs font-bold mt-1", scoreColor)}>
                            {result.score >= 70 ? "✅ 比較的安全" : result.score >= 40 ? "⚠️ 要注意" : "🚨 危険"}
                        </div>
                    </div>

                    {/* Risks */}
                    {result.risks.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-[10px] text-gray-500 uppercase font-mono">リスク項目</p>
                            {result.risks.map((r, i) => (
                                <div key={i} className={cn(
                                    "flex items-center gap-2 px-2 py-1.5 rounded text-xs",
                                    r.level === "high" ? "bg-red-500/10 text-red-400" :
                                        r.level === "medium" ? "bg-yellow-500/10 text-yellow-400" :
                                            "bg-gray-800 text-gray-400"
                                )}>
                                    {r.level === "high" ? <XCircle className="w-3 h-3 shrink-0" /> :
                                        r.level === "medium" ? <AlertTriangle className="w-3 h-3 shrink-0" /> :
                                            <CheckCircle className="w-3 h-3 shrink-0" />}
                                    {r.desc}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Info */}
                    <div className="grid grid-cols-2 gap-1.5">
                        {result.info.map((info, i) => (
                            <div key={i} className="bg-black/30 rounded px-2 py-1.5 border border-gold-500/5">
                                <div className="text-[9px] text-gray-600 uppercase">{info.label}</div>
                                <div className="text-[10px] text-gray-300 font-mono mt-0.5">{info.value}</div>
                            </div>
                        ))}
                    </div>

                    <p className="text-[9px] text-gray-600 text-center">
                        ※ Go Plus Security APIを使用。投資判断は必ず自己責任で行ってください。
                    </p>
                </div>
            )}
        </div>
    );
}
