"use client";

import { Activity, AlertTriangle, Layers3, ShieldCheck } from "lucide-react";
import { useCurrency } from "@/context/CurrencyContext";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { useAsterTradeActivity } from "@/hooks/useAsterTradeActivity";
import { useLogicStatus } from "@/hooks/useLogicStatus";

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{label}</div><div className="mt-2 text-xl font-black text-white">{value}</div><div className="mt-1 text-[11px] leading-5 text-white/72">{detail}</div></div>;
}

export default function PositionsPage() {
  const { snapshot, loading, error } = useLivePortfolio();
  const { activity } = useAsterTradeActivity();
  const { v12, pengu, v52, status } = useLogicStatus();
  const { formatPrice, formatLarge } = useCurrency();
  const logicCards = [{ label: "V12 X1.00 ALL", data: v12, description: "Aster Futures V3 14銘柄 runner" }, { label: "PENGU V2", data: pengu, description: "PENGUUSDT crypto runner" }, { label: "V52", data: v52, description: "株式参照・発注 runner" }];

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white md:p-4">
      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-5 md:p-7"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />Aster LIVE dashboard</div><h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">ダッシュボード</h1><p className="mt-3 max-w-4xl text-sm leading-7 text-white/82">残高・建玉・通知はAsterDEXの実口座と直近24時間の公式約定履歴から表示しています。</p></header>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="残高 (JPY)" value={snapshot ? formatLarge(snapshot.account.balanceUsd) : "—"} detail={snapshot ? `USD ${formatPrice(snapshot.account.balanceUsd)}` : error || "残高取得待ち"} /><Metric label="POSITIONS" value={snapshot ? String(snapshot.positions.length) : "—"} detail="現在のAster建玉保有数" /><Metric label="NOTIFICATIONS" value={activity ? String(activity.total) : "—"} detail="24時間以内のトレード回数" /><Metric label="WALLET" value={status === "running" && snapshot ? "稼働中" : "問題あり"} detail={status === "running" ? "安全ゲート確認済み" : "判定状況を確認"} /></section>
        <section className="grid gap-3 md:grid-cols-3">{logicCards.map(({ label, data, description }) => <div key={label} className="panel-gold rounded-[26px] p-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-gold-100" />{label}</div><span className={data?.status === "running" ? "text-emerald-300" : "text-rose-300"}>{data?.status === "running" ? "稼働中" : "停止 / 要確認"}</span></div><p className="mt-3 text-[12px] text-white/72">{description}</p><p className="mt-2 text-[11px] leading-5 text-white/55">{data?.status === "running" ? `service: ${data.service.subState} / PID ${data.service.mainPid}` : "停止 / 要確認"}</p></div>)}</section>
        {v12?.status !== "running" && v12?.reason ? <div className="flex items-start gap-3 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>V12はFail Closedです: {v12.reason}</span></div> : null}
        <section className="panel-gold rounded-[30px] p-4 md:p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold"><Layers3 className="h-4 w-4 text-gold-100" />24時間トレード通知</div><span className="text-[11px] text-white/55">公式Aster約定履歴</span></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="V12" value={activity ? String(activity.byStrategy.V12) : "—"} detail="直近24時間" /><Metric label="PENGU V2" value={activity ? String(activity.byStrategy.PENGU) : "—"} detail="直近24時間" /><Metric label="V52" value={activity ? String(activity.byStrategy.V52) : "—"} detail="直近24時間" /></div></section>
        <section className="panel-gold rounded-[30px] p-4 md:p-5"><div className="flex items-center justify-between gap-3"><div className="text-sm font-bold">OPERATIONALWALLET — 現在の建玉</div><span className="text-[11px] text-white/55">30秒ごとに更新</span></div><div className="mt-4 space-y-2">{snapshot?.positions.length ? snapshot.positions.map((position) => <div key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{position.symbol} <span className={position.side === "LONG" ? "text-profit" : "text-loss"}>{position.side}</span></div><div className="text-xs text-white/60">数量 {position.quantity.toFixed(6)} / 評価額 {formatPrice(position.notionalUsd)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-profit" : "text-loss"}>{formatPrice(position.unrealizedPnlUsd)}</div><div className="text-xs text-white/55">Entry {position.entryPrice.toFixed(6)} / Mark {position.markPrice.toFixed(6)}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/65">{snapshot ? "現在、Asterで確認できる実建玉はありません。" : loading ? "Aster実建玉を照合中…" : error || "Aster実建玉を取得できません。"}</div>}</div></section>
        <p className="rounded-[22px] border border-gold-400/14 bg-black/25 px-4 py-3 text-[11px] leading-5 text-white/62">この画面は読み取り専用です。HPから注文・取消・決済・建玉変更は行いません。</p>
      </div>
    </main>
  );
}
