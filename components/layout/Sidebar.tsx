"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  FileText,
  Home,
  LogOut,
  MessageSquareText,
  Settings,
  Wallet,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { SITE_BRAND_NAME } from "@/lib/site-access";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  children?: Array<{
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }>;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "ホーム", icon: Home },
  { href: "/positions", label: "ダッシュボード", icon: BarChart3 },
  {
    href: "/research-lab",
    label: "AI研究ラボ",
    icon: Activity,
    children: [
      { href: "/research-lab/discussions", label: "議論内容", icon: MessageSquareText },
    ],
  },
  { href: "/wallets", label: "運用ウォレット", icon: Wallet },
  { href: "/history", label: "トレード履歴", icon: FileText },
  { href: "/settings", label: "設定", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <aside className="hidden w-[188px] shrink-0 bg-[#04070c] px-3 py-4 md:flex md:flex-col">
      <div className="rounded-[20px] border border-[#8f8551] bg-[linear-gradient(180deg,rgba(35,35,24,0.92),rgba(16,18,18,0.96))] px-4 py-3 shadow-[0_0_24px_rgba(0,0,0,0.28)]">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#6d653f] bg-[#11150f] text-sm font-bold text-[#efe8c6]">D</div>
          <div className="min-w-0">
            <div className="truncate text-[11px] font-bold text-white">{SITE_BRAND_NAME}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#dad1a7]">Personal</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#dad1a7]">Trading Desk</div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[20px] border border-[#1c232c] bg-[linear-gradient(180deg,rgba(8,12,18,0.98),rgba(6,10,16,0.98))] px-2 py-3">
        <div className="px-3 pb-2 text-[11px] font-bold text-white/76">メニュー</div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const parentActive = item.href === "/"
              ? pathname === "/"
              : item.children?.length
                ? pathname === item.href || pathname.startsWith(`${item.href}/`)
                : pathname === item.href;

            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-[14px] border px-3 py-3 text-[13px] font-semibold transition-colors",
                    parentActive
                      ? "border-[#7c6d38] bg-[linear-gradient(90deg,rgba(92,73,28,0.52),rgba(63,49,21,0.28))] text-white"
                      : "border-transparent text-white/78 hover:border-white/8 hover:bg-white/[0.03] hover:text-white",
                  )}
                >
                  <item.icon className={cn("h-4 w-4", parentActive ? "text-[#f0df9c]" : "text-white/55")} />
                  <span>{item.label}</span>
                </Link>
                {item.children?.length ? (
                  <div className="ml-5 mt-1 space-y-1 border-l border-white/10 pl-2">
                    {item.children.map((child) => {
                      const childActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            "flex items-center gap-2 rounded-[11px] border px-3 py-2.5 text-[12px] font-semibold transition-colors",
                            childActive
                              ? "border-[#7c6d38]/70 bg-[#5c491c]/25 text-[#f4e8b6]"
                              : "border-transparent text-white/50 hover:border-white/8 hover:bg-white/[0.03] hover:text-white/80",
                          )}
                        >
                          <child.icon className={cn("h-3.5 w-3.5", childActive ? "text-[#f0df9c]" : "text-white/35")} />
                          <span>{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto rounded-[18px] border border-[#8a8a8a] bg-[linear-gradient(180deg,rgba(17,20,23,0.96),rgba(9,11,14,0.98))] px-4 py-4 text-[11px] leading-6 text-white/78">
        <div className="mb-2 text-[11px] font-bold text-white">運用メモ</div>
        <p>現在の実売買はAsterDEXのV35 Core＋PENGU V46です。</p>
        <p>AI研究ラボは研究専用で、実売買ロジックとは分離されています。</p>
        <p>LIVE状態・残高・ポジションは各ページ上部の現行ロジックカードで確認できます。</p>
      </div>

      <button
        type="button"
        onClick={logout}
        className="mt-4 flex items-center justify-center gap-2 rounded-[16px] border border-[#5b2736] bg-[linear-gradient(180deg,rgba(61,23,33,0.92),rgba(44,15,24,0.96))] px-4 py-3 text-sm font-semibold text-[#f1d7de] transition hover:brightness-110"
      >
        <LogOut className="h-4 w-4" />
        ログアウト
      </button>
    </aside>
  );
}

