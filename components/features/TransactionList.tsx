import { useSimulation } from "@/context/SimulationContext";
import { AGENTS } from "@/lib/ai-simulation";
import { Activity, User, ShieldAlert, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

export function TransactionList() {
    const { transactions, selectedCurrency } = useSimulation();

    const getAgentInfo = (id: string) => {
        const agent = AGENTS.find(a => a.id === id);
        if (agent) return { name: agent.name, color: agent.color.replace("text-", "bg-"), textColor: agent.color, icon: Bot };
        if (id.toLowerCase() === "user") return { name: "User", color: "bg-gold-500", textColor: "text-gold-400", icon: User };
        if (id.toLowerCase() === "system") return { name: "System", color: "bg-gray-500", textColor: "text-gray-400", icon: ShieldAlert };
        return { name: "Unknown", color: "bg-gray-700", textColor: "text-gray-500", icon: Activity };
    };

    return (
        <div className="h-full flex flex-col bg-[#0d1117] rounded-xl border border-gold-500/20 overflow-hidden">
            <div className="px-4 py-3 border-b border-gold-500/10 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-gold-400" />
                    ライブ取引履歴
                </h3>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                </span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                {transactions.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-2 opacity-50">
                        <Activity className="w-8 h-8" />
                        <span className="text-xs font-mono">取引履歴なし</span>
                    </div>
                ) : (
                    transactions.map((tx) => {
                        const info = getAgentInfo(tx.agentId);
                        const Icon = info.icon;

                        return (
                            <div key={tx.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 border border-white/5 hover:bg-gold-500/5 hover:border-gold-500/20 transition-all group">
                                <div className="flex items-center gap-2.5">
                                    <div className={cn("w-6 h-6 rounded-full flex items-center justify-center bg-opacity-20", info.color.replace("bg-", "bg-opacity-20 bg-"))}>
                                        <Icon className={cn("w-3.5 h-3.5", info.textColor)} />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={cn("text-xs font-bold", info.textColor)}>{info.name}</span>
                                        <span className="text-[10px] text-gray-500 font-mono">{new Date(tx.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-0.5">
                                    <div className="flex items-center gap-1.5">
                                        <span className={cn(
                                            "text-xs font-bold font-mono px-1.5 rounded",
                                            tx.type === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                                        )}>
                                            {tx.type}
                                        </span>
                                        <span className="text-xs font-mono text-white">
                                            {tx.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {tx.pair || tx.symbol}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-gray-500 font-mono">
                                        @ {tx.price.toLocaleString(undefined, { maximumFractionDigits: 0 })} JPY
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
