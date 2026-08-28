"use client";

import { Activity, Layers3, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { MetricCard, StrategyOverviewCards } from "@/components/features/DecisionUi";
import { useCurrency } from "@/context/CurrencyContext";
import { useDecisionStatus } from "@/hooks/useDecisionStatus";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { buildDecisionViewModel } from "@/lib/ui/disterminal-ui-view-model";

type HistoryPayload = {
  officialHistory?: boolean;
  entries?: Array<{ tradeStatus?: string; realizedPnlUsd?: number; netPnlUsd?: number }>;
  readOnlyError?: string;
};

function signedPrice(value: number | null, formatPrice: (value: number) => string) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${formatPrice(value)}`;
}

export default function PositionsPage() {
  const { snapshot: portfolio, loading, error } = useLivePortfolio();
  const { snapshot: decisionSnapshot, loading: decisionLoading, error: decisionError } = useDecisionStatus();
  const { formatPrice } = useCurrency();
  const [realizedPnl, setRealizedPnl] = useState<number | null>(null);
  const [historySource, setHistorySource] = useState("未取得");
  const model = decisionSnapshot ? buildDecisionViewModel({ ...decisionSnapshot, portfolio: portfolio ? { positions: portfolio.positions } : undefined }) : null;

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const response = await fetch("/api/system/trade-history", { cache: "no-store" });
        const data = await response.json() as HistoryPayload;
        if (!response.ok) throw new Error(data.readOnlyError || "履歴未取得");
        if (cancelled) return;
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const closed = entries.filter((entry) => entry.tradeStatus === "closed" && typeof entry.realizedPnlUsd === "number");
        setRealizedPnl(closed.reduce((sum, entry) => sum + Number(entry.netPnlUsd ?? entry.realizedPnlUsd ?? 0), 0));
        setHistorySource(data.officialHistory ? "Aster official settled fills" : data.readOnlyError || "ローカル履歴");
      } catch (nextError) {
        if (!cancelled) {
          setRealizedPnl(null);
          setHistorySource(nextError instanceof Error ? nextError.message : "履歴未取得");
        }
      }
    };
    void loadHistory();
    const interval = window.setInterval(() => void loadHistory(), 30_000);
    return () => { cancelled = true; };
  }, []);

  const activeStrategies = model?.strategyCards.filter((card) => card.runtimeStatus === "LIVE").length;
  const activeSignals = model?.strategyCards.reduce((sum, card) => sum + (card.eligibleDirections ?? 0), 0);

  return <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white md:p-4">
    <div className="relative z-10 space-y-4">
      <header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/75"><ShieldCheck className="h-4 w-4" />TRADING COCKPIT / READ ONLY</div><div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="gold-heading text-3xl font-black tracking-tight md:text-5xl">運用ダッシュボード</h1><p className="mt-3 max-w-4xl text-sm leading-7 text-white/68">口座、損益、実建玉、注文、3ロジックの実Runner状態を一画面で俯瞰します。判定の細部は判定状況ページに分離しています。</p></div><div className="text-left text-xs text-white/45 lg:text-right">{decisionLoading ? "判定状態を確認中…" : decisionError || "判定状態を確認済み"}<br />{loading ? "Aster portfolioを取得中…" : error || "Aster portfolioを確認済み"}</div></div></header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Total Balance" value={portfolio ? formatPrice(portfolio.account.balanceUsd) : "—"} detail="Aster total margin balance" /><MetricCard label="Available Balance" value={portfolio ? formatPrice(portfolio.account.availableUsd) : "—"} detail="Aster available balance" /><MetricCard label="Unrealized PnL" value={portfolio ? signedPrice(portfolio.account.unrealizedPnlUsd, formatPrice) : "—"} detail="Aster account unrealized" tone={portfolio && portfolio.account.unrealizedPnlUsd < 0 ? "negative" : "positive"} /><MetricCard label="Realized PnL" value={signedPrice(realizedPnl, formatPrice)} detail={historySource} tone={realizedPnl !== null && realizedPnl < 0 ? "negative" : "positive"} /></section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Open Positions" value={portfolio ? String(portfolio.positions.length) : "—"} detail="Aster position risk" /><MetricCard label="Open Orders" value={portfolio ? String(portfolio.orders.count) : "—"} detail={portfolio ? `保護注文 ${portfolio.orders.protectionCount}` : "Aster order state"} /><MetricCard label="Active Strategies" value={activeStrategies === undefined ? "—" : String(activeStrategies)} detail="runtime status=LIVE" /><MetricCard label="Observed Signals" value={activeSignals === undefined ? "—" : String(activeSignals)} detail="Long / Shortの実成立方向" /></section>

      <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-gold-100" /><div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-100/68">STRATEGY OVERVIEW</div><h2 className="mt-1 text-xl font-black">ロジック別サマリー</h2></div></div><div className="mt-4">{model ? <StrategyOverviewCards cards={model.strategyCards} /> : <div className="rounded-2xl border border-dashed border-white/12 px-4 py-8 text-center text-sm text-white/50">ロジック状態を取得しています…</div>}</div></section>

      <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-gold-100" /><h2 className="text-xl font-black">現在のAster実建玉</h2></div><div className="mt-4 space-y-2">{portfolio?.positions.length ? portfolio.positions.map((position) => <article key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3"><div><div className="font-bold text-white">{position.symbol} <span className={position.side === "LONG" ? "text-emerald-200" : "text-rose-200"}>{position.side}</span></div><div className="mt-1 text-xs text-white/50">数量 {position.quantity.toFixed(6)} / 建玉評価額 {formatPrice(position.notionalUsd)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-emerald-200" : "text-rose-200"}>{signedPrice(position.unrealizedPnlUsd, formatPrice)}</div><div className="text-xs text-white/45">Entry {position.entryPrice.toFixed(6)} / Mark {position.markPrice.toFixed(6)}</div></div></article>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/55">{portfolio ? "現在、Asterで確認できる実建玉はありません。" : error || "Aster実建玉を取得できません。"}</div>}</div></section>

      <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-gold-100" /><h2 className="text-xl font-black">未決済注文</h2></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{portfolio?.orders.items.length ? portfolio.orders.items.map((order, index) => <article key={`${order.symbol}-${order.side}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs"><div className="font-bold text-white">{order.symbol} {order.side}</div><div className="mt-1 text-white/55">{order.type} / {order.status} / Qty {order.quantity}</div><div className="mt-2 text-white/45">{order.protection ? "保護注文" : "通常注文"}</div></article>) : <div className="sm:col-span-2 lg:col-span-3 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/55">{portfolio ? "未決済注文はありません。" : "Aster注文状態を取得できません。"}</div>}</div></section>

      <p className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-[11px] leading-5 text-white/45">この画面は読み取り専用です。実残高・建玉・注文はAster、判定状態はVPS runner snapshotを正本とします。</p>
    </div>
  </main>;
}
