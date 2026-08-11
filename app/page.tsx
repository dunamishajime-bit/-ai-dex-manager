"use client";

import Link from "next/link";
import { ArrowRight, BarChart3, Coins, Settings, ShieldCheck, Wallet } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { useLiveServiceStatus } from "@/hooks/useLiveServiceStatus";
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
  const liveService = useLiveServiceStatus();
  const { formatPrice } = useCurrency();
  const balance = typeof wallet?.lastAsterAccountBalanceUsd === "number" ? wallet.lastAsterAccountBalanceUsd : null;
  const available = typeof wallet?.lastAsterAvailableBalanceUsd === "number" ? wallet.lastAsterAvailableBalanceUsd : null;
  const positions = (wallet?.trackedHoldings || []).filter((holding) => Number(holding.amount) > 0).length;
  const liveLabel = liveService.loading && liveService.checkedAt === null
    ? "確認中"
    : liveService.state === "ACTIVE"
      ? "稼働中"
      : liveService.state === "STOPPED"
        ? "停止中"
        : "未確認";
  const liveBadgeClass = liveService.state === "ACTIVE"
    ? "border-emerald-400/30 bg-emerald-500/12 text-emerald-100"
    : liveService.state === "STOPPED"
      ? "border-rose-400/30 bg-rose-500/12 text-rose-100"
      : "border-amber-400/25 bg-amber-500/10 text-amber-100";
  const liveCheckedAt = liveService.checkedAt
    ? new Date(liveService.checkedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
    : "未確認";

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)] md:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
      <div className="relative z-10 space-y-3">
        <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="panel-gold rounded-[30px] p-5 md:p-7">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />DISTerminal Production</div>
            <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">{config.strategyLabel}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/82">AsterDEX上のV96 Crypto、独立したPENGU Dual LS V2、V52 Stockを、同一の安全ゲートと口座状態で監視します。実サービス状態を取得できない場合は、LIVE稼働中とは表示しません。</p>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className={`rounded-full border px-3 py-1.5 ${liveBadgeClass}`}>
                LIVE状態: {liveLabel} / {config.executor}
              </span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">{config.penguStrategyId}</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V96損失上限 {config.v96DailyLossPct}%</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V52損失上限 {config.v52DailyLossPct}%</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">最大Gross {config.maximumGross.toFixed(1)} / PENGU {config.penguInitialGross.toFixed(2)}</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <SummaryCard title="Aster balance" value={balance === null ? "UNAVAILABLE" : formatPrice(balance)} detail={available === null ? "Aster account balance unavailable" : `Available ${formatPrice(available)}`} tone="profit" />
            <SummaryCard
              title="統合LIVE状態"
              value={liveLabel}
              detail={`${liveService.mainPid && liveService.state === "ACTIVE" ? `MainPID ${liveService.mainPid}` : "MainPID 未確認"} / 最終確認 ${liveCheckedAt} / 保有表示 ${positions}`}
              tone={liveService.state === "ACTIVE" ? "profit" : liveService.state === "STOPPED" ? "loss" : "default"}
            />
          </div>
        </section>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLink href="/positions" title="ダッシュボード" detail="V96 CryptoとV52 Stockの状態、リスクゲート、保有状況を確認します。" icon={BarChart3} />
          <QuickLink href="/wallets" title="AsterDEXウォレット" detail="口座残高、利用可能残高、ウォレット情報を確認します。" icon={Wallet} />
          <QuickLink href="/performance" title="成績" detail="実約定に基づく損益と保有期間を確認します。" icon={Coins} />
          <QuickLink href="/settings" title="設定" detail="認証と表示設定を確認します。実売買設定はここから変更しません。" icon={Settings} />
        </section>
      </div>
    </main>
  );
}
