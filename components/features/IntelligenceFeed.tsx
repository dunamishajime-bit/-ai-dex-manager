"use client";

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Cpu, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

const INTELLIGENCE_LOGS = [
    "Analyzing liquidity depth on Uniswap v3...",
    "Scanning sentiment on X (Twitter) - 'BTC' mentions up 12%",
    "Cross-referencing MACD cross-over on 4h timeframe...",
    "Risk assessment: Rugpull probability 0.2% - SAFE",
    "Fundamental data: Whitepaper update detected for SOL",
    "Coordinating agent opinions based on current market volatility...",
    "Calculating optimal entry: Fibonacci 0.618 level reached",
    "Security check: Contract auditor verified (CertiK/OpenZeppelin)",
    "DEX aggregator finding best route through Curve and SushiSwap...",
    "Sentiment scan: Fear & Greed Index at 64 (Greed)",
    "Whale alert: 500 BTC moved to cold storage",
    "Technical: RSI(14) in neutral territory at 52",
    "Processing agent messages via Gemini-1.5-Pro flash...",
    "Auto-trade pipeline: Monitoring gas prices (Current: 12 gwei)",
    "Sentiment update: Influencer 'vitalik.eth' mentioned L2 scaling",
];

export function IntelligenceFeed() {
    const [logs, setLogs] = useState<string[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const interval = setInterval(() => {
            const randomLog = INTELLIGENCE_LOGS[Math.floor(Math.random() * INTELLIGENCE_LOGS.length)];
            const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const logWithTime = `[${timestamp}] ${randomLog}`;

            setLogs(prev => [...prev.slice(-14), logWithTime]);
        }, 3000);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="h-full flex flex-col bg-black/40 backdrop-blur-md rounded-xl border border-gold-500/10 overflow-hidden font-mono">
            <div className="flex items-center justify-between px-4 py-2 bg-gold-500/5 border-b border-gold-500/10">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-gold-400" />
                    <span className="text-[10px] font-bold text-gold-500 uppercase tracking-widest">Intelligence Feed</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[9px] text-emerald-500/70">LIVE</span>
                </div>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 p-3 overflow-y-auto space-y-1 custom-scrollbar"
            >
                <AnimatePresence mode="popLayout">
                    {logs.map((log, i) => (
                        <motion.div
                            key={log + i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="text-[10px] text-gray-400 hover:text-white transition-colors py-0.5 border-l border-gold-500/20 pl-2 leading-relaxed"
                        >
                            <span className="text-gold-500/40 mr-2">{log.split(' ')[0]}</span>
                            <span className="text-gray-300">{log.split(' ').slice(1).join(' ')}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {logs.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-30">
                        <Cpu className="w-8 h-8 text-gold-500 mb-2 animate-pulse" />
                        <span className="text-[9px] text-gold-500 uppercase tracking-tighter italic">Initializing AI Core...</span>
                    </div>
                )}
            </div>

            <div className="p-2 bg-black/20 text-[8px] text-gray-600 flex items-center justify-between border-t border-gold-500/5">
                <div className="flex gap-3">
                    <span className="flex items-center gap-1"><Activity className="w-2.5 h-2.5" /> AGENTS ACTIVE: 5</span>
                    <span className="flex items-center gap-1"><Cpu className="w-2.5 h-2.5" /> LOAD: 12.4%</span>
                </div>
                <span>v5.0-STABLE</span>
            </div>
        </div>
    );
}
