"use client";

import { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft, Bot, Wallet, BarChart3, Shield, Zap, TrendingUp, Smartphone, FileText, Volume2, VolumeX, LineChart, Hash, Globe } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { motion, AnimatePresence } from "framer-motion";

const tutorialSteps = [
    {
        title: "運営責任者: ディス (Operation Manager)",
        description: "ようこそ、DIS-DEX Managerへ。私は運営責任者のディスです。全エージェントを統括し、あなたの資産形成をサポートします。これから、頼れる4人の仲間たちを紹介させてください。",
        icon: Bot,
        color: "shadow-gold-500/50",
        agentId: "manager",
        bgImage: "/backgrounds/tutorial_manager.png",
        voiceFile: "/audio/tutorial/mp3-step0_dis.mp3",
    },
    {
        title: "テクニカル・アナリスト: テック (Tech)",
        description: "最高精度のテクニカル指標を駆使し、市場の微細な変化も見逃しません。私のチャート分析は、あなたのトレードに確かな根拠を与えます。",
        icon: LineChart,
        color: "shadow-blue-500/50",
        agentId: "technical",
        bgImage: "/backgrounds/tutorial_tech.png",
        voiceFile: "/audio/tutorial/mp3-step1_tech.mp3",
    },
    {
        title: "センチメント・スキャナ: セント (Sent)",
        description: "SNSやニュースから、市場の『熱狂』と『恐怖』を読み取ります。大衆心理の先回りこそが、爆発的な利益を生む鍵となります。",
        icon: Hash,
        color: "shadow-pink-500/50",
        agentId: "sentiment",
        bgImage: "/backgrounds/tutorial_sent.png",
        voiceFile: "/audio/tutorial/mp3-step2_sent.mp3",
    },
    {
        title: "ファンダメンタル・リサーチャー: ビズ (Biz)",
        description: "プロジェクトの本質的な価値と資金状況を徹底調査します。一過性の流行に惑わされない、長期的な成長性を見極めるのが私の役割です。",
        icon: Globe,
        color: "shadow-emerald-500/50",
        agentId: "fundamental",
        bgImage: "/backgrounds/tutorial_biz.png",
        voiceFile: "/audio/tutorial/mp3-step3_biz.mp3",
    },
    {
        title: "セーフティ・ガード: セック (Sec)",
        description: "あなたの資産を守ることが私の最優先事項です。不審なコントラクトやラグプルの兆候を24時間体制で監視し、リスクを排除します。",
        icon: Shield,
        color: "shadow-red-500/50",
        agentId: "security",
        bgImage: "/backgrounds/tutorial_sec.png",
        voiceFile: "/audio/tutorial/mp3-step4_sec.mp3",
    },
    {
        title: "統括AI: コーディ (Coord)",
        description: "個性豊かなメンバーですが、彼らの能力は本物です。私たちが議論を戦わせ、導き出した結論は、あなたのポートフォリオを確実に成長させるでしょう。",
        icon: Zap,
        color: "shadow-white/50",
        agentId: "coordinator",
        bgImage: "/backgrounds/tutorial_coord.png",
        voiceFile: "/audio/tutorial/mp3-step5_coord.mp3",
    },
    {
        title: "運営責任者: ディス (Operation Manager)",
        description: "さあ、右上のボタンからウォレットを接続して、未来のトレーディングを始めましょう。",
        icon: Wallet,
        color: "shadow-neon-blue/50",
        agentId: "manager",
        bgImage: "/backgrounds/tutorial_manager.png",
        voiceFile: "/audio/tutorial/mp3-step6_dis.mp3",
    }
];

