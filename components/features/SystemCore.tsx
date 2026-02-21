"use client";

import { motion } from 'framer-motion';
import { useSimulation } from '@/context/SimulationContext';
import { cn } from '@/lib/utils';

export function SystemCore() {
    const { atmosphere } = useSimulation();

    const getCoreColor = () => {
        switch (atmosphere) {
            case "POSITIVE": return "text-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.3)]";
            case "NEGATIVE": return "text-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]";
            case "ALERT": return "text-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)]";
            default: return "text-gold-500 shadow-[0_0_30px_rgba(234,179,8,0.3)]";
        }
    };

    const getRotationSpeed = () => {
        switch (atmosphere) {
            case "POSITIVE": return 10;
            case "ALERT": return 2;
            case "NEGATIVE": return 15;
            default: return 20;
        }
    };

    return (
        <div className="flex flex-col items-center justify-center p-1 space-y-1">
            <div className="relative w-14 h-14 flex items-center justify-center">
                {/* Outer Ring 1 */}
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: getRotationSpeed(), repeat: Infinity, ease: "linear" }}
                    className={cn("absolute w-full h-full border border-dashed rounded-full opacity-20", getCoreColor())}
                />

                {/* Outer Ring 2 (Counter-rotate) */}
                <motion.div
                    animate={{ rotate: -360 }}
                    transition={{ duration: getRotationSpeed() * 1.5, repeat: Infinity, ease: "linear" }}
                    className={cn("absolute w-[80%] h-[80%] border border-double rounded-full opacity-30", getCoreColor())}
                />

                {/* Main Core Node */}
                <motion.div
                    animate={{
                        scale: [1, 1.1, 1],
                        opacity: [0.7, 1, 0.7]
                    }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className={cn("relative w-6 h-6 rounded-full bg-current flex items-center justify-center z-10 blur-[0.5px]", getCoreColor())}
                >
                    <div className="w-5 h-5 rounded-full bg-black/80 flex items-center justify-center relative overflow-hidden">
                        <div className={cn("w-1.5 h-1.5 rounded-full bg-current animate-pulse", getCoreColor())} />
                        {atmosphere === "ALERT" && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: [0, 1, 0] }}
                                transition={{ duration: 1, repeat: Infinity }}
                                className="absolute inset-0 bg-red-500/20"
                            />
                        )}
                    </div>
                </motion.div>

                {/* Orbital Dots */}
                {[...Array(3)].map((_, i) => (
                    <motion.div
                        key={i}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 5 + i * 2, repeat: Infinity, ease: "linear" }}
                        className="absolute w-full h-full"
                    >
                        <div className={cn("absolute top-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full", getCoreColor())}
                            style={{ marginTop: '-2px' }} />
                    </motion.div>
                ))}
            </div>

            <div className="text-center">
                <div className={cn("text-[7px] font-black tracking-widest uppercase mb-0", getCoreColor())}>
                    {atmosphere === "ALERT" ? "SYSTEM ALERT" : atmosphere === "POSITIVE" ? "OPTIMIZING" : "AI LOGIC"}
                </div>
                <div className="flex items-center gap-1 justify-center">
                    <span className="w-0.5 h-0.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[6px] text-gray-500 font-mono tracking-tighter">
                        SYNC: {getRotationSpeed()}ms
                    </span>
                </div>
            </div>
        </div>
    );
}
