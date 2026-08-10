"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BarChart3, Coins, Settings, ShieldCheck, Wallet } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

function SummaryCard({ title, value, detail, tone = "default" }: { title: string; value: string; detail: string; tone?: "default" | "profit" | "loss" }) {
  return <div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{title}</div><div className={`mt-2 text-2xl font-black ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-white"}`}>{value}</div><div className="mt-1 text-[11px] leading-5 text-white/72">{detail}</div></div>;
}

function QuickLink({ href, title, detail, icon: Icon }: { href: string; title: string; detail: string; icon: typeof Wallet }) {
  return <Link href={href} className="group block rounded-[22px] border border-gold-400/16 bg-black/20 p-4 transition hover:border-gold-300/40"><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-bold text-white"><Icon className="h-4 w-4 text-gold-100" />{title}</span><ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-1" /></div><p className="mt-2 text-[11px] leading-5 text-white/72">{detail}</p></Link>;
}

type MarketStatus = {
  value: "市場時間内" | "市場時間外";
  code: "ACTIVE" | "WAITING_MARKET_CLOSED";
  detail: string;
  checkedAt: string;
};

function getMarketStatus(now = new Date()): MarketStatus {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const weekday = values.weekday;
  const isOpen = weekday !== "Sat" && weekday !== "Sun" && minutes >= 570 && minutes < 960;
  const checkedAt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(now);

  return isOpen
    ? { value: "市場時間内", code: "ACTIVE", detail: "V52 Stockは参照データ確認後に判定", checkedAt }
    : { value: "市場時間外", code: "WAITING_MARKET_CLOSED", detail: "V52 Stockは注文判定を停止", checkedAt };
}

export default function HomePage() {
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(() => getMarketStatus());
  const { wallet } = useOperationalWallet();
  const { formatPrice } = useCurrency();
  const balance = typeof wallet?.lastAsterAccountBalanceUsd === "number" ? wallet.lastAsterAccountBalanceUsd : null;
  const available = typeof wallet?.lastAsterAvailableBalanceUsd === "number" ? wallet.lastAsterAvailableBalanceUsd : null;
  const positions = (wallet?.trackedHoldings || []).filter((holding) => Number(holding.amount) > 0).length;

  useEffect(() => {
    const timer = window.setInterval(() => setMarketStatus(getMarketStatus()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)] md:p-4"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" /><div className="relative z-10 space-y-3"><section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]"><div className="panel-gold rounded-[30px] p-5 md:p-7"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />DISTerminal Production</div><h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">{config.strategyLabel}</h1><p className="mt-4 max-w-3xl text-sm leading-7 text-white/82">現在の実運用表示はPENGU Dual LS V1を中心にし、V52 Stockは米国株市場時間内だけ注文判定を許可します。V96/V97は現在の実ランナーでは停止中です。稼働状態は実APIで確認できた場合だけ表示します。</p><div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold"><span className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-white/75">LIVE状態：実API確認</span><span className="rounded-full border border-gold-400/20 bg-gold-400/10 text-gold-50">V96/V97：停止</span><span className="rounded-full border border-gold-400/20 bg-gold-400/10 text-gold-50">V52：市場時間外は待機</span><span className="rounded-full border border-gold-400/20 bg-gold-400/10 text-gold-50">PENGU Gross {config.penguMaximumGross.toFixed(2)} / 初期 {config.penguInitialGross.toFixed(2)}</span></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><SummaryCard title="Aster balance" value={balance === null ? "取得不能" : formatPrice(balance)} detail={available === null ? "残高データを取得できません" : `利用可能 ${formatPrice(available)}`} tone="profit" /><SummaryCard title="市場状況" value={marketStatus.value} detail={`V52 Stock: ${marketStatus.code} / ${marketStatus.detail} / 確認 ${marketStatus.checkedAt}`} /></div></section><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><QuickLink href="/positions" title="ダッシュボード" detail="PENGU Dual LS V1、V52 Stock、リスクゲート、保有状況を確認します。" icon={BarChart3} /><QuickLink href="/wallets" title="運用ウォレット" detail="Aster口座残高と利用可能残高を、取得時刻付きで確認します。" icon={Wallet} /><QuickLink href="/performance" title="成績" detail="公式履歴が取得できる範囲の実績と分析を確認します。" icon={Coins} /><QuickLink href="/settings" title="設定" detail="表示設定を確認します。取引設定や安全Gateは画面から変更しません。" icon={Settings} /></section><QuickLink href="/decision-status" title="判定状況" detail="PENGUのLong/Short判定と、V52の市場時間・データ状態を読み取り表示します。" icon={BarChart3} /><div className="text-xs text-white/55">保有表示件数：{positions} / 注文・取消・建玉変更はこの画面から行いません。</div></div></main>;
}
