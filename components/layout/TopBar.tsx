"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Wallet, Search, Bell, Menu, X, ChevronDown, User, LogOut, Shield, Zap, Edit3, Check, Camera, Settings, Trophy, Play, ShieldAlert, Unplug } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSimulation } from "@/context/SimulationContext";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance } from "wagmi";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/context/CurrencyContext";

const pageTitles: Record<string, string> = {
    "/": "DEX Tracker",
    "/ai-council": "AI評議会",
    "/positions": "ポジション管理",
    "/strategy": "ストラテジープラン",
    "/performance": "パフォーマンス",
    "/history": "トレード履歴",
    "/watchlist": "ウォッチリスト",
    "/chain-settings": "チェーン設定",
    "/risk-settings": "リスク管理",
    "/settings": "設定",
    "/analysis": "市場分析",
    "/ai-agents": "AIエージェント",
    "/admin": "管理者ページ",
};

export function TopBar() {
    const pathname = usePathname();
    const { user, logout, updateAvatar, updateNickname } = useAuth();
    const {
        portfolio, disPoints, isDemoMode, setIsDemoMode, startFixedDemo, demoStrategy, setDemoStrategy, initialTradeSymbol, setInitialTradeSymbol,
        isMockConnected, mockAddress, toggleMockConnection, isAutoPilotEnabled, setIsAutoPilotEnabled
    } = useSimulation();
    const { currency, toggleCurrency, formatLarge } = useCurrency();
    const title = pageTitles[pathname] || "DIS-DEX";


    // Wagmi hooks
    const { isConnected, address } = useAccount();
    const { data: balanceData } = useBalance({
        address: address,
    });

    // Exchange rate を CurrencyContext で管理するため除去済み
    const walletBalanceJPY = 0; // Legacy - unused

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [editingNickname, setEditingNickname] = useState(false);
    const [nicknameInput, setNicknameInput] = useState(user?.nickname || "");
    const [showNotifications, setShowNotifications] = useState(false);

    const [notifications] = useState([
        { id: 1, text: "BTC/USDT 分析完了 - BUYシグナル", time: "2分前", read: false },
        { id: 2, text: "ETH ポジション +2.3% 利益", time: "15分前", read: false },
        { id: 3, text: "SOL 新戦略提案あり", time: "1時間前", read: true },
    ]);

    const handleSaveNickname = () => {
        if (nicknameInput.trim()) {
            updateNickname(nicknameInput.trim());
            setEditingNickname(false);
        }
    };


    return (
        <div className="h-14 border-b border-gold-500/10 bg-black/40 backdrop-blur-xl flex items-center justify-between px-4 md:px-6 shrink-0 relative z-30">

            {/* Subtle top glow */}
            <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-gold-500/20 to-transparent" />

            {/* Left: Page title */}
            <div className="flex items-center gap-3 ml-10 md:ml-0">
                <h1 className="text-sm md:text-base font-bold text-white truncate max-w-[120px] sm:max-w-none">{title}</h1>
            </div>

            {/* Right: Controls */}
            <div className="flex items-center gap-2 md:gap-3">
                {/* DIS Points */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold-500/10 border border-gold-500/30 hover-lift transition-all group cursor-pointer shadow-[0_0_15px_rgba(255,215,0,0.1)]">
                    <Trophy className="w-3.5 h-3.5 text-gold-400 animate-bounce-slow" />
                    <span className="text-[10px] text-gold-300 font-black font-mono">DIS: {disPoints.toLocaleString()}</span>
                </div>

                {/* Currency Toggle USD/JPY */}
                <button
                    onClick={toggleCurrency}
                    title="通貨表示を切り替え"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold font-mono transition-all
                        border-gold-500/40 hover:border-gold-400 bg-black/30 hover:bg-gold-500/10 text-gold-300 hover:text-gold-200 shadow-sm"
                >
                    <span className={currency === 'USD' ? 'text-gold-400' : 'text-gray-500'}>$</span>
                    <span className="text-gray-600">/</span>
                    <span className={currency === 'JPY' ? 'text-gold-400' : 'text-gray-500'}>¥</span>
                </button>

                {/* Total Assets (Portfolio) */}
                <div className="hidden sm:flex items-center gap-3 px-4 py-1.5 rounded-full bg-gold-500/5 border border-gold-500/10 hover-lift transition-all hover:bg-gold-500/10 group cursor-default">
                    <span className="text-[10px] text-gray-400 font-mono uppercase tracking-tighter group-hover:text-gold-300 transition-colors">
                        運用資産 {(isDemoMode && !isMockConnected) ? "(DEMO)" : `(${currency})`}
                    </span>
                    <span className="text-sm font-bold text-gold-400 font-mono shadow-gold-500/20 drop-shadow-sm">
                        {formatLarge(portfolio?.totalValue || 0)}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <ConnectButton.Custom>
                        {({
                            account,
                            chain,
                            openAccountModal,
                            openChainModal,
                            openConnectModal,
                            authenticationStatus,
                            mounted,
                        }) => {
                            const ready = mounted && authenticationStatus !== 'loading';
                            const connected =
                                ready &&
                                account &&
                                chain &&
                                (!authenticationStatus ||
                                    authenticationStatus === 'authenticated');

                            return (
                                <div
                                    {...(!ready && {
                                        'aria-hidden': true,
                                        'style': {
                                            opacity: 0,
                                            pointerEvents: 'none',
                                            userSelect: 'none',
                                        },
                                    })}
                                >
                                    {(() => {
                                        if (isMockConnected) {
                                            return (
                                                <div className="flex items-center gap-2">
                                                    {/* Auto Trade Indicator */}
                                                    <div
                                                        onClick={() => setIsAutoPilotEnabled(!isAutoPilotEnabled)}
                                                        className={cn(
                                                            "hidden md:flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-all border",
                                                            isAutoPilotEnabled
                                                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                                                : "bg-gray-500/10 border-gray-500/20 text-gray-400 opacity-50"
                                                        )}
                                                        title={isAutoPilotEnabled ? "Auto-Pilot: ON (Click to Disable)" : "Auto-Pilot: OFF (Click to Enable)"}
                                                    >
                                                        <div className={cn("w-2 h-2 rounded-full", isAutoPilotEnabled ? "bg-emerald-500 animate-pulse" : "bg-gray-500")} />
                                                        <span className="text-[10px] font-mono">{isAutoPilotEnabled ? "AUTO ON" : "AUTO OFF"}</span>
                                                    </div>

                                                    <button
                                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all text-xs font-mono group"
                                                    >
                                                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                                        <span className="hidden sm:inline">
                                                            {mockAddress.slice(0, 6)}...{mockAddress.slice(-4)}
                                                        </span>
                                                    </button>
                                                </div>
                                            );
                                        }

                                        if (!connected) {
                                            return (
                                                <button
                                                    onClick={openConnectModal}
                                                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-gold-500/10 border border-gold-500/30 text-gold-400 hover:bg-gold-500/20 transition-all text-[10px] sm:text-xs font-mono shadow-[0_0_10px_rgba(255,215,0,0.1)]"
                                                >
                                                    <Wallet className="w-3.5 h-3.5" />
                                                    <span className="hidden xs:inline sm:inline">接続</span>
                                                </button>
                                            );
                                        }

                                        if (chain.unsupported) {
                                            return (
                                                <button
                                                    onClick={openChainModal}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all text-xs font-mono"
                                                >
                                                    Wrong network
                                                </button>
                                            );
                                        }

                                        return (
                                            <div className="flex items-center gap-2">
                                                {/* Auto Trade Indicator (Only when connected) */}
                                                <div
                                                    onClick={() => setIsAutoPilotEnabled(!isAutoPilotEnabled)}
                                                    className={cn(
                                                        "hidden md:flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-all border",
                                                        isAutoPilotEnabled
                                                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                                            : "bg-gray-500/10 border-gray-500/20 text-gray-400 opacity-50"
                                                    )}
                                                    title={isAutoPilotEnabled ? "Auto-Pilot: ON (Click to Disable)" : "Auto-Pilot: OFF (Click to Enable)"}
                                                >
                                                    <div className={cn("w-2 h-2 rounded-full", isAutoPilotEnabled ? "bg-emerald-500 animate-pulse" : "bg-gray-500")} />
                                                    <span className="text-[10px] font-mono">{isAutoPilotEnabled ? "AUTO ON" : "AUTO OFF"}</span>
                                                </div>

                                                <button
                                                    onClick={openAccountModal}
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-all text-xs font-mono group"
                                                >
                                                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                                    <span className="hidden sm:inline">
                                                        {account.displayName}
                                                    </span>
                                                    {account.displayBalance && (
                                                        <span className="hidden lg:inline text-gray-500 ml-1">
                                                            ({account.displayBalance})
                                                        </span>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )
                        }}
                    </ConnectButton.Custom>
                </div>

                {/* DEMO / WALLET Toggle */}
                <div className="flex items-center gap-2">
                    {isDemoMode && !isMockConnected && (
                        <button
                            onClick={() => setIsDemoMode(false)}
                            className="bg-white/5 border border-white/10 hover:bg-white/10 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-2"
                        >
                            <span className="w-2 h-2 rounded-full bg-gold-500 animate-pulse" />
                            <span className="hidden xs:inline font-mono">EXIT DEMO</span>
                        </button>
                    )}
                </div>


                {/* Notifications */}
                <div className="relative">
                    <Link href="/notifications">
                        <button
                            className="p-2 rounded-lg hover:bg-gold-500/10 transition-all hover-lift group relative"
                        >
                            <Bell className="w-4 h-4 text-gray-400 group-hover:text-gold-400 transition-colors" />
                            {notifications.filter(n => !n.read).length > 0 && (
                                <div className="absolute top-1 right-1 w-2 h-2 bg-gold-500 rounded-full" />
                            )}
                        </button>
                    </Link>

                    {showNotifications && (
                        <div className="absolute right-0 top-12 w-72 glass-panel rounded-lg border border-gold-500/20 shadow-xl p-2 z-50">
                            <p className="text-xs text-gold-400 font-mono px-2 py-1 border-b border-gold-500/10 mb-1">通知</p>
                            {notifications.map(n => (
                                <div key={n.id} className={`px-2 py-2 rounded text-xs ${n.read ? 'text-gray-500' : 'text-white bg-gold-500/5'} hover:bg-white/5 transition-colors cursor-pointer`}>
                                    <p className="truncate">{n.text}</p>
                                    <p className="text-[10px] text-gray-600 mt-0.5">{n.time}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* User Menu */}
                <div className="relative flex items-center gap-2">
                    <button
                        onClick={() => setShowUserMenu(!showUserMenu)}
                        className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                    >
                        {user?.avatarUrl ? (
                            <img src={user.avatarUrl} alt="avatar" className="w-7 h-7 rounded-full object-cover border border-gold-500/20" />
                        ) : (
                            <div className="w-7 h-7 rounded-full bg-gold-500/10 border border-gold-500/20 flex items-center justify-center">
                                <User className="w-3.5 h-3.5 text-gold-400" />
                            </div>
                        )}
                    </button>

                    <button
                        onClick={logout}
                        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all text-xs font-mono"
                        title="ログアウト"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        <span className="hidden lg:inline">ログアウト</span>
                    </button>

                    {/* Profile Popup Overlay */}
                    {showUserMenu && (
                        <>
                            {/* Backdrop */}
                            <div
                                className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
                                onClick={() => setShowUserMenu(false)}
                            />
                            {/* Popup */}
                            <div className="fixed top-16 right-4 w-80 bg-[#060c14] backdrop-blur-2xl rounded-2xl border border-gold-500/40 shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_rgba(255,215,0,0.15)] p-5 z-[100] animate-in fade-in zoom-in-95 duration-200">
                                {/* Decorative gradient */}
                                <div className="absolute top-0 right-0 w-32 h-32 bg-gold-500/8 blur-3xl pointer-events-none rounded-full" />
                                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-gold-500/60 to-transparent rounded-t-2xl" />

                                <div className="relative space-y-4">
                                    {/* Profile Header */}
                                    <div className="flex items-center gap-4 pb-4 border-b border-white/10">
                                        <div className="relative group/avatar">
                                            {user?.avatarUrl ? (
                                                <img src={user.avatarUrl} alt="avatar" className="w-14 h-14 rounded-2xl object-cover border-2 border-gold-500/50 shadow-[0_0_15px_rgba(255,215,0,0.2)]" />
                                            ) : (
                                                <div className="w-14 h-14 rounded-2xl bg-gold-500/20 border-2 border-gold-500/40 flex items-center justify-center">
                                                    <User className="w-7 h-7 text-gold-400" />
                                                </div>
                                            )}
                                            <label className="absolute -bottom-1 -right-1 w-6 h-6 bg-gold-500 rounded-lg flex items-center justify-center cursor-pointer hover:bg-gold-400 transition-all hover:scale-110 shadow-lg">
                                                <Camera className="w-3 h-3 text-black" />
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) {
                                                            const reader = new FileReader();
                                                            reader.onload = (ev) => {
                                                                if (ev.target?.result) {
                                                                    updateAvatar(ev.target.result as string);
                                                                }
                                                            };
                                                            reader.readAsDataURL(file);
                                                        }
                                                    }}
                                                />
                                            </label>
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            {editingNickname ? (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={nicknameInput}
                                                        onChange={(e) => setNicknameInput(e.target.value)}
                                                        className="w-full bg-white/10 border border-gold-500/50 rounded-lg px-2 py-1.5 text-sm text-white font-mono focus:ring-1 focus:ring-gold-500 outline-none"
                                                        autoFocus
                                                        onKeyDown={(e) => e.key === "Enter" && handleSaveNickname()}
                                                    />
                                                    <div className="flex flex-col gap-1">
                                                        <button onClick={handleSaveNickname} className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors">
                                                            <Check className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => setEditingNickname(false)} className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors">
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 group/nick">
                                                    <p className="text-base font-black text-white truncate">
                                                        {user?.nickname}
                                                    </p>
                                                    <button
                                                        onClick={() => { setEditingNickname(true); setNicknameInput(user?.nickname || ""); }}
                                                        className="opacity-0 group-hover/nick:opacity-100 p-1 text-gray-400 hover:text-gold-400 transition-all"
                                                    >
                                                        <Edit3 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            )}
                                            <p className="text-[10px] text-gold-400/70 font-mono truncate mt-0.5">{user?.email}</p>
                                        </div>
                                    </div>

                                    {/* Menu Items */}
                                    <div className="space-y-1">
                                        <Link href="/settings" onClick={() => setShowUserMenu(false)}>
                                            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-300 hover:text-gold-400 hover:bg-gold-500/10 transition-all group">
                                                <Settings className="w-4 h-4 group-hover:rotate-90 transition-transform duration-500" />
                                                <span>プロファイル設定</span>
                                            </button>
                                        </Link>
                                    </div>

                                    {/* Assets mini card */}
                                    <div className="bg-white/5 rounded-xl p-3 border border-gold-500/20">
                                        <div className="flex justify-between items-end">
                                            <span className="text-[10px] text-gray-400 uppercase font-black">Total Assets</span>
                                            <span className="text-xs text-gold-500 font-mono">LIVE</span>
                                        </div>
                                        <div className="text-xl font-black text-gold-400 font-mono mt-1">
                                            ¥{(portfolio?.totalValue || 0).toLocaleString()}
                                        </div>
                                    </div>

                                    {/* Mock Toggle - Visible for dev testing */}
                                    <div className="pt-2">
                                        <button
                                            onClick={toggleMockConnection}
                                            className={cn(
                                                "w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                                                isMockConnected
                                                    ? "bg-neon-green/10 text-neon-green border-neon-green/30 hover:bg-neon-green/20"
                                                    : "bg-white/5 text-gray-400 border-white/10 hover:bg-white/10 hover:text-white"
                                            )}
                                        >
                                            <Wallet className="w-3.5 h-3.5" />
                                            {isMockConnected ? "Mock Connection Disconnect" : "Mock Connection (Dev)"}
                                        </button>
                                    </div>

                                    {/* Logout */}
                                    <div className="pt-1">
                                        <button
                                            onClick={() => { logout(); setShowUserMenu(false); }}
                                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 transition-all font-bold text-sm group"
                                        >
                                            <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                                            ログアウト
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

