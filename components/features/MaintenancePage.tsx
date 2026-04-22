"use client";

import { Construction, Clock } from "lucide-react";

export function MaintenancePage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[#080b10]">
            <div className="text-center space-y-6 p-8 max-w-md">
                <div className="w-20 h-20 mx-auto bg-gold-500/10 border border-gold-500/30 rounded-2xl flex items-center justify-center gold-pulse">
                    <Construction className="w-10 h-10 text-gold-400" />
                </div>
                <h1 className="text-2xl font-bold gold-gradient-text">只今メンテナンス中。</h1>
                <p className="text-gray-400 text-sm leading-relaxed">
                    サービスの品質向上のため、現在メンテナンスを実施しております。<br />
                    しばらくお待ちください。
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-gold-400/50">
                    <Clock className="w-3 h-3" />
                    <span>まもなく復旧予定</span>
                </div>
                <div className="pt-4 border-t border-gold-500/10">
                    <p className="text-gray-600 text-[10px]">J-DEX TRACKER • AI駆動DEXプラットフォーム</p>
                </div>
            </div>
        </div>
    );
}
