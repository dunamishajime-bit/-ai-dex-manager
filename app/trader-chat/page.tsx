"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, User, Bot, ArrowLeft, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserLearning } from "@/context/UserLearningContext";
import { useAgents } from "@/context/AgentContext";
import { useSimulation } from "@/context/SimulationContext";
import { generateAgentReply } from "@/lib/gemini-service";
import Link from "next/link";

export default function TraderChatPage() {
    const { userState, addInteraction, clearChatHistory } = useUserLearning();
    const { agents } = useAgents();
    const [userInput, setUserInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Telegram-like message structure
    const messages = userState.interactionHistory.map((m, i) => ({
        id: `msg-${m.timestamp}-${i}`,
        role: m.role,
        content: m.content,
        agentId: m.agentId,
        timestamp: m.timestamp
    }));

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    const handleSendMessage = async () => {
        if (!userInput.trim() || isTyping) return;

        const text = userInput;
        setUserInput("");

        // Add user message
        await addInteraction("user", text);

        setIsTyping(true);
        try {
            // Topic detection logic
            const tradingKeywords = ["buy", "sell", "分析", "予想", "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "買", "売", "おすすめ", "将来性"];
            const isTradingTopic = tradingKeywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()));

            // Generate AI response
            const result = await generateAgentReply(
                text,
                "BTC/USDT",
                95000, // mock price
                agents,
                userState
            );

            await addInteraction("assistant", result.content, result.agentId);

            // If it's a trading topic, trigger the AI Council discussion in the background
            if (isTradingTopic) {
                console.log("Trading topic detected, triggering AI Council...");
                // Trigger council background analysis (simplified for demo)
                // In a real app, we'd call the council API or update a global state
                setTimeout(async () => {
                    try {
                        const { fetchAIRecommendations } = await import("@/lib/coingecko-optimizer");
                        const { fetchCoinDetails } = await import("@/lib/dex-service");
                        const { generateGeminiDiscussion } = await import("@/lib/gemini-service");
                        const { saveHistoryItem } = await import("@/lib/history-service");
                        // Note: We cannot easily get state from hook inside async callback 
                        // It's better to pass it down or use a global store if needed.
                        // For now, let's assume it's passed or available via window/global for this specific background task
                        const addDiscussion = (window as any).jdex_addDiscussion;

                        // Find relevant coin if mentioned, otherwise BTC
                        const mention = tradingKeywords.slice(4, 11).find(k => text.toUpperCase().includes(k));
                        const coinId = mention ? mention.toLowerCase() : "bitcoin";

                        const details = await fetchCoinDetails(coinId);
                        if (details) {
                            const councilResult = await generateGeminiDiscussion(
                                `${details.name} (${details.symbol})`,
                                details.current_price,
                                agents.map(a => a.id),
                                userState.userName,
                                undefined,
                                details
                            );

                            const now = Date.now();
                            const mappedMessages = councilResult.messages.map((m, i) => ({
                                id: `council_${now}_${i}`,
                                timestamp: now + i * 1000,
                                agentId: m.agentId,
                                content: m.content,
                                round: m.round || 1,
                                type: (m.type as any) || "ANALYSIS"
                            }));

                            // Sync with global discussion feed
                            if (addDiscussion) {
                                (addDiscussion as any)({
                                    id: `chat_triggered_${now}`,
                                    pair: `${details.symbol}/JPY`,
                                    messages: mappedMessages,
                                    result: councilResult.result,
                                    source: "trader-chat",
                                    timestamp: now
                                });
                            }
                        }
                    } catch (e) {
                        console.error("Background council trigger failed", e);
                    }
                }, 1000);
            }
        } catch (error) {
            console.error("Chat error:", error);
        } finally {
            setIsTyping(false);
        }
    };

    const getAgent = (id?: string) => agents.find(a => a.id === id) || agents.find(a => a.id === "coordinator");

    return (
        <div className="relative min-h-[calc(100vh-64px)] flex flex-col overflow-hidden">
            {/* Dynamic Background: Data Stream Effect */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute inset-0 bg-cyber-darker" />
                {/* Cinematic Base */}
                <div
                    className="absolute inset-0 opacity-10 bg-cover bg-center bg-no-repeat"
                    style={{ backgroundImage: `url('/images/backgrounds/chat.png')` }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-blue-900/10 to-transparent" />

                {/* Simulated Data Streams via CSS Animation */}
                <div className="absolute inset-0 opacity-20">
                    {[...Array(20)].map((_, i) => (
                        <div
                            key={i}
                            className="absolute bg-blue-500/30 w-[1px] h-32 blur-[1px]"
                            style={{
                                left: `${Math.random() * 100}%`,
                                top: `-10%`,
                                animation: `data-flow ${2 + Math.random() * 3}s linear infinite`,
                                animationDelay: `${Math.random() * 5}s`
                            }}
                        />
                    ))}
                </div>
            </div>

            {/* Header */}
            <header className="relative z-10 p-4 border-b border-white/10 bg-black/40 backdrop-blur-md flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/ai-agents" className="p-2 hover:bg-white/5 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-400" />
                    </Link>
                    <div>
                        <h1 className="text-lg font-bold text-white flex items-center gap-2">
                            <Bot className="w-5 h-5 text-gold-400" />
                            TraderChat
                        </h1>
                        <p className="text-xs text-emerald-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            AI Council Online
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => {
                        if (window.confirm("チャット履歴を削除しますか？")) {
                            clearChatHistory();
                        }
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all text-xs font-medium"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    履歴削除
                </button>
            </header>

            {/* Messages Area */}
            <div
                ref={scrollRef}
                className="relative z-10 flex-1 overflow-y-auto p-4 md:p-6 space-y-4 custom-scrollbar"
            >
                <div className="max-w-4xl mx-auto space-y-4">
                    <AnimatePresence initial={false}>
                        {messages.map((msg) => {
                            const isAI = msg.role === "assistant";
                            const agent = isAI ? getAgent(msg.agentId) : null;

                            return (
                                <motion.div
                                    key={msg.id}
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    className={cn(
                                        "flex gap-3 max-w-[85%] md:max-w-[70%]",
                                        isAI ? "mr-auto" : "ml-auto flex-row-reverse"
                                    )}
                                >
                                    {/* Avatar */}
                                    <div className="shrink-0 mt-1">
                                        {isAI ? (
                                            <div className={cn(
                                                "w-9 h-9 rounded-lg overflow-hidden border-2 relative",
                                                agent?.borderColor || "border-gold-500/30"
                                            )}>
                                                <img
                                                    src={agent?.avatar}
                                                    alt={agent?.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                        ) : (
                                            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center border border-blue-400/30">
                                                <User className="w-4 h-4 text-white" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Bubble */}
                                    <div className={cn(
                                        "flex flex-col gap-1",
                                        isAI ? "items-start" : "items-end"
                                    )}>
                                        <div className="flex items-center gap-2 px-1">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                                {isAI ? (agent?.shortName || "COORDINATOR") : userState.userName}
                                            </span>
                                            <span className="text-[9px] text-gray-600 font-mono">
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <div className={cn(
                                            "px-4 py-2.5 rounded-2xl shadow-xl relative text-sm leading-relaxed whitespace-pre-wrap break-words",
                                            isAI
                                                ? "bg-[#182533] text-white rounded-tl-none border border-white/5"
                                                : "bg-[#2b5278] text-white rounded-tr-none border border-white/5"
                                        )}>
                                            {msg.content}
                                            {/* Tail */}
                                            <div className={cn(
                                                "absolute top-0 w-3 h-3",
                                                isAI
                                                    ? "-left-1.5 bg-[#182533] [clip-path:polygon(100%_0,0_0,100%_100%)]"
                                                    : "-right-1.5 bg-[#2b5278] [clip-path:polygon(0_0,100%_0,0_100%)]"
                                            )} />
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>

                    {isTyping && (
                        <div className="flex gap-3 mr-auto items-end opacity-70">
                            <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center border border-white/10">
                                <Bot className="w-4 h-4 text-gray-400" />
                            </div>
                            <div className="bg-[#182533] p-3 rounded-2xl rounded-tl-none border border-white/5 flex gap-1">
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.32s]" />
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.16s]" />
                                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Input Form */}
            <div className="relative z-10 p-4 bg-black/40 backdrop-blur-md border-t border-white/10">
                <div className="max-w-4xl mx-auto flex items-end gap-2 bg-white/5 p-1 rounded-2xl border border-white/10 focus-within:border-gold-500/50 transition-colors">
                    <textarea
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSendMessage();
                            }
                        }}
                        placeholder="メッセージを入力..."
                        rows={1}
                        className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-3 px-4 resize-none min-h-[44px] max-h-32 custom-scrollbar"
                    />
                    <button
                        onClick={handleSendMessage}
                        disabled={!userInput.trim() || isTyping}
                        className="p-3 bg-gold-500 text-black rounded-xl hover:bg-gold-400 disabled:opacity-30 disabled:grayscale transition-all shadow-[0_0_15px_rgba(255,215,0,0.2)]"
                    >
                        {isTyping ? (
                            <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                        ) : (
                            <Send className="w-5 h-5" />
                        )}
                    </button>
                </div>
                <p className="text-center text-[10px] text-gray-500 mt-2">
                    Shift+Enter で改行
                </p>
            </div>

            <style jsx global>{`
                @keyframes data-flow {
                    0% { transform: translateY(0); opacity: 0; }
                    20% { opacity: 1; }
                    80% { opacity: 1; }
                    100% { transform: translateY(100vh); opacity: 0; }
                }
            `}</style>
        </div>
    );
}
