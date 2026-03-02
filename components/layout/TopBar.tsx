// AUTO_CONTINUE: enabled
"use client";

import { useMemo, useState } from "react";
import {
    Bell,
    Camera,
    Check,
    Edit3,
    LogOut,
    Play,
    Settings,
    Trophy,
    User,
    Wallet,
    X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import { useSimulation } from "@/context/SimulationContext";
import { cn } from "@/lib/utils";

const pageTitles: Record<string, string> = {
    "/": "DEXトラッカー",
    "/ai-council": "AI評議会",
    "/positions": "ポジション",
    "/strategy": "ストラテジー",
    "/performance": "パフォーマンス",
    "/history": "トレード履歴",
    "/watchlist": "ウォッチリスト",
    "/chain-settings": "チェーン設定",
    "/risk-settings": "リスク設定",
    "/settings": "設定",
    "/analysis": "分析",
    "/ai-agents": "AIエージェント",
    "/admin": "管理者ページ",
    "/notifications": "通知履歴",
    "/news": "ニュース",
    "/trader-chat": "TraderBrain",
    "/trader-brain": "TraderBrain",
};

function formatWalletTotalJpy(usdValue: number, jpyRate: number) {
    const amount = Number.isFinite(Number(usdValue)) ? Number(usdValue) : 0;
    return `¥${Math.round(amount * jpyRate).toLocaleString("ja-JP")}`;
}

export function TopBar() {
    const pathname = usePathname();
    const { user, logout, updateAvatar, updateNickname } = useAuth();
    const {
        portfolio,
        disPoints,
        isDemoMode,
        setIsDemoMode,
        isMockConnected,
        mockAddress,
        toggleMockConnection,
        isAutoPilotEnabled,
        setIsAutoPilotEnabled,
        isPricingPaused,
        resumePricing,
    } = useSimulation();
    const { currency, toggleCurrency, jpyRate } = useCurrency();
    const { isConnected } = useAccount();

    const title = pageTitles[pathname] || "DIS TERMINAL";
    const walletTotalLabel = isDemoMode && !isMockConnected ? "(DEMO)" : "(JPY)";
    const walletTotalDisplay = formatWalletTotalJpy(portfolio?.totalValue || 0, jpyRate);

    const notifications = useMemo(
        () => [
            { id: 1, text: "自動トレードの監視ペアを更新しました", time: "2分前", read: false },
            { id: 2, text: "ETH ポジションの変動を検知", time: "15分前", read: false },
            { id: 3, text: "仮想通貨ニュースを更新しました", time: "1時間前", read: true },
        ],
        []
    );

    const [showUserMenu, setShowUserMenu] = useState(false);
    const [editingNickname, setEditingNickname] = useState(false);
    const [nicknameInput, setNicknameInput] = useState(user?.nickname || "");

    const handleSaveNickname = () => {
        const nextName = nicknameInput.trim();
        if (!nextName) return;
        updateNickname(nextName);
        setEditingNickname(false);
    };

    return (
        <div className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-gold-500/10 bg-black/40 px-4 backdrop-blur-xl md:px-6">
            <div className="absolute left-1/4 right-1/4 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/20 to-transparent" />

            <div className="ml-10 flex items-center gap-3 md:ml-0">
                <h1 className="max-w-[140px] truncate text-sm font-bold text-white sm:max-w-none md:text-base">
                    {title}
                </h1>
            </div>

            <div className="flex items-center gap-2 md:gap-3">
                <div className="group flex cursor-pointer items-center gap-2 rounded-full border border-gold-500/30 bg-gold-500/10 px-3 py-1.5 shadow-[0_0_15px_rgba(255,215,0,0.1)] transition-all hover-lift">
                    <Trophy className="h-3.5 w-3.5 animate-bounce-slow text-gold-400" />
                    <span className="font-mono text-[10px] font-black text-gold-300">
                        DIS: {disPoints.toLocaleString()}
                    </span>
                </div>

                <button
                    onClick={toggleCurrency}
                    title="表示通貨を切り替え"
                    className="flex items-center gap-1 rounded-full border border-gold-500/40 bg-black/30 px-2.5 py-1 text-[11px] font-bold font-mono text-gold-300 shadow-sm transition-all hover:border-gold-400 hover:bg-gold-500/10 hover:text-gold-200"
                >
                    <span className={currency === "USD" ? "text-gold-400" : "text-gray-500"}>$</span>
                    <span className="text-gray-600">/</span>
                    <span className={currency === "JPY" ? "text-gold-400" : "text-gray-500"}>¥</span>
                </button>

                <div className="group hidden cursor-default items-center gap-3 rounded-full border border-gold-500/10 bg-gold-500/5 px-4 py-1.5 transition-all hover:bg-gold-500/10 hover-lift sm:flex">
                    <span className="font-mono text-[10px] tracking-tight text-gray-400 transition-colors group-hover:text-gold-300">
                        ウォレット総資産 {walletTotalLabel}
                    </span>
                    <span
                        className={cn(
                            "text-sm font-bold font-mono drop-shadow-sm shadow-gold-500/20",
                            isPricingPaused ? "italic text-gray-500" : "text-gold-400"
                        )}
                    >
                        {isPricingPaused ? "N/A" : walletTotalDisplay}
                    </span>
                    {isPricingPaused ? (
                        <button
                            onClick={resumePricing}
                            className="ml-1 flex items-center gap-1 rounded bg-gold-500 px-2 py-0.5 text-[9px] font-black text-black transition-colors hover:bg-gold-400"
                            title="価格更新を再開"
                        >
                            <Play className="h-2.5 w-2.5" />
                            再開
                        </button>
                    ) : null}
                </div>

                <ConnectButton.Custom>
                    {({ account, chain, openAccountModal, openChainModal, openConnectModal, authenticationStatus, mounted }) => {
                        const ready = mounted && authenticationStatus !== "loading";
                        const connected =
                            ready &&
                            account &&
                            chain &&
                            (!authenticationStatus || authenticationStatus === "authenticated");

                        return (
                            <div
                                {...(!ready && {
                                    "aria-hidden": true,
                                    style: {
                                        opacity: 0,
                                        pointerEvents: "none",
                                        userSelect: "none",
                                    },
                                })}
                            >
                                {(() => {
                                    if (isMockConnected) {
                                        return (
                                            <div className="flex items-center gap-2">
                                                <div
                                                    onClick={() => setIsAutoPilotEnabled(!isAutoPilotEnabled)}
                                                    className={cn(
                                                        "hidden cursor-pointer items-center gap-1.5 rounded border px-2 py-1 transition-all md:flex",
                                                        isAutoPilotEnabled
                                                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                                            : "border-gray-500/20 bg-gray-500/10 text-gray-400 opacity-50"
                                                    )}
                                                    title={isAutoPilotEnabled ? "自動トレード: ON" : "自動トレード: OFF"}
                                                >
                                                    <div
                                                        className={cn(
                                                            "h-2 w-2 rounded-full",
                                                            isAutoPilotEnabled ? "animate-pulse bg-emerald-500" : "bg-gray-500"
                                                        )}
                                                    />
                                                    <span className="font-mono text-[10px]">
                                                        {isAutoPilotEnabled ? "AUTO ON" : "AUTO OFF"}
                                                    </span>
                                                </div>

                                                <button className="group flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-mono text-emerald-400 transition-all hover:bg-emerald-500/20">
                                                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
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
                                                className="flex items-center gap-1.5 rounded-lg border border-gold-500/30 bg-gold-500/10 px-2 py-1.5 text-[10px] font-mono text-gold-400 shadow-[0_0_10px_rgba(255,215,0,0.1)] transition-all hover:bg-gold-500/20 sm:text-xs"
                                            >
                                                <Wallet className="h-3.5 w-3.5" />
                                                <span className="hidden xs:inline sm:inline">接続</span>
                                            </button>
                                        );
                                    }

                                    if (chain.unsupported) {
                                        return (
                                            <button
                                                onClick={openChainModal}
                                                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-mono text-red-400 transition-all hover:bg-red-500/20"
                                            >
                                                未対応ネットワーク
                                            </button>
                                        );
                                    }

                                    return (
                                        <div className="flex items-center gap-2">
                                            <div
                                                onClick={() => setIsAutoPilotEnabled(!isAutoPilotEnabled)}
                                                className={cn(
                                                    "hidden cursor-pointer items-center gap-1.5 rounded border px-2 py-1 transition-all md:flex",
                                                    isAutoPilotEnabled
                                                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                                        : "border-gray-500/20 bg-gray-500/10 text-gray-400 opacity-50"
                                                )}
                                                title={isAutoPilotEnabled ? "自動トレード: ON" : "自動トレード: OFF"}
                                            >
                                                <div
                                                    className={cn(
                                                        "h-2 w-2 rounded-full",
                                                        isAutoPilotEnabled ? "animate-pulse bg-emerald-500" : "bg-gray-500"
                                                    )}
                                                />
                                                <span className="font-mono text-[10px]">
                                                    {isAutoPilotEnabled ? "AUTO ON" : "AUTO OFF"}
                                                </span>
                                            </div>

                                            <button
                                                onClick={openAccountModal}
                                                className="group flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-mono text-emerald-400 transition-all hover:bg-emerald-500/20"
                                            >
                                                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                                                <span className="hidden sm:inline">{account.displayName}</span>
                                                {account.displayBalance ? (
                                                    <span className="ml-1 hidden text-gray-500 lg:inline">
                                                        ({account.displayBalance})
                                                    </span>
                                                ) : null}
                                            </button>
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    }}
                </ConnectButton.Custom>

                {isDemoMode && !isMockConnected ? (
                    <button
                        onClick={() => setIsDemoMode(false)}
                        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-bold text-white transition-all hover:bg-white/10"
                    >
                        <span className="h-2 w-2 animate-pulse rounded-full bg-gold-500" />
                        <span className="hidden font-mono xs:inline">デモ終了</span>
                    </button>
                ) : null}

                <div className="relative">
                    <Link href="/notifications">
                        <button className="group relative rounded-lg p-2 transition-all hover:bg-gold-500/10 hover-lift">
                            <Bell className="h-4 w-4 text-gray-400 transition-colors group-hover:text-gold-400" />
                            {notifications.some((item) => !item.read) ? (
                                <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-gold-500" />
                            ) : null}
                        </button>
                    </Link>
                </div>

                <div className="relative flex items-center gap-2">
                    <button
                        onClick={() => setShowUserMenu(!showUserMenu)}
                        className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-white/5"
                    >
                        {user?.avatarUrl ? (
                            <img
                                src={user.avatarUrl}
                                alt="avatar"
                                className="h-7 w-7 rounded-full border border-gold-500/20 object-cover"
                            />
                        ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gold-500/20 bg-gold-500/10">
                                <User className="h-3.5 w-3.5 text-gold-400" />
                            </div>
                        )}
                    </button>

                    <button
                        onClick={logout}
                        className="hidden items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-mono text-red-400 transition-all hover:bg-red-500/20 md:flex"
                        title="ログアウト"
                    >
                        <LogOut className="h-3.5 w-3.5" />
                        <span className="hidden lg:inline">ログアウト</span>
                    </button>

                    {showUserMenu ? (
                        <>
                            <div
                                className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
                                onClick={() => setShowUserMenu(false)}
                            />
                            <div className="fixed right-4 top-16 z-[100] w-80 animate-in zoom-in-95 rounded-2xl border border-gold-500/40 bg-[#060c14] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_rgba(255,215,0,0.15)] backdrop-blur-2xl duration-200 fade-in">
                                <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-gold-500/8 blur-3xl" />
                                <div className="absolute left-0 top-0 h-[2px] w-full rounded-t-2xl bg-gradient-to-r from-transparent via-gold-500/60 to-transparent" />

                                <div className="relative space-y-4">
                                    <div className="flex items-center gap-4 border-b border-white/10 pb-4">
                                        <div className="group/avatar relative">
                                            {user?.avatarUrl ? (
                                                <img
                                                    src={user.avatarUrl}
                                                    alt="avatar"
                                                    className="h-14 w-14 rounded-2xl border-2 border-gold-500/50 object-cover shadow-[0_0_15px_rgba(255,215,0,0.2)]"
                                                />
                                            ) : (
                                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-gold-500/40 bg-gold-500/20">
                                                    <User className="h-7 w-7 text-gold-400" />
                                                </div>
                                            )}
                                            <label className="absolute -bottom-1 -right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg bg-gold-500 shadow-lg transition-all hover:scale-110 hover:bg-gold-400">
                                                <Camera className="h-3 w-3 text-black" />
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(event) => {
                                                        const file = event.target.files?.[0];
                                                        if (!file) return;
                                                        const reader = new FileReader();
                                                        reader.onload = (loadEvent) => {
                                                            if (loadEvent.target?.result) {
                                                                updateAvatar(loadEvent.target.result as string);
                                                            }
                                                        };
                                                        reader.readAsDataURL(file);
                                                    }}
                                                />
                                            </label>
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            {editingNickname ? (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={nicknameInput}
                                                        onChange={(event) => setNicknameInput(event.target.value)}
                                                        className="w-full rounded-lg border border-gold-500/50 bg-white/10 px-2 py-1.5 text-sm font-mono text-white outline-none focus:ring-1 focus:ring-gold-500"
                                                        autoFocus
                                                        onKeyDown={(event) => event.key === "Enter" && handleSaveNickname()}
                                                    />
                                                    <div className="flex flex-col gap-1">
                                                        <button
                                                            onClick={handleSaveNickname}
                                                            className="rounded p-1 text-emerald-400 transition-colors hover:bg-emerald-500/10"
                                                        >
                                                            <Check className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingNickname(false)}
                                                            className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
                                                        >
                                                            <X className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="group/nick flex items-center gap-2">
                                                    <p className="truncate text-base font-black text-white">
                                                        {user?.nickname || "DIS Operator"}
                                                    </p>
                                                    <button
                                                        onClick={() => {
                                                            setEditingNickname(true);
                                                            setNicknameInput(user?.nickname || "");
                                                        }}
                                                        className="p-1 text-gray-400 opacity-0 transition-all hover:text-gold-400 group-hover/nick:opacity-100"
                                                    >
                                                        <Edit3 className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            )}
                                            <p className="mt-0.5 truncate font-mono text-[10px] text-gold-400/70">
                                                {user?.email}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <Link href="/settings" onClick={() => setShowUserMenu(false)}>
                                            <button className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-300 transition-all hover:bg-gold-500/10 hover:text-gold-400">
                                                <Settings className="h-4 w-4 transition-transform duration-500 group-hover:rotate-90" />
                                                <span>プロフィール設定</span>
                                            </button>
                                        </Link>
                                    </div>

                                    <div className="rounded-xl border border-gold-500/20 bg-white/5 p-3">
                                        <div className="flex items-end justify-between">
                                            <span className="text-[10px] font-black text-gray-400">運用資産</span>
                                            <span className="font-mono text-xs text-gold-500">
                                                {isConnected || isMockConnected ? "LIVE" : "OFFLINE"}
                                            </span>
                                        </div>
                                        <div className="mt-1 font-mono text-xl font-black text-gold-400">
                                            {walletTotalDisplay}
                                        </div>
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            onClick={toggleMockConnection}
                                            className={cn(
                                                "flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition-all",
                                                isMockConnected
                                                    ? "border-neon-green/30 bg-neon-green/10 text-neon-green hover:bg-neon-green/20"
                                                    : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                                            )}
                                        >
                                            <Wallet className="h-3.5 w-3.5" />
                                            {isMockConnected ? "モック接続を解除" : "モック接続を有効化"}
                                        </button>
                                    </div>

                                    <div className="pt-1">
                                        <button
                                            onClick={() => {
                                                logout();
                                                setShowUserMenu(false);
                                            }}
                                            className="group flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-3 text-sm font-bold text-red-300 transition-all hover:bg-red-500/25"
                                        >
                                            <LogOut className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
                                            ログアウト
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
