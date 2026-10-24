"use client";

import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Coins, Settings, ShieldCheck, Wallet } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { RunnerHealthPanel } from "@/components/features/RunnerHealthPanel";

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
  const { snapshot, error: liveError } = useLivePortfolio();
  const { formatPrice } = useCurrency();
  const balance = snapshot?.account.balanceUsd ?? null;
  const available = snapshot?.account.availableUsd ?? null;
  const positions = snapshot?.positions ?? [];

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)] md:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
      <div className="relative z-10 space-y-3">
        <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="panel-gold rounded-[30px] p-5 md:p-7">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />本番運用</div>
            <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">Current Production Monitor</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/82">Asterの実残高・実建玉・未決済注文と、VPS current runtimeから取得した観測状態を表示します。</p>
            <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-100/85">runtimeが未取得・stale・release不一致の場合は、古いstatic contract値を表示せず要確認として扱います。</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <SummaryCard title="Aster残高" value={balance === null ? "未取得" : formatPrice(balance)} detail={available === null ? "利用可能残高：未取得" : `利用可能：${formatPrice(available)}`} tone="profit" />
            <SummaryCard title="実建玉 / 未決済注文" value={snapshot ? `${positions.length} / ${snapshot.orders.count}` : "未取得"} detail={snapshot ? `保護注文 ${snapshot.orders.protectionCount} / ${snapshot.capturedAt.replace("T", " ").slice(0, 16)} UTC` : liveError || "Aster実データを取得できません"} />
          </div>
        </section>
        <RunnerHealthPanel />
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <QuickLink href="/positions" title="ダッシュボード" detail="V12、PENGU V2、FET、V52、Quality102の実建玉・保護注文・リスク状態を確認します。" icon={BarChart3} />
          <QuickLink href="/decision-status" title="判定状況・ロジック詳細" detail="V12 V4 / PENGU / Q102 / FET / HYPE / Idle / V52の実効条件を確認します。" icon={ShieldCheck} />
          <QuickLink href="/realtime" title="リアルタイム判定" detail="全通貨ランキング、各ロジックのスコア、判定理由、データ鮮度を30秒更新で確認します。" icon={Activity} />
          <QuickLink href="/wallets" title="AsterDEXウォレット" detail="口座残高、利用可能残高、ウォレット情報を確認します。" icon={Wallet} />
          <QuickLink href="/performance" title="成績" detail="実約定に基づく損益と保有期間を確認します。" icon={Coins} />
          <QuickLink href="/settings" title="設定" detail="認証と表示設定を確認します。実売買設定はここから変更しません。" icon={Settings} />
        </section>
        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold"><BarChart3 className="h-4 w-4 text-gold-100" />Aster実建玉</div><span className="text-[11px] text-white/55">30秒ごとに更新</span></div>
          <div className="mt-3 space-y-2">
            {positions.length ? positions.map((position) => <div key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{position.symbol} <span className={position.side === "LONG" ? "text-profit" : "text-loss"}>{position.side}</span></div><div className="text-xs text-white/60">数量 {position.quantity.toFixed(6)} / 建玉評価額 {formatPrice(position.notionalUsd)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-profit" : "text-loss"}>{formatPrice(position.unrealizedPnlUsd)}</div><div className="text-xs text-white/55">Entry {position.entryPrice > 0 ? position.entryPrice.toFixed(6) : "—"} / Mark {position.markPrice > 0 ? position.markPrice.toFixed(6) : "—"}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/65">{snapshot ? "現在、Asterで確認できる実建玉はありません。" : "Aster実建玉を取得できません。"}</div>}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-white/55">この表示はAsterの読み取り結果です。HPから注文・取消・決済・建玉変更は行いません。</p>
        </section>
      </div>
    </main>
  );
}
