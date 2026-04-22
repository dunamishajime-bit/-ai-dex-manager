"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, Coins, Settings, Wallet } from "lucide-react";

import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";
import { useSimulation } from "@/context/SimulationContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";

function SummaryCard({
  title,
  value,
  text,
  tone = "default",
}: {
  title: string;
  value: string;
  text: string;
  tone?: "default" | "profit" | "loss";
}) {
  return (
    <div className="panel-gold rounded-[24px] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-gold-100/72">{title}</div>
      <div
        className={`mt-2 text-[1.45rem] font-black ${
          tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-white/78">{text}</div>
    </div>
  );
}

function QuickLink({
  href,
  title,
  text,
  icon: Icon,
}: {
  href: string;
  title: string;
  text: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[22px] border border-gold-400/16 bg-[linear-gradient(180deg,rgba(8,10,15,0.34),rgba(4,6,10,0.64))] px-4 py-4 transition hover:border-gold-300/36"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Icon className="h-4 w-4 text-gold-100" />
          {title}
        </div>
        <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-0.5" />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/76">{text}</p>
    </Link>
  );
}

export default function HomePage() {
  const { activeStrategies, tradeNotifications } = useSimulation();
  const { wallet } = useOperationalWallet();
  const holdings = (wallet?.trackedHoldings || []).filter((holding) => Number(holding.amount) > 0);
  const usdtHolding = holdings.find((holding) => holding.symbol === "USDT");
  const portfolioUsd = Number(wallet?.lastPortfolioUsd || 0);
  const cashUsd = Number(usdtHolding?.usdValue || 0);
  const isWalletRunning = wallet?.status === "running";

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="absolute inset-0 bg-[url('/backgrounds/login_bg.png')] bg-cover bg-center opacity-[0.22] mix-blend-screen" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.12),rgba(3,5,10,0.68))]" />

      <div className="relative z-10 space-y-3 p-3 md:p-4">
        <section className="grid gap-3 xl:grid-cols-[1.06fr_0.94fr]">
          <div className="panel-gold rounded-[30px] p-4 md:p-5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-100/76">
              <Wallet className="h-3.5 w-3.5" />
              Professional DisManager
            </div>
            <h1 className="gold-heading mt-3 text-[2.2rem] font-black tracking-tight md:text-[3rem]">
              運用ウォレットの状況を一画面で確認します。
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/86 md:text-[15px]">
              実際の運用ウォレット残高、自動売買の状態、判定内容、取引履歴へすぐ移動できます。
              日々の確認と判断をここから進められる自分専用のホームです。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-gold-400/20 bg-[linear-gradient(90deg,rgba(253,224,71,0.12),rgba(245,158,11,0.08))] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
                運用ウォレット確認
              </span>
              <span className="rounded-full border border-gold-400/20 bg-[linear-gradient(90deg,rgba(253,224,71,0.12),rgba(245,158,11,0.08))] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
                自動売買の状態確認
              </span>
              <span className="rounded-full border border-gold-400/20 bg-[linear-gradient(90deg,rgba(253,224,71,0.12),rgba(245,158,11,0.08))] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
                履歴と設定の整理
              </span>
            </div>
          </div>

          <div className="grid gap-3">
            <SummaryCard
              title="Portfolio"
              value={`$${portfolioUsd.toFixed(2)}`}
              text={`USDT ${cashUsd.toFixed(2)} / 保有資産 ${holdings.length}`}
            />
            <SummaryCard
              title="Auto Trade"
              value={isWalletRunning ? "稼働中" : "停止中"}
              text="運用ウォレットの状態をもとに、自動売買の稼働状況を表示しています。"
              tone={isWalletRunning ? "profit" : "loss"}
            />
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <QuickLink href="/wallets" title="運用ウォレット" text="入金確認、保有資産、ウォレット状態を確認します。" icon={Wallet} />
          <QuickLink href="/positions" title="ダッシュボード" text="自動売買の判定内容と現在の状態を確認します。" icon={BarChart3} />
          <QuickLink href="/history" title="トレード履歴" text="約定履歴、取得単価、損益の流れを確認します。" icon={Coins} />
          <QuickLink href="/settings" title="設定" text="認証設定や運用に必要な基本設定を整理します。" icon={Settings} />
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <SummaryCard title="Strategies" value={`${activeStrategies.length}`} text="現在読み込み中の戦略数です。" />
          <SummaryCard title="Notifications" value={`${tradeNotifications.length}`} text="最新の通知件数です。" />
          <SummaryCard title="Positions" value={`${holdings.length}`} text="現在保有中の運用ウォレット資産数です。" />
        </section>

        <LiveDecisionPanel compact />
      </div>
    </main>
  );
}
