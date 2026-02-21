"use client";

import { Card } from "@/components/ui/Card";
import { Bot, MessageSquare, Play, Pause, Send, ThumbsUp, ThumbsDown, Activity, Clock, History, FileText, ChevronRight } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useSimulation, StrategyProposal, DiscussionEntry } from "@/context/SimulationContext";
import { cn } from "@/lib/utils";

// Helper to render message content (handle markdown-like formatting)
function renderFormattedContent(content: string) {
    // Split into lines, process bold markers and links
    const lines = content.split("\n");
    return lines.map((line, lineIdx) => {
        // Process bold (**text**)
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
            <p key={lineIdx} className={lineIdx > 0 ? "mt-1" : ""}>
                {parts.map((part, pi) => {
                    if (part.startsWith("**") && part.endsWith("**")) {
                        return <strong key={pi} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
                    }
                    // Handle @mentions
                    const mentionParts = part.split(/(@\S+)/g);
                    return mentionParts.map((mp, mi) =>
                        mp.startsWith("@") ? (
                            <span key={`${pi}-${mi}`} className="text-pink-500 font-bold mx-1">{mp}</span>
                        ) : (
                            <span key={`${pi}-${mi}`}>{mp}</span>
                        )
                    );
                })}
            </p>
        );
    });
}

