"use client";

import { usePathname } from "next/navigation";
import { Bell, CreditCard, ShieldAlert, Wallet } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useCurrency } from "@/context/CurrencyContext";
import { useSimulation } from "@/context/SimulationContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { cn } from "@/lib/utils";
import { SITE_BRAND_NAME } from "@/lib/site-access";

const PAGE_TITLES: Record<string, string> = {
  "/": "ホーム",
  "/positions": "ダッシュボード",
  "/wallets": "運用ウォレット",
  "/settings": "設定",
  "/admin": "管理",
  "/history": "トレード履歴",
};

export function TopBar() {
  const pathname = usePathname();
  const { currency, symbol } = useCurrency();
  const { isWalletConnected, riskStatus } = useSimulation();
  const { user } = useAuth();
  const { wallet } = useOperationalWallet();

  const title = PAGE_TITLES[pathname || "/"] || SITE_BRAND_NAME;
  const hasSavedWallet = Boolean(wallet?.address || user?.ownerWalletAddress);
  const walletConnected = isWalletConnected || hasSavedWallet;
  const walletLabel = walletConnected ? "接続中" : "未接続";
  const riskLabel =
    riskStatus === "CRITICAL" ? "警戒" : riskStatus === "CAUTION" ? "注意" : "通常";

  return (
    <header className="sticky top-0 z-30 border-b border-white/6 bg-[linear-gradient(180deg,rgba(5,8,12,0.92),rgba(4,6,10,0.78))] px-3 py-3 backdrop-blur-2xl md:px-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/70">
            <ShieldAlert className="h-3.5 w-3.5 text-gold-100" />
            {title}
          </div>
          <h1 className="mt-0.5 truncate text-lg font-black tracking-tight text-white md:text-xl">
            {SITE_BRAND_NAME}
          </h1>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <span className="rounded-full border border-gold-400/20 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold text-white/80">
            表示通貨: {currency}
          </span>
          <span className="rounded-full border border-gold-400/20 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold text-white/80">
            基準: {symbol}
          </span>
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-[10px] font-semibold",
              walletConnected
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                : "border-white/10 bg-white/[0.03] text-white/60",
            )}
          >
            ウォレット: {walletLabel}
          </span>
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-[10px] font-semibold",
              riskStatus === "CRITICAL"
                ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
                : riskStatus === "CAUTION"
                  ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                  : "border-gold-400/20 bg-white/[0.04] text-white/82",
            )}
          >
            リスク: {riskLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/80"
          >
            <Bell className="mr-1 inline h-3.5 w-3.5" />
            通知
          </button>
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/80"
          >
            <Wallet className="mr-1 inline h-3.5 w-3.5" />
            {walletLabel}
          </button>
          <button
            type="button"
            className="rounded-full border border-gold-400/20 bg-[linear-gradient(90deg,rgba(253,224,71,0.14),rgba(245,158,11,0.08))] px-3 py-2 text-xs font-semibold text-white"
          >
            <CreditCard className="mr-1 inline h-3.5 w-3.5" />
            {symbol} 表示
          </button>
        </div>
      </div>
    </header>
  );
}