export function TutorialPopup() {
    const { user } = useAuth();
    const [show, setShow] = useState(false);
    const [step, setStep] = useState(0);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (mounted && user) {
            const key = `disdex_tutorial_seen_${user.id}`;
            const seen = localStorage.getItem(key);
            if (!seen) {
                setTimeout(() => setShow(true), 1500);
            }
        }
    }, [mounted, user]);

    const handleClose = () => {
        setShow(false);
        if (user) {
            localStorage.setItem(`disdex_tutorial_seen_${user.id}`, "true");
        }
        // Ensure redirect to DEX Ticker (/) to avoid 404 or stuck state
        import("next/navigation").then(({ useRouter }) => {
            // We can't use hook inside callback easily if not defined, but logic is fine
            // Actually better to use window.location or router from scope
        });
        window.location.href = "/";
    };

    const handleNext = () => {
        if (step < tutorialSteps.length - 1) {
            setStep(step + 1);
        } else {
            handleClose();
        }
    };

    const handleBack = () => {
        if (step > 0) {
            setStep(step - 1);
        }
    };

    // Helper to get voice ID from agent ID
    const getAgentVoiceId = (agentId: string) => {
        switch (agentId) {
            case "technical": return "fable";
            case "sentiment": return "coral";
            case "security": return "onyx";
            case "fundamental": return "echo";
            case "coordinator": return "nova";
            default: return "alloy";
        }
    };

    const getAgentName = (agentId: string) => {
        switch (agentId) {
            case "technical": return "技術分析官: テック";
            case "sentiment": return "センチメント・スキャン: セント";
            case "fundamental": return "ファンダメンタル分析: ビズ";
            case "security": return "防御・防壁: セック";
            case "manager": return "運営責任者: ディス";
            case "coordinator": return "統括管理: コーディ";
            default: return "AIコーディネーター: ディス";
        }
    };

    const getAgentProfile = (agentId: string) => {
        switch (agentId) {
            case "technical": return {
                status: "正常稼働中",
                expertise: "チャート・指標分析",
                strategy: "スキャルピング (超短期)",
                traits: ["#データ主義", "#客観的"]
            };
            case "sentiment": return {
                status: "SNS同期中",
                expertise: "心理・トレンド分析",
                strategy: "トレンドフォロー (順張り)",
                traits: ["#情報通", "#直感的"]
            };
            case "fundamental": return {
                status: "リサーチ中",
                expertise: "価値・資金管理",
                strategy: "スイングトレード (中長期)",
                traits: ["#分析的", "#慎重"]
            };
            case "security": return {
                status: "脅威監視中",
                expertise: "リスク・脆弱性防御",
                strategy: "リスクヘッジ (守備重視)",
                traits: ["#鉄壁", "#疑い深い"]
            };
            case "manager": return {
                status: "運営統括中",
                expertise: "戦略立案・最終報告",
                strategy: "アグレッシブ (利益追求)",
                traits: ["#大胆不敵", "#カリスマ"]
            };
            case "coordinator": return {
                status: "議論調整中",
                expertise: "意思決定・中立評価",
                strategy: "インデックス・バランス運用",
                traits: ["#中立的", "#論理的"]
            };
            default: return {
                status: "待機中",
                expertise: "汎用分析",
                strategy: "マーケット・フォロー",
                traits: ["#サポート"]
            };
        }
    };

    const getAvatarSrc = (agentId: string) => {
        switch (agentId) {
            case "technical": return "/avatars/tech.png";
            case "sentiment": return "/avatars/sent.png";
            case "fundamental": return "/avatars/biz.png";
            case "security": return "/avatars/sec.png";
            case "manager": return "/avatars/coord.png"; // Dis uses coord.png (oji-san)
            case "coordinator": return "/avatars/coord_original.png"; // Coord uses original
            default: return "/avatars/coord.png";
        }
    };



    const [isMuted, setIsMuted] = useState(false);

    // Audio Playback Logic removed
    useEffect(() => {
        // Voice features removed
    }, [step, show, mounted]);

    if (!show || !mounted) return null;

    const current = tutorialSteps[step];
    const Icon = current.icon;

    return (
        <AnimatePresence>
            {show && mounted && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    {/* Full Screen Background Image */}
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={current.bgImage}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.8 }}
                            className="absolute inset-0 z-[-1]"
                        >
                            <img
                                src={current.bgImage}
                                alt="tutorial-bg"
                                className="w-full h-full object-cover opacity-60 scale-105"
                                style={{ filter: 'brightness(0.3) contrast(1.1)' }}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.opacity = '0';
                                }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-black" />
                            <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" />
                        </motion.div>
                    </AnimatePresence>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-lg bg-[#121214]/90 border border-gold-500/30 rounded-2xl shadow-[0_0_50px_rgba(255,215,0,0.15)] overflow-hidden backdrop-blur-xl"
                    >
                        <div className="p-6 relative z-10">
                            {/* Navigation Header */}
                            <div className="flex justify-between items-center mb-6">
                                <button
                                    onClick={handleBack}
                                    disabled={step === 0}
                                    className={`p-2 rounded-full hover:bg-white/10 transition-colors ${step === 0 ? "opacity-30 cursor-not-allowed" : "text-gray-400"}`}
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <div className="flex gap-1.5 items-center">
                                    {tutorialSteps.map((_, i) => (
                                        <div
                                            key={i}
                                            className={`h-1 rounded-full transition-all duration-300 ${i === step ? "w-6 bg-gold-500" : "w-1 bg-white/20"}`}
                                        />
                                    ))}
                                </div>
                                <button
                                    onClick={handleNext}
                                    className="p-2 rounded-full hover:bg-gold-500/20 text-gold-400 transition-colors"
                                >
                                    {step === tutorialSteps.length - 1 ? <X className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                                </button>
                            </div>

                            {/* Main Content */}
                            <div className="text-center mb-6">
                                <div className={`w-24 h-24 mx-auto mb-4 bg-black/50 rounded-full flex items-center justify-center border border-gold-500/30 shadow-[0_0_30px_rgba(255,215,0,0.1)] animate-float overflow-hidden`}>
                                    <img
                                        src={getAvatarSrc(current.agentId || "coordinator")}
                                        alt={current.title}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <h3 className="text-2xl font-bold text-white mb-2 tracking-wide font-mono">
                                    {current.title}
                                </h3>
                                <p className="text-base text-gray-300 leading-relaxed font-light">
                                    {current.description}
                                </p>
                            </div>

                            {/* AI Profile Area - 2x2 Grid Redesign */}
                            <div className="mb-6 p-6 bg-black/60 rounded-xl border border-gold-500/20 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-2 opacity-30 group-hover:opacity-100 transition-opacity">
                                    <Zap className="w-4 h-4 text-gold-500 animate-pulse" />
                                </div>

                                <div className="grid grid-cols-2 gap-x-10 gap-y-6">
                                    {/* Column 1: Status & Strategy */}
                                    <div className="space-y-5">
                                        <div className="space-y-1.5">
                                            <span className="text-[11px] text-gray-500 font-bold uppercase tracking-widest font-mono">状況 / Status</span>
                                            <div className="text-lg text-emerald-400 font-bold flex items-center gap-2">
                                                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                                {getAgentProfile(current.agentId || "coordinator").status}
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[11px] text-gray-500 font-bold uppercase tracking-widest font-mono">戦略 / Strategy</span>
                                            <div className="text-lg text-cyan-300 font-bold">
                                                {getAgentProfile(current.agentId || "coordinator").strategy}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Column 2: Expertise & Traits */}
                                    <div className="space-y-5">
                                        <div className="space-y-1.5">
                                            <span className="text-[11px] text-gray-500 font-bold uppercase tracking-widest font-mono">専門 / Expertise</span>
                                            <div className="text-lg text-gold-300 font-bold">
                                                {getAgentProfile(current.agentId || "coordinator").expertise}
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <span className="text-[11px] text-gray-500 font-bold uppercase tracking-widest font-mono">特徴 / Traits</span>
                                            <div className="flex flex-wrap gap-2">
                                                {getAgentProfile(current.agentId || "coordinator").traits.map(trait => (
                                                    <span key={trait} className="px-2 py-1 bg-gold-500/10 rounded text-xs text-gold-400/90 font-mono border border-gold-500/20">
                                                        {trait}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Bottom Controls */}
                            <div className="flex justify-between items-center px-2">
                                <button
                                    onClick={handleClose}
                                    className="text-sm text-gray-500 hover:text-white font-mono transition-colors uppercase tracking-widest"
                                >
                                    SKIP
                                </button>
                                <button
                                    onClick={handleNext}
                                    className="flex items-center gap-2 px-8 py-3 text-sm font-bold font-mono rounded-xl bg-gold-500 text-black hover:bg-gold-400 transition-all shadow-lg shadow-gold-500/20 active:scale-95"
                                >
                                    {step < tutorialSteps.length - 1 ? (
                                        <>
                                            NEXT
                                            <ChevronRight className="w-4 h-4" strokeWidth={3} />
                                        </>
                                    ) : (
                                        "LAUNCH 🚀"
                                    )}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
