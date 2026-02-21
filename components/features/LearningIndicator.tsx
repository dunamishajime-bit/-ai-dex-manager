"use client";

import React, { useEffect, useState } from "react";
import { useAgents, LearningEvent } from "@/context/AgentContext";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Sparkles, X } from "lucide-react";

export default function LearningIndicator() {
    const { learningEvents } = useAgents();
    const [visibleEvent, setVisibleEvent] = useState<LearningEvent | null>(null);

    useEffect(() => {
        if (learningEvents.length > 0) {
            const latest = learningEvents[0];
            // Only show if it's within the last 10 seconds
            if (Date.now() - latest.timestamp < 10000) {
                setVisibleEvent(latest);
                const timer = setTimeout(() => setVisibleEvent(null), 8000);
                return () => clearTimeout(timer);
            }
        }
    }, [learningEvents]);

    return (
        <div className="fixed top-24 right-6 z-[100] pointer-events-none">
            <AnimatePresence>
                {visibleEvent && (
                    <motion.div
                        initial={{ opacity: 0, x: 50, scale: 0.9 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
                        className="pointer-events-auto relative bg-slate-900/90 backdrop-blur-xl border border-gold-400/40 p-4 rounded-xl shadow-[0_0_30px_rgba(212,175,55,0.2)] max-w-sm overflow-hidden group"
                    >
                        {/* Shimmer Effect */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gold-400/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />

                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-gold-400/10 rounded-lg">
                                <Brain className="w-5 h-5 text-gold-400 animate-pulse" />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] uppercase tracking-widest text-gold-400 font-bold">Insight Acquired</span>
                                    <Sparkles className="w-3 h-3 text-gold-400" />
                                </div>
                                <h4 className="text-white font-bold text-sm mb-1">{visibleEvent.topic}</h4>
                                <p className="text-slate-400 text-xs leading-relaxed">
                                    {visibleEvent.content}
                                </p>
                            </div>
                            <button
                                onClick={() => setVisibleEvent(null)}
                                className="text-slate-500 hover:text-white transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Progress bar countdown */}
                        <motion.div
                            initial={{ width: "100%" }}
                            animate={{ width: "0%" }}
                            transition={{ duration: 8, ease: "linear" }}
                            className="absolute bottom-0 left-0 h-0.5 bg-gold-400"
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
