"use client";

import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Coins, Settings, ShieldCheck, Wallet } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
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

function V52Top2Summary() {
  const policy = config.v52Top2Policy;
  return (
    <section className="panel-gold rounded-[30px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-gold-100" />V52 Top2 LIVE / retry-aware</div>
          <p className="mt-2 text-[12px] leading-6 text-white/78">最新VPS実装のV50候補選定を、固定snapshotのままHPに表示します。候補順位だけでは発注せず、basis・net edge・データ品質・容量Gateを通過した候補だけが発注経路へ進みます。</p>
        </div>
        <Link href="/decision-status" className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-100">判定状況で詳細を見る</Link>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] text-white/45">Top2配分</div><div className="mt-1 text-sm font-bold text-white">Rank1 {policy.rank1RequestedGross.toFixed(2)}x / Rank2 {policy.rank2RequestedGross.toFixed(2)}x</div></div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] text-white/45">容量上限</div><div className="mt-1 text-sm font-bold text-white">最大{policy.maxConcurrentPositions}建玉 / 日次{policy.maxDailyEntries}件</div></div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] text-white/45">発火Gate</div><div className="mt-1 text-sm font-bold text-white">basis ≥ {policy.minEntryBasisBps}bps / net edge ≥ {policy.minNetEdgeBps}bps</div></div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] text-white/45">判定窓</div><div className="mt-1 text-sm font-bold text-white">NY {policy.windowsNy.join(" / ")}（各{policy.entryWindowSeconds}秒）</div></div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-white/58">一時的なデータ品質・板・spread拒否は窓内retry、basis/net edge不足やSIGN_CHANGED等は最終拒否。注文・取消・決済はHPから実行しません。</p>
    </section>
  );
}

export default function HomePage() {
  const { wallet } = useOperationalWallet();
  const { snapshot, loading: liveLoading, error: liveError } = useLivePortfolio();
  const { formatPrice } = useCurrency();
  const balance = snapshot?.account.balanceUsd ?? (typeof wallet?.lastAsterAccountBalanceUsd === "number" ? wallet.lastAsterAccountBalanceUsd : null);
  const available = snapshot?.account.availableUsd ?? (typeof wallet?.lastAsterAvailableBalanceUsd === "number" ? wallet.lastAsterAvailableBalanceUsd : null);
  const positions = snapshot?.positions ?? [];
  const liveStatus = snapshot ? "Aster同期済み" : liveLoading ? "取得中" : "実状態未取得";

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)] md:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
      <div className="relative z-10 space-y-3">
        <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="panel-gold rounded-[30px] p-5 md:p-7">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />DISTerminal Production</div>
            <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">{config.strategyLabel}</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/82">AsterDEXのV12 X1.00 ALL、PENGU V2 / Recovery V8、V52 Stockを、同一口座の実残高・実建玉・未決済注文とともに読み取り表示します。取得できない値は推測せず、未取得として表示します。</p>
            <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className={`rounded-full border px-3 py-1.5 ${snapshot ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100" : "border-amber-400/25 bg-amber-500/10 text-amber-100"}`}>LIVE状態: {liveStatus}</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V12 X1.00 ALL</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">PENGU V2 / Recovery V8</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V12+PENGU共有損失上限 {config.sharedCryptoDailyLossPct}%</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V52損失上限 {config.v52DailyLossPct}%</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">Portfolio Gross上限 ≤ {config.maximumGross.toFixed(1)}x</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V12 {config.v12SizingMode}</span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V52 Stock {config.v52StockGross.toFixed(1)}x / 最大{config.v52MaxConcurrentPositions}建玉</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <SummaryCard title="Aster balance" value={balance === null ? "UNAVAILABLE" : formatPrice(balance)} detail={available === null ? "Aster account balance unavailable" : `Available ${formatPrice(available)}`} tone="profit" />
            <SummaryCard title="実建玉 / 未決済注文" value={snapshot ? `${positions.length} / ${snapshot.orders.count}` : "UNAVAILABLE"} detail={snapshot ? `保護注文 ${snapshot.orders.protectionCount} / ${snapshot.capturedAt.replace("T", " ").slice(0, 16)} UTC` : liveError || "Aster live state unavailable"} />
          </div>
        </section>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLink href="/positions" title="ダッシュボード" detail="V12、PENGU V2、V52の実建玉・保護注文・リスク状態を確認します。" icon={BarChart3} />
          <QuickLink href="/wallets" title="AsterDEXウォレット" detail="口座残高、利用可能残高、ウォレット情報を確認します。" icon={Wallet} />
          <QuickLink href="/performance" title="成績" detail="実約定に基づく損益と保有期間を確認します。" icon={Coins} />
          <QuickLink href="/settings" title="設定" detail="認証と表示設定を確認します。実売買設定はここから変更しません。" icon={Settings} />
        </section>
        <V52Top2Summary />
        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold"><BarChart3 className="h-4 w-4 text-gold-100" />現在のAster実建玉</div><span className="text-[11px] text-white/55">30秒ごとに再取得</span></div>
          <div className="mt-3 space-y-2">
            {positions.length ? positions.map((position) => <div key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{position.symbol} <span className={position.side === "LONG" ? "text-profit" : "text-loss"}>{position.side}</span></div><div className="text-xs text-white/60">数量 {position.quantity.toFixed(6)} / 建玉評価額 {formatPrice(position.notionalUsd)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-profit" : "text-loss"}>{formatPrice(position.unrealizedPnlUsd)}</div><div className="text-xs text-white/55">Entry {position.entryPrice > 0 ? position.entryPrice.toFixed(6) : "—"} / Mark {position.markPrice > 0 ? position.markPrice.toFixed(6) : "—"}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/65">{snapshot ? "現在、Asterで確認できる実建玉はありません。" : "Aster実建玉を取得できません。"}</div>}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-white/55">この表示はAsterの読み取り結果です。HPから注文・取消・決済・建玉変更は行いません。</p>
        </section>
      </div>
    </main>
  );
}
