"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, Coins, Settings, ShieldCheck, Wallet } from "lucide-react";

import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";
import { useCurrency } from "@/context/CurrencyContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

function SummaryCard({ title, value, detail, tone = "default" }: { title: string; value: string; detail: string; tone?: "default" | "profit" | "loss" }) {
  return (
    <div className="panel-gold rounded-[24px] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{title}</div>
      <div className={`mt-2 text-2xl font-black ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-white"}`}>{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/72">{detail}</div>
    </div>
  );
}

function QuickLink({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof Wallet }) {
  return (
    <Link href={href} className="group rounded-[22px] border border-gold-400/16 bg-black/20 p-4 transition hover:border-gold-300/40">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-bold text-white"><Icon className="h-4 w-4 text-gold-100" />{title}</span>
        <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-1" />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/72">{detail}</p>
    </Link>
  );
}

export default function HomePage() {
  const { wallet } = useOperationalWallet();
  const { formatPrice } = useCurrency();
  const balance = Number(wallet?.lastAsterAccountBalanceUsd ?? wallet?.lastPortfolioUsd ?? 0);
  const available = Number(wallet?.lastAsterAvailableBalanceUsd ?? wallet?.lastBalanceFormatted ?? 0);
  const positions = (wallet?.trackedHoldings || []).filter((holding) => Number(holding.amount) > 0).length;

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)] md:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
      <div className="relative z-10 space-y-3">
        <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="panel-gold rounded-[30px] p-5 md:p-7">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />DISTerminal Production</div>
            <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">V96 Crypto + V52 Stock 統合LIVE</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/82">AsterDEX上のV96 CryptoとV52 Stockを、同一の安全ゲートと口座状態で監視します。ここに表示する稼働状態は、確認済みのProduction構成に限定します。</p>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-emerald-100">LIVE / AsterDirectTradeExecutor</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V96損失上限 {config.v96DailyLossPct}%</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V52損失上限 {config.v52DailyLossPct}%</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">最大Gross {config.maximumGross.toFixed(1)} / PENGU {config.penguInitialGross.toFixed(2)}</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <SummaryCard title="AsterDEX残高" value={formatPrice(balance)} detail={`利用可能残高 ${formatPrice(available)}`} tone="profit" />
            <SummaryCard title="統合LIVE状態" value="稼働構成" detail={`管理対象の表示件数 ${positions} / 実状態は各APIを優先`} />
          </div>
        </section>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLink href="/positions" title="ダッシュボード" detail="V96 CryptoとV52 Stockの状態、リスクゲート、保有状況を確認します。" icon={BarChart3} />
          <QuickLink href="/wallets" title="AsterDEXウォレット" detail="口座残高、利用可能残高、ウォレット情報を確認します。" icon={Wallet} />
          <QuickLink href="/performance" title="成績" detail="実約定に基づく損益と保有期間を確認します。" icon={Coins} />
          <QuickLink href="/settings" title="設定" detail="認証と表示設定を確認します。実売買設定はここから変更しません。" icon={Settings} />
        </section>
        <LiveDecisionPanel compact />
      </div>
    </main>
  );
}