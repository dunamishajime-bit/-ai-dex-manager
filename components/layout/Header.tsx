"use client";

import React, { useState, useEffect } from "react";
import { Bell, Volume2, VolumeX, Settings, LogOut, Play, Wallet, User } from "lucide-react";
import { useSimulation } from "@/context/SimulationContext";
import { cn } from "@/lib/utils"; // Assuming cn is used and needs to be imported

export function Header() {
    const {
        portfolio,
        isDemoMode,
        setIsDemoMode,
        setShowDemoModal,
        isMockConnected,
        mockAddress,
        toggleMockConnection
    } = useSimulation();

    const [currentTime, setCurrentTime] = useState<string>("");
    const [isMuted, setIsMuted] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    useEffect(() => {
        setIsMuted(localStorage.getItem('disdex_audio_muted') === 'true');
        setCurrentTime(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
        const timer = setInterval(() => {
            setCurrentTime(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const toggleMute = () => {
        const newState = !isMuted;
        setIsMuted(newState);
        localStorage.setItem('disdex_audio_muted', String(newState));
        if (newState) {
            import("@/lib/audio-service").then(({ stopAIVoice }) => stopAIVoice());
        }
    };

    return (
        <header className="h-20 pl-20 lg:pl-64 pr-6 fixed top-0 w-full z-40 border-b border-white/10 bg-black/50 backdrop-blur-md flex items-center justify-between">
            {/* 1. Left: Logo & Status */}
            <div className="flex items-center text-sm">
                <div className="flex items-center gap-2 mr-6 border-r border-white/10 pr-6">
                    <span className="text-2xl font-bold text-gold-500">J</span>
                    <span className="font-bold tracking-wider text-white">J-DEX MANAGER</span>
                </div>
                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-[10px] hidden md:inline uppercase tracking-tighter">Market Status:</span>
                        <span className="text-success font-mono text-xs hidden md:flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                            ACTIVE
                        </span>
                    </div>
                    {isDemoMode && (
                        <div className="flex items-center gap-1 text-[9px] text-gold-400 font-bold animate-pulse">
                            <Play className="w-2 h-2 fill-gold-400" />
                            DEMO MODE ACTIVE
                        </div>
                    )}
                </div>
            </div>

            {/* 2. Right: Controls */}
            <div className="flex items-center gap-4">
                {/* Mute Toggle */}
                <button
                    onClick={toggleMute}
                    className="w-10 h-10 rounded-full glass-panel flex items-center justify-center text-gray-400 hover:text-white transition-colors"
                    title={isMuted ? "Unmute System Sounds" : "Mute System Sounds"}
                >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>

                {/* Notification */}
                <button
                    className="w-10 h-10 rounded-full glass-panel flex items-center justify-center text-gray-400 hover:text-white transition-colors relative"
                    onClick={() => window.location.href = "/notifications"}
                >
                    <Bell className="w-5 h-5" />
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-danger" />
                </button>

                {/* User Icon (Mobile) */}
                <div className="relative group">
                    <button
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="w-10 h-10 rounded-full glass-panel flex items-center justify-center text-gray-400 hover:text-white transition-colors md:hidden"
                    >
                        <User className={`w-5 h-5 ${isMobileMenuOpen ? "text-white" : ""}`} />
                    </button>

                    {/* Mobile Menu Dropdown */}
                    {isMobileMenuOpen && (
                        <div className="absolute top-14 right-[-60px] w-64 bg-slate-900 border border-gold-500/30 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.8)] p-4 flex flex-col gap-3 z-50 animate-in fade-in slide-in-from-top-2">
                            <div className="text-center border-b border-white/10 pb-2 mb-1">
                                <p className="text-gold-500 text-xs font-bold tracking-widest">ACCOUNT</p>
                            </div>

                            <div className="bg-white/5 rounded-lg p-3 text-center border border-white/5">
                                <p className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">Current Assets</p>
                                <p className="text-white font-mono text-xl font-bold">¥{portfolio?.totalValue?.toLocaleString() ?? "0"}</p>
                            </div>

                            <div className="flex flex-col gap-1">
                                <button className="flex items-center gap-3 px-3 py-2 text-gray-300 hover:bg-white/5 hover:text-white rounded-lg transition-colors font-medium text-xs">
                                    <User className="w-3.5 h-3.5" /> Edit Avatar
                                </button>
                                <button className="flex items-center gap-3 px-3 py-2 text-gray-300 hover:bg-white/5 hover:text-white rounded-lg transition-colors font-medium text-xs">
                                    <Settings className="w-3.5 h-3.5" /> Edit Nickname
                                </button>
                                <button
                                    className="flex items-center gap-3 px-3 py-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors font-medium text-xs mt-2 border-t border-white/10 pt-3"
                                    onClick={() => {
                                        localStorage.removeItem("disdex_auth_user");
                                        window.location.reload();
                                    }}
                                >
                                    <LogOut className="w-3.5 h-3.5" /> Logout
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Operational Assets (Desktop) */}
                <div className="flex flex-col items-end mr-2 hidden md:flex border-r border-white/10 pr-4">
                    <span className="text-[10px] text-gray-400 uppercase tracking-widest">
                        {isDemoMode ? "運用資産(DEMO)" : "Operational Assets"}
                    </span>
                    <span className="text-gold-500 font-mono font-bold text-lg">
                        ¥{(portfolio?.totalValue || 0).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}
                    </span>
                </div>

                {/* Time (Desktop) */}
                <div className="flex flex-col items-end mr-4 hidden md:flex border-r border-white/10 pr-4">
                    <span className="text-[10px] text-gray-400 uppercase tracking-widest">Server Time</span>
                    <span className="text-white font-mono font-bold text-lg opacity-80">
                        {currentTime}
                    </span>
                </div>

                {/* DEMO / WALLET Toggle */}
                <div className="flex items-center gap-2">
                    {!isDemoMode ? (
                        <button
                            onClick={() => setShowDemoModal(true)}
                            className="bg-gold-500 hover:bg-gold-400 text-black px-4 py-1.5 rounded-full text-xs font-black shadow-[0_0_15px_rgba(255,215,0,0.3)] transition-all flex items-center gap-2"
                        >
                            <Play className="w-3 h-3 fill-black" />
                            DEMO
                        </button>
                    ) : (
                        <button
                            onClick={() => setIsDemoMode(false)}
                            className="bg-white/5 border border-white/10 hover:bg-white/10 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2"
                        >
                            <span className="w-2 h-2 rounded-full bg-gold-500 animate-pulse" />
                            デモ終了
                        </button>
                    )}

                    <div
                        onClick={toggleMockConnection}
                        className={cn(
                            "glass-panel rounded-full px-4 py-1.5 flex items-center gap-2 text-xs font-bold transition-colors cursor-pointer group",
                            isMockConnected ? "border-neon-green/50 text-neon-green bg-neon-green/5" : "border-gold-500/20 text-gray-300 hover:text-white"
                        )}
                    >
                        <Wallet className={cn("w-3.5 h-3.5", isMockConnected ? "text-neon-green" : "text-gold-500", "group-hover:scale-110 transition-transform")} />
                        <span className="hidden sm:inline font-mono">
                            {isMockConnected ? `${mockAddress.slice(0, 6)}...${mockAddress.slice(-4)}` : "0x7A...3f92"}
                        </span>
                        <span className="sm:hidden font-mono">{isMockConnected ? "MOCK" : "Wallet"}</span>
                    </div>
                </div>
            </div>
        </header>
    );
}
