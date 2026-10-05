import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface CardProps {
    children: ReactNode;
    className?: string;
    title?: string;
    glow?: "none" | "primary" | "secondary" | "danger" | "success" | "gold";
    noHover?: boolean;
}

export function Card({ children, className, title, glow = "none", noHover = false }: CardProps) {
    const glowStyles = {
        none: "border-gold-500/20",
        primary: "shadow-[0_0_20px_rgba(255,215,0,0.15)] border-gold-500/50",
        secondary: "shadow-[0_0_20px_rgba(168,85,247,0.2)] border-purple-500/30",
        danger: "shadow-[0_0_20px_rgba(239,68,68,0.3)] border-red-500/30",
        success: "shadow-[0_0_20px_rgba(16,185,129,0.3)] border-emerald-500/30",
        gold: "shadow-[0_0_20px_rgba(255,215,0,0.3)] border-gold-500/30",
    };

    return (
        <div
            className={cn(
                "glass-panel rounded-xl p-6 relative overflow-hidden",
                !noHover && "card-3d shine-on-hover ring-glow",
                glowStyles[glow],
                className
            )}
        >
            {title && (
                <div className="mb-4 border-b border-gold-500/20 pb-2 flex justify-between items-center">
                    <h3 className="text-lg font-semibold tracking-wider text-gold-500 uppercase flex items-center gap-2 font-mono">
                        <span className="w-1 h-4 bg-gold-400 rounded-full inline-block shadow-[0_0_8px_rgba(255,215,0,0.8)]" />
                        {title}
                    </h3>
                </div>
            )}
            {children}
        </div>
    );
}
