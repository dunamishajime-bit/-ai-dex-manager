"use client";

import { useState, useEffect, useRef } from "react";
import { AIAgent, AgentMessage, DiscussionResult } from "@/lib/ai-agents";
import { useAgents } from "@/context/AgentContext";
import { useSimulation } from "@/context/SimulationContext";
import { playAIVoice } from "@/lib/audio-service";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { Volume2, VolumeX, Shield, Play, Pause, ChevronRight, Sparkles, Target, TrendingUp, Trash2 } from "lucide-react";
import { Achievement } from "@/components/features/AchievementHub";

interface AgentCouncilProps {
    messages: AgentMessage[];
    result: DiscussionResult | null;
    symbol?: string;
    onComplete?: () => void;
    isAutoPlay?: boolean;
}

export function AgentCouncil({ messages, result, symbol, onComplete, isAutoPlay = true }: AgentCouncilProps) {
    const { getAgent, setIsCouncilActive } = useAgents();
    const { portfolio, clearMessages, executeTrade, setIsDemoMode } = useSimulation();
    const [tradeRequested, setTradeRequested] = useState(false);

    // Determine Aura color based on portfolio PnL
    const pnl = portfolio.totalValue - 1000000; // Assuming 1M initial
    const auraColor = pnl > 0 ? "emerald" : pnl < 0 ? "rose" : "gold";

    const [currentIndex, setCurrentIndex] = useState(0);
    const [displayedText, setDisplayedText] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [isWaiting, setIsWaiting] = useState(false); // 5-second pause
    const [countdown, setCountdown] = useState(0); // For visualizing the pause
    const [isSoundEnabled, setIsSoundEnabled] = useState(false);
    const [atmosphere, setAtmosphere] = useState<"NEUTRAL" | "POSITIVE" | "NEGATIVE" | "ALERT">("NEUTRAL");
    const [achievements, setAchievements] = useState<Achievement[]>([
        { id: "first-trade", title: "初陣の証", description: "最初の自動トレードを実行する", icon: null, unlocked: false, rarity: "COMMON" },
        { id: "profit-100", title: "利益の芽", description: "累計利益 ¥100 を達成する", icon: null, unlocked: false, rarity: "COMMON", progress: 0, target: 100 },
        { id: "win-streak-3", title: "連勝街道", description: "3回連続でプラスの取引を完了する", icon: null, unlocked: false, rarity: "RARE", progress: 0, target: 3 },
    ]);
    const [playbackStarted, setPlaybackStarted] = useState(false);
    const [round, setRound] = useState(isAutoPlay ? 1 : (messages[messages.length - 1]?.round || 3));
    const [finished, setFinished] = useState(!isAutoPlay);

    const scrollRef = useRef<HTMLDivElement>(null);
    const processingRef = useRef(false); // To prevent double triggers

    // Auto-scroll to bottom of chat
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [displayedText, currentIndex]);

    // Start playback when autoPlay is true or manually started
    useEffect(() => {
        if (isAutoPlay && !playbackStarted && messages.length > 0) {
            setPlaybackStarted(true);
            processMessage(0);
        } else if (!isAutoPlay && messages.length > 0) {
            // If not autoPlay (History mode), jump to end
            setCurrentIndex(messages.length - 1);
            setPlaybackStarted(true);
            setFinished(true);
        }
    }, [isAutoPlay, messages]);

    // Main Message Processing Chain
    const processMessage = async (index: number) => {
        if (index >= messages.length) {
            setFinished(true);
            setIsCouncilActive(false); // Council finished
            onComplete?.();
            return;
        }

        if (index === 0) setIsCouncilActive(true); // Council started

        processingRef.current = true;
        setCurrentIndex(index);
        const msg = messages[index];
        setRound(msg.round || 1);

        const agent = getAgent(msg.agentId);

        // --- 1. Typing & Reading Phase ---
        setIsTyping(true);
        setDisplayedText(""); // Clear for new bubble or just show animated

        // Start Audio (Web Speech TTS)
        const audioPromise = agent && agent.voiceId && isSoundEnabled
            ? playAIVoice(msg.content, agent.voiceId, false) // Pass false for muted if isSoundEnabled is true
            : new Promise<void>(r => setTimeout(r, msg.content.length * 50)); // Fallback timing

        // Start Typing Animation (Visual only, faster than audio usually)
        let charIndex = 0;
        const typeInterval = setInterval(() => {
            if (charIndex <= msg.content.length) {
                setDisplayedText(msg.content.substring(0, charIndex));
                charIndex++;
            } else {
                clearInterval(typeInterval);
            }
        }, 80); // Slower typing speed as requested (was 30)

        // Wait for Audio to Finish
        await audioPromise;

        clearInterval(typeInterval);
        setDisplayedText(msg.content); // Ensure full text is shown
        setIsTyping(false);

        // --- 2. Post-Speech Pause (5 seconds) ---
        // User Requirement: "Wait 5 seconds after speech finishes before next agent types"
        if (index < messages.length - 1) {
            await new Promise(r => setTimeout(r, 5000));
            // --- 3. Next Message ---
            processingRef.current = false;
            processMessage(index + 1);
        } else {
            setFinished(true);
            onComplete?.();
        }
    };

    const handleAutoTrade = async () => {
        if (!result || !symbol || tradeRequested) return;

        try {
            const amount = result.autoTradeProposal?.amount || 0.1;
            const price = result.autoTradeProposal?.entryPrice || 0; // Fallback or handle

            const success = await executeTrade(
                symbol,
                result.action as "BUY" | "SELL",
                amount,
                price > 0 ? price : 1, // Fallback price if 0 (should not happen with real data)
                `AI評議会アーカイブ実行: ${result.reasoning}`
            );

            if (success) {
                setTradeRequested(true);
            }
        } catch (e) {
            console.error("Auto trade execution failed", e);
        }
    };

    const skipDelay = () => {
        // Only works during waiting phase
        if (isWaiting) {
            setCountdown(0);
            // The loop in processMessage won't be broken, but we can't easily interrupt the promise chain without more complex logic.
            // For MVP, we might just have to wait or implement a thorough cancellation token system.
            // Actually, simpler: we can't easily skip the active 'await' loop.
            // Let's just visually skip, but logic needs refactoring to support "force next".
            // Since this is a complex state machine, for now we assume automatic flow.
        }
    };

    const activeMsg = messages[currentIndex];
    const activeAgent = activeMsg ? getAgent(activeMsg.agentId) : null;

    // Group messages by round for History View
    const historyMessages = messages.slice(0, currentIndex + (isTyping || isWaiting ? 0 : 1));

    return (
        <div className="flex flex-col h-[700px] w-full max-w-6xl mx-auto gap-4">

            {/* Header / Rounds Indicator */}
            <div className="flex items-center justify-between bg-black/40 p-4 rounded-xl border border-white/5 backdrop-blur-sm">
                <div className="flex items-center gap-6">
                    <h2 className="text-xl font-bold bg-gradient-to-r from-gold-400 to-white bg-clip-text text-transparent flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-gold-400" />
                        AI COUNCIL DEBATE
                    </h2>
                    <div className="flex gap-2">
                        {[1, 2, 3].map(r => (
                            <div key={r} className={cn(
                                "px-3 py-1 rounded-full text-xs font-mono font-bold border transition-all duration-500",
                                round === r
                                    ? "bg-gold-500 text-black border-gold-500"
                                    : round > r
                                        ? "bg-gold-500/20 text-gold-500 border-gold-500/30"
                                        : "bg-black/40 text-gray-600 border-white/5"
                            )}>
                                ROUND {r}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => {
                            if (window.confirm("チャット履歴をすべて削除しますか？")) {
                                clearMessages();
                            }
                        }}
                        className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors"
                        title="Clear Chat History"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>

                    <button
                        onClick={() => setIsSoundEnabled(!isSoundEnabled)}
                        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    >
                        {!isSoundEnabled ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>

                    {!playbackStarted && (
                        <button
                            onClick={() => { setPlaybackStarted(true); processMessage(0); }}
                            className="px-4 py-2 bg-gold-500 hover:bg-gold-400 text-black font-bold text-sm rounded-lg flex items-center gap-2 transition-all"
                        >
                            <Play className="w-4 h-4" /> Start Debate
                        </button>
                    )}
                </div>
            </div>

            <div className="flex flex-1 gap-6 min-h-0">
                {/* LEFT: Active Speaker (Focus) */}
                <div className="w-1/3 flex flex-col gap-4">
                    <Card className="flex-1 relative overflow-hidden flex flex-col items-center justify-center p-6 border-gold-500/20 bg-black/60">
                        {/* Background Effects */}
                        <div className={cn(
                            "absolute inset-0 transition-opacity duration-1000",
                            activeAgent ? `bg-gradient-to-b from-${activeAgent.color.replace('text-', '')}/10 to-transparent` : ""
                        )} />

                        {activeAgent && !finished ? (
                            <>
                                <div className="relative z-10 w-32 h-32 mb-6">
                                    <div className={cn(
                                        "absolute inset-0 rounded-full blur-xl opacity-50 animate-pulse",
                                        activeAgent.color.replace('text-', 'bg-')
                                    )} />
                                    {/* Evolution Aura Effect */}
                                    {activeAgent.level > 5 && (
                                        <div className={cn(
                                            "absolute inset-0 rounded-full animate-pulse-slow p-1", // Added padding to make aura slightly larger than image
                                            activeAgent.level > 10 ? "shadow-[0_0_30px_rgba(255,215,0,0.5)]" : "shadow-[0_0_20px_rgba(52,211,153,0.5)]" // Gold for >10, Emerald for >5
                                        )}>
                                            <div className={cn(
                                                "absolute inset-0 rounded-full border-2 animate-ping opacity-20",
                                                activeAgent.level > 10 ? "border-gold-500" : "border-emerald-500"
                                            )} />
                                        </div>
                                    )}
                                    <img
                                        src={activeAgent.avatar}
                                        alt={activeAgent.name}
                                        className={cn(
                                            "relative w-full h-full rounded-full border-4 object-cover",
                                            activeAgent.borderColor,
                                            isTyping && "animate-speak" // Custom animation for "speaking"
                                        )}
                                    />
                                    {isWaiting && (
                                        <div className="absolute -bottom-2 -right-2 bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded-full border border-white/10 flex items-center gap-1 z-20">
                                            <span>NEXT</span>
                                            <span className="w-4 text-center">{countdown}</span>
                                        </div>
                                    )}

                                    {/* Level Badge */}
                                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-black border border-gold-500/50 px-3 py-0.5 rounded-full z-20 flex items-center gap-1 shadow-[0_0_10px_rgba(234,179,8,0.3)]">
                                        <span className="text-[10px] font-black text-gold-400">Lv.{activeAgent.level}</span>
                                        <div className="w-12 h-1 bg-gray-800 rounded-full overflow-hidden">
                                            <div className="h-full bg-gold-500" style={{ width: `${(activeAgent.exp % 100)}%` }} />
                                        </div>
                                    </div>
                                </div>

                                <div className="z-10 text-center space-y-2">
                                    <span className={cn("text-xs font-bold px-2 py-1 rounded bg-black/40 border", activeAgent.borderColor, activeAgent.color)}>
                                        {activeAgent.role}
                                    </span>
                                    <h3 className="text-2xl font-bold text-white tracking-wider">{activeAgent.name}</h3>
                                    <p className="text-gray-400 text-xs italic">"{activeAgent.personality.substring(0, 40)}..."</p>
                                </div>
                            </>
                        ) : finished && result ? (
                            <div className="z-10 text-center space-y-4">
                                <Shield className="w-20 h-20 text-gold-400 mx-auto animate-bounce-slow" />
                                <h3 className="text-2xl font-bold text-white">DEBATE CONCLUDED</h3>
                                <p className="text-gray-400">Final Verdict Reached</p>
                            </div>
                        ) : (
                            <div className="z-10 text-center text-gray-500">
                                <p>Waiting to start...</p>
                            </div>
                        )}
                    </Card>

                    {/* Current Stats / Live Risk Score (Example) */}
                    <div className="h-32 bg-black/40 rounded-xl border border-white/10 p-4 flex items-center justify-around">
                        <div className="text-center">
                            <label className="text-[10px] text-gray-500 uppercase font-bold">Current Round</label>
                            <div className="text-3xl font-mono text-white">{round}/3</div>
                        </div>
                        <div className="h-10 w-px bg-white/10" />
                        <div className="text-center">
                            <label className="text-[10px] text-gray-500 uppercase font-bold">Status</label>
                            <div className={cn(
                                "text-sm font-bold flex items-center gap-2",
                                isTyping ? "text-green-400" : isWaiting ? "text-yellow-400" : "text-gray-400"
                            )}>
                                {isTyping ? "SPEAKING" : "THINKING"}
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT: Chat Stream */}
                <Card className="w-2/3 h-full overflow-hidden flex flex-col bg-black/40 backdrop-blur-md border-white/5 relative">
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth" ref={scrollRef}>
                        {historyMessages.map((msg, idx) => {
                            const agent = getAgent(msg.agentId);
                            const isLast = idx === currentIndex;
                            if (!agent) return null;

                            const isCoord = agent.id === "coordinator" || agent.id === "manager";
                            const textToShow = (isLast && isTyping) ? displayedText : msg.content;
                            const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                            return (
                                <div key={msg.id} className={cn(
                                    "flex w-full mb-4 animate-in fade-in slide-in-from-bottom-4 duration-500",
                                    isCoord ? "justify-end" : "justify-start"
                                )}>
                                    <div className={cn(
                                        "flex max-w-[85%] md:max-w-[70%] gap-2",
                                        isCoord ? "flex-row-reverse" : "flex-row"
                                    )}>
                                        {!isCoord && (
                                            <div className="shrink-0 self-end mb-1">
                                                <div className="relative">
                                                    <img
                                                        src={agent.avatar}
                                                        className={cn("w-8 h-8 rounded-full border border-white/10 relative z-10 shadow-lg", agent.borderColor)}
                                                    />
                                                    <div className={cn("absolute inset-0 rounded-full blur-sm opacity-40 animate-pulse", agent.color.replace('text-', 'bg-'))} />
                                                </div>
                                            </div>
                                        )}

                                        <div className={cn(
                                            "relative p-3 rounded-2xl shadow-xl flex flex-col min-w-[120px] backdrop-blur-md border",
                                            isCoord
                                                ? "bg-gold-500/20 border-gold-500/30 text-white rounded-tr-none ml-10"
                                                : "bg-[#2b2b2b]/80 border-white/5 text-gray-100 rounded-tl-none mr-10",
                                            isLast && isTyping && "ring-1 ring-gold-400/50"
                                        )}>
                                            {/* Telegram-style tail */}
                                            <div className={cn(
                                                "absolute top-0 w-3 h-3",
                                                isCoord
                                                    ? "-right-1 bg-gold-500/20 clip-path-right-tail border-r border-gold-500/30"
                                                    : "-left-1 bg-[#2b2b2b]/80 clip-path-left-tail border-l border-white/5"
                                            )} />

                                            <div className="flex items-center justify-between mb-1 gap-4">
                                                <span className={cn("text-[10px] font-black tracking-widest uppercase opacity-70", agent.color)}>
                                                    {agent.name}
                                                </span>
                                                <span className="text-[9px] font-bold text-white/30 px-1 bg-white/5 rounded">
                                                    LV.{agent.level}
                                                </span>
                                            </div>

                                            <div className="text-[13px] md:text-[14px] leading-relaxed break-words whitespace-pre-wrap">
                                                {textToShow}
                                                {isLast && isTyping && (
                                                    <span className="inline-block w-1.5 h-3 bg-gold-400 ml-1 animate-pulse" />
                                                )}
                                            </div>

                                            <div className="flex items-center justify-end mt-1 gap-1">
                                                <span className="text-[9px] text-white/40 font-mono italic">{time}</span>
                                                {isCoord && <div className="text-[10px] text-gold-500">✓✓</div>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Final Result Overlay (In-chat or separate?) - Let's put a big block at end if finished */}
                        {finished && result && (
                            <div className="mt-8 p-6 rounded-xl bg-gradient-to-br from-gold-500/10 to-black border border-gold-500/30 animate-in zoom-in duration-700">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                        <Shield className="text-gold-400" />
                                        FINAL VERDICT
                                    </h3>
                                    <div className={cn(
                                        "px-4 py-1 rounded text-lg font-black tracking-wider border",
                                        result.action === "BUY" ? "bg-green-500/20 text-green-400 border-green-500/50" :
                                            result.action === "SELL" ? "bg-red-500/20 text-red-400 border-red-500/50" :
                                                "bg-gray-500/20 text-gray-300 border-gray-500/50"
                                    )}>
                                        {result.action}
                                    </div>
                                </div>

                                <p className="text-gray-300 text-sm leading-relaxed mb-6 border-l-2 border-gold-500/40 pl-4">
                                    {result.reasoning}
                                </p>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-black/30 p-3 rounded border border-white/5">
                                        <label className="text-[10px] text-gray-500 uppercase">Confidence</label>
                                        <div className="text-2xl font-mono text-gold-400">{result.confidence}%</div>
                                        <div className="w-full bg-gray-800 h-1 mt-1 rounded-full overflow-hidden">
                                            <div className="h-full bg-gold-400" style={{ width: `${result.confidence}%` }} />
                                        </div>
                                    </div>
                                    <div className="bg-black/30 p-3 rounded border border-white/5">
                                        <label className="text-[10px] text-gray-500 uppercase">MVP Agent</label>
                                        <div className="text-lg font-bold text-white flex items-center gap-2">
                                            {getAgent(result.mvpAgent || "")?.shortName || "Coord"}
                                        </div>
                                    </div>
                                </div>

                                {/* Trade Proposal Details (Always show if exists) */}
                                {result.autoTradeProposal && (
                                    <div className="mt-4 p-4 bg-white/5 border border-white/10 rounded-lg space-y-3">
                                        <div className="flex items-center gap-2 text-gold-400 font-bold text-xs uppercase tracking-wider mb-2">
                                            <Target className="w-4 h-4" /> 提案トレード戦略
                                        </div>
                                        <div className="result-grid-3">
                                            <div className="bg-black/40 p-2 rounded border border-white/5 text-center">
                                                <div className="text-[10px] text-gray-500 uppercase">エントリー</div>
                                                <div className="text-sm font-mono text-white">¥{result.autoTradeProposal.entryPrice.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-emerald-500/10 p-2 rounded border border-emerald-500/20 text-center">
                                                <div className="text-[10px] text-emerald-400 uppercase">利確目標</div>
                                                <div className="text-sm font-mono text-emerald-400">¥{result.autoTradeProposal.targetPrice.toLocaleString()}</div>
                                            </div>
                                            <div className="bg-red-500/10 p-2 rounded border border-red-500/20 text-center">
                                                <div className="text-[10px] text-red-400 uppercase">損切ライン</div>
                                                <div className="text-sm font-mono text-red-400">¥{result.autoTradeProposal.stopLoss.toLocaleString()}</div>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-400 italic">
                                            根拠: {result.autoTradeProposal.reason}
                                        </div>
                                    </div>
                                )}

                                {/* Action Buttons - Ignore confidence to show at least Demo button */}
                                <div className="flex gap-4 mt-6">
                                    {result.confidence >= 70 && (
                                        <button
                                            onClick={handleAutoTrade}
                                            disabled={tradeRequested}
                                            className={cn(
                                                "flex-1 py-3 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-lg transition-colors flex items-center justify-center gap-2",
                                                tradeRequested && "opacity-50 grayscale cursor-not-allowed"
                                            )}
                                        >
                                            <Play className="w-4 h-4" />
                                            {tradeRequested ? "実行済み" : "戦略を自動実行"}
                                        </button>
                                    )}
                                    <a
                                        href="/strategy"
                                        className={cn(
                                            "flex-1 py-3 font-bold rounded-lg border transition-colors flex items-center justify-center gap-2",
                                            result.confidence < 70
                                                ? "bg-gold-500/20 text-gold-400 border-gold-500/40 hover:bg-gold-500/30"
                                                : "bg-white/10 hover:bg-white/20 text-gold-400 border-gold-500/30"
                                        )}
                                    >
                                        <TrendingUp className="w-4 h-4" /> 戦略管理・デモを表示
                                    </a>
                                </div>
                            </div>
                        )}
                    </div>
                </Card>
            </div>
        </div>
    );
}