export function AICouncil() {
    const {
        messages,
        isSimulating,
        toggleSimulation,
        agents,
        addUserMessage,
        strategyProposals,
        updateProposalStatus,
        aiPopupMessage,
        closePopup,
        discussionHistory
    } = useSimulation();

    const scrollRef = useRef<HTMLDivElement>(null);
    const [input, setInput] = useState("");
    const [activeTab, setActiveTab] = useState<"LIVE" | "ARCHIVE">("LIVE");

    useEffect(() => {
        if (activeTab === "LIVE" && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
        // Voice Playback removed per user request
    }, [messages, activeTab]);

    useEffect(() => {
        if (aiPopupMessage) {
            const timer = setTimeout(() => {
                closePopup();
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [aiPopupMessage, closePopup]);

    const handleSend = () => {
        if (!input.trim()) return;
        addUserMessage(input);
        setInput("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSend();
    };

    const getAgent = (id: string) => agents.find(a => a.id === id);

    const renderAvatar = (agent: any) => {
        if (!agent) return null;

        const avatarSrc = agent.avatar;

        return (
            <div className="relative shrink-0">
                {avatarSrc && avatarSrc.startsWith("http") ? (
                    <img
                        src={avatarSrc}
                        alt={agent.shortName || agent.name}
                        className={`w-10 h-10 rounded-full object-cover border border-white/20`}
                    />
                ) : (
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl bg-white/5 border border-white/10`}
                        style={{ color: agent.color }}>
                        {avatarSrc || agent.shortName?.charAt(0) || "?"}
                    </div>
                )}
            </div>
        );
    };

    return (
        <Card title="AI評議会ディスカッション" glow="primary" className="h-full flex flex-col relative overflow-hidden">
            {/* Header Tabs */}
            <div className="absolute top-4 right-16 flex bg-black/50 rounded-lg p-1 border border-white/10 z-20">
                <button
                    onClick={() => setActiveTab("LIVE")}
                    className={cn(
                        "px-3 py-1 text-xs font-bold rounded flex items-center gap-2 transition-all",
                        activeTab === "LIVE"
                            ? "bg-gold-500 text-black shadow-lg"
                            : "text-gray-400 hover:text-white"
                    )}
                >
                    <Activity className="w-3 h-3" />
                    LIVE
                </button>
                <button
                    onClick={() => setActiveTab("ARCHIVE")}
                    className={cn(
                        "px-3 py-1 text-xs font-bold rounded flex items-center gap-2 transition-all",
                        activeTab === "ARCHIVE"
                            ? "bg-blue-500 text-white shadow-lg"
                            : "text-gray-400 hover:text-white"
                    )}
                >
                    <History className="w-3 h-3" />
                    ARCHIVE
                </button>
            </div>

            {/* AI Character Popup Overlay */}
            {activeTab === "LIVE" && aiPopupMessage && (
                <div className="absolute inset-x-4 top-20 z-50 animate-in slide-in-from-bottom-10 fade-in zoom-in-95 duration-300 pointer-events-none">
                    <div className="bg-black/90 border border-gold-500 rounded-xl p-4 shadow-[0_0_50px_rgba(255,215,0,0.3)] flex items-start gap-4">
                        {renderAvatar(getAgent(aiPopupMessage.agentId))}
                        <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                                <span className={`font-bold text-lg`} style={{ color: getAgent(aiPopupMessage.agentId)?.color }}>
                                    {getAgent(aiPopupMessage.agentId)?.name}
                                </span>
                                <span className="bg-gold-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded">LIVE</span>
                            </div>
                            <div className="text-white text-md font-medium leading-relaxed">
                                {renderFormattedContent(aiPopupMessage.content)}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Strategy Proposals Overlay */}
            {activeTab === "LIVE" && strategyProposals.some(p => p.status === "PENDING") && (
                <div className="absolute top-12 left-4 right-4 z-20 space-y-2">
                    {strategyProposals.filter(p => p.status === "PENDING").map(proposal => (
                        <div key={proposal.id} className="bg-black/90 border border-neon-purple p-3 rounded-lg shadow-[0_0_15px_rgba(188,19,254,0.3)] animate-in slide-in-from-top-5">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="text-neon-purple font-bold text-sm flex items-center gap-2">
                                        <Activity className="w-4 h-4" /> 戦略変更提案
                                    </h4>
                                    <p className="text-white text-md font-mono mt-1">{proposal.title}</p>
                                    <p className="text-gray-400 text-xs">{proposal.description}</p>
                                    {proposal.proposedSettings && (
                                        <div className="flex gap-2 mt-2 text-[10px] font-mono text-gray-400">
                                            <span className="bg-white/5 px-1 py-0.5 rounded">Risk: {proposal.proposedSettings.riskTolerance}</span>
                                            <span className="bg-white/5 px-1 py-0.5 rounded">SL: {proposal.proposedSettings.stopLoss}%</span>
                                            <span className="bg-white/5 px-1 py-0.5 rounded">TP: {proposal.proposedSettings.takeProfit}%</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => updateProposalStatus(proposal.id, "APPROVED")}
                                        className="p-2 bg-neon-green/20 hover:bg-neon-green/40 border border-neon-green text-neon-green rounded transition-colors"
                                    >
                                        <ThumbsUp className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => updateProposalStatus(proposal.id, "REJECTED")}
                                        className="p-2 bg-red-500/20 hover:bg-red-500/40 border border-red-500 text-red-500 rounded transition-colors"
                                    >
                                        <ThumbsDown className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Simulation Toggle Button */}
            <div className="absolute top-6 right-6 flex gap-2 z-10" style={{ right: '10px', top: '55px' }}>
                <button
                    onClick={toggleSimulation}
                    className={cn(
                        "px-3 py-1 rounded text-xs font-mono border flex items-center gap-2 transition-all backdrop-blur-md",
                        isSimulating
                            ? "bg-red-500/10 border-red-500 text-red-400 hover:bg-red-500/20"
                            : "bg-neon-green/10 border-neon-green text-neon-green hover:bg-neon-green/20"
                    )}
                >
                    {isSimulating ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    {isSimulating ? "稼働中" : "停止中"}
                </button>
            </div>

            {/* LIVE CONTENT */}
            {activeTab === "LIVE" ? (
                <>
                    <div className="flex-1 overflow-y-auto pr-1 sm:pr-2 space-y-4 my-2 sm:my-4 custom-scrollbar lg:max-h-[600px] mt-10 sm:mt-12" ref={scrollRef}>
                        {messages.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gold-500/50 opacity-50 animate-pulse">
                                <Bot className="w-16 h-16 mb-4" />
                                <p>評議会の初期化を待機中...</p>
                            </div>
                        ) : (
                            messages.map((msg, idx) => {
                                const agent = getAgent(msg.agentId);
                                const isUser = msg.agentId === "USER";
                                const isSystem = msg.agentId === "SYSTEM";
                                // Left-right alternation: even index = left, odd = right (for AI agents)
                                const isLeft = isUser ? false : idx % 2 === 0;

                                return (
                                    <div key={msg.id} className={cn(
                                        "flex gap-2 sm:gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 w-full sm:max-w-[85%]",
                                        isUser ? "flex-row-reverse ml-auto pl-8 sm:pl-0" :
                                            isLeft ? "mr-auto pr-8 sm:pr-0" : "flex-row-reverse ml-auto pl-8 sm:pl-0"
                                    )}>
                                        {/* Avatar */}
                                        {!isUser && !isSystem && (
                                            <div className="hidden sm:block">
                                                {renderAvatar(agent)}
                                            </div>
                                        )}

                                        {isSystem && (
                                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xl bg-gold-500/20 border border-gold-500 shrink-0 text-gold-500 hidden sm:flex">
                                                <Activity className="w-4 h-4 sm:w-5 sm:h-5" />
                                            </div>
                                        )}

                                        {isUser && (
                                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xl bg-gold-400/20 border border-gold-400 shrink-0 text-gold-400 hidden sm:flex">
                                                <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
                                            </div>
                                        )}

                                        {/* Message content */}
                                        <div className={cn("flex-1 group max-w-full", isUser || !isLeft ? "text-right" : "text-left")}>
                                            <div className={cn("flex items-center gap-2 mb-1 px-1", isUser || !isLeft ? "justify-end" : "justify-start")}>
                                                <span className={cn("text-xs sm:text-sm font-bold")} style={{ color: agent?.color || (isUser ? "#FFD700" : isSystem ? "#FF9D00" : undefined) }}>
                                                    {isUser ? "USER" : isSystem ? "SYSTEM" : agent?.name}
                                                </span>
                                                {!isUser && !isSystem && (
                                                    <span className="text-[9px] sm:text-[10px] text-gray-500 border border-white/10 px-1 rounded bg-black/50 font-mono uppercase">
                                                        {agent?.role}
                                                    </span>
                                                )}
                                                <span className="text-[9px] sm:text-[10px] text-gray-600 font-mono opacity-50 group-hover:opacity-100 transition-opacity">
                                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                            <div className={cn(
                                                "text-sm sm:text-base p-2.5 sm:p-3 rounded-2xl border backdrop-blur-sm shadow-md inline-block text-left",
                                                isUser ? "bg-emerald-600/20 border-emerald-500/30 text-emerald-50 rounded-tr-none" :
                                                    isLeft ? "rounded-tl-none bg-zinc-800/80 border-white/10 text-zinc-100" : "rounded-tr-none bg-zinc-800/80 border-white/10 text-zinc-100",
                                                msg.type === "ALERT" ? "bg-red-500/20 border-red-500/30 text-red-100" :
                                                    msg.type === "EXECUTION" ? "bg-blue-600/20 border-blue-500/30 text-blue-100 shadow-[0_0_10px_rgba(30,144,255,0.1)]" :
                                                        isSystem ? "bg-zinc-900/90 border-gold-500/30 text-gold-200" : ""
                                            )}>
                                                {renderFormattedContent(msg.content.replace(/Provider/g, ""))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <div className="mt-auto border-t border-white/10 pt-4 flex items-center gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="AIエージェントに指示を送信..."
                            className="flex-1 bg-black/30 border border-gold-500/30 rounded-md px-4 py-2 text-sm focus:outline-none focus:border-gold-500/70 text-white font-mono placeholder:text-gray-600"
                        />
                        <button
                            onClick={handleSend}
                            className="p-2 rounded-md bg-gold-500/20 text-gold-500 border border-gold-500/50 hover:bg-gold-500/30 transition-colors shadow-[0_0_10px_rgba(255,215,0,0.2)]"
                        >
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                </>
            ) : (
                // ARCHIVE CONTENT
                <div className="flex-1 overflow-y-auto pr-2 space-y-4 my-4 custom-scrollbar mt-12">
                    {discussionHistory.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500">
                            <History className="w-12 h-12 mb-4 opacity-50" />
                            <p>保存された議論履歴はありません</p>
                            <p className="text-xs mt-2 text-gray-600">ダッシュボードでDEXを選択して議論を開始すると表示されます</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {discussionHistory.map((discussion) => (
                                <div key={discussion.id} className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors group">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg border border-blue-500/30">
                                                <FileText className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-white text-sm">
                                                    {discussion.source === "council" ? "評議会戦略会議" : `市場分析: ${discussion.pair}`}
                                                </h4>
                                                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                                                    <Clock className="w-3 h-3" />
                                                    {new Date(discussion.timestamp).toLocaleString()}
                                                    <span className="w-1 h-1 bg-gray-600 rounded-full" />
                                                    {discussion.messages.length} messages
                                                </div>
                                            </div>
                                        </div>
                                        {discussion.result && (
                                            <div className={cn("px-2 py-1 rounded text-xs font-bold border",
                                                discussion.result.action === "BUY" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                                                    discussion.result.action === "SELL" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                                        "bg-gray-500/20 text-gray-400 border-gray-500/30"
                                            )}>
                                                {discussion.result.action} {discussion.result.confidence}%
                                            </div>
                                        )}
                                    </div>

                                    <div className="pl-12">
                                        <div className="text-xs text-gray-400 line-clamp-2 italic bg-black/20 p-2 rounded border border-white/5">
                                            {discussion.result?.reasoning || discussion.messages[discussion.messages.length - 1]?.content || ""}
                                        </div>
                                    </div>

                                    <div className="mt-3 pl-12 flex gap-1">
                                        {Array.from(new Set(discussion.messages.map(m => m.agentId))).map(agentId => {
                                            const agent = getAgent(agentId);
                                            if (!agent) return null;
                                            return (
                                                <div key={agentId}>
                                                    {renderAvatar(agent)}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}
