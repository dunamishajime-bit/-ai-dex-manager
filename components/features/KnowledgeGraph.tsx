"use client";

import React, { useMemo } from "react";
import { useAgents } from "@/context/AgentContext";
import { motion } from "framer-motion";
import { Brain, Link as LinkIcon } from "lucide-react";

export default function KnowledgeGraph() {
    const { agents } = useAgents();

    // Map agents to positions in a circle
    const nodes = useMemo(() => {
        const center = { x: 200, y: 200 };
        const radius = 120;
        return agents.filter(a => a.id !== "manager").map((agent, i, arr) => {
            const angle = (i / arr.length) * Math.PI * 2;
            return {
                ...agent,
                x: center.x + Math.cos(angle) * radius,
                y: center.y + Math.sin(angle) * radius,
            };
        });
    }, [agents]);

    // Create connections based on role compatibility (mental model)
    const connections = useMemo(() => {
        const links = [];
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                // All agents share knowledge with Coordinator
                if (nodes[i].id === "coordinator" || nodes[j].id === "coordinator") {
                    links.push({ from: nodes[i], to: nodes[j], strength: 1 });
                }
                // Specific logical links
                else if (
                    (nodes[i].id === "technical" && nodes[j].id === "sentiment") ||
                    (nodes[i].id === "security" && nodes[j].id === "fundamental")
                ) {
                    links.push({ from: nodes[i], to: nodes[j], strength: 0.6 });
                }
            }
        }
        return links;
    }, [nodes]);

    return (
        <div className="bg-slate-900/40 backdrop-blur-md border border-white/10 rounded-2xl p-6 h-full flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 mb-6">
                <Brain className="w-5 h-5 text-gold-400" />
                <h3 className="text-white font-bold tracking-wider uppercase text-sm">Knowledge Network</h3>
            </div>

            <div className="flex-1 relative flex items-center justify-center">
                <svg viewBox="0 0 400 400" className="w-full h-full max-w-[300px]">
                    {/* Connection Lines */}
                    {connections.map((link, i) => (
                        <motion.line
                            key={`link-${i}`}
                            x1={link.from.x}
                            y1={link.from.y}
                            x2={link.to.x}
                            y2={link.to.y}
                            stroke="currentColor"
                            strokeWidth={link.strength * 2}
                            className="text-gold-400/20"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: 1 }}
                            transition={{ duration: 1.5, delay: i * 0.1 }}
                        />
                    ))}

                    {/* Nodes */}
                    {nodes.map((node, i) => (
                        <g key={node.id}>
                            <motion.circle
                                cx={node.x}
                                cy={node.y}
                                r="12"
                                className="fill-slate-900 stroke-gold-400/50"
                                strokeWidth="2"
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                transition={{ type: "spring", delay: 0.5 + i * 0.1 }}
                            />
                            {/* Pulse effect for activity */}
                            {node.knowledge && node.knowledge.length > 0 && (
                                <motion.circle
                                    cx={node.x}
                                    cy={node.y}
                                    r="18"
                                    className="fill-none stroke-gold-400/20"
                                    animate={{ r: [12, 22, 12], opacity: [0.5, 0, 0.5] }}
                                    transition={{ duration: 3, repeat: Infinity, delay: i * 0.5 }}
                                />
                            )}
                            <foreignObject x={node.x - 30} y={node.y + 15} width="60" height="20">
                                <div className="text-[8px] text-center text-slate-400 font-bold uppercase truncate">
                                    {node.shortName}
                                </div>
                            </foreignObject>
                        </g>
                    ))}
                </svg>

                {/* Legend/Status */}
                <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px]">
                    <div className="text-slate-500">Active Sync: <span className="text-green-400 font-mono">100%</span></div>
                    <div className="text-slate-500">Nodes: <span className="text-gold-400 font-mono">{nodes.length}</span></div>
                </div>
            </div>

            <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Recent Shared Knowledge</div>
                {nodes.flatMap(n => n.knowledge || []).slice(0, 3).map((k, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] text-slate-300 bg-white/5 p-1.5 rounded border border-white/5">
                        <LinkIcon className="w-3 h-3 text-gold-400" />
                        <span className="truncate">{k.topic}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
