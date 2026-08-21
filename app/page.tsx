"use client";

import Link from "next/link";
import { Activity, ArrowRight, BarChart3, CalendarDays, Coins, ShieldCheck, Wallet } from "lucide-react";

import { useAsterTradeActivity } from "@/hooks/useAsterTradeActivity";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { useLogicStatus } from "@/hooks/useLogicStatus";
import { useCurrency } from "@/context/CurrencyContext";

function Card({ title, value, detail, tone = "default" }: { title: string; value: string; detail: string; tone?: "default" | "good" | "bad" }) {
  return (
    <div className="panel-gold rounded-[24px] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-gold-100/72">{title}</div>
      <div className={`mt-2 text-[1.45rem] font-black ${tone === "good" ? "text-profit" : tone === "bad" ? "text-loss" : "text-white"}`}>{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/75">{detail}</div>
    </div>
  );
}

function logicLabel(status?: "running" | "blocked") {
  return status === "running" ? "稼働中" : status === "blocked" ? "問題あり / 停止" : "取得不能";
}

function mask(value?: string | null) {
  if (!value) return "未接続";
  return value;
}

export default function HomePage() {
  const { snapshot, error: portfolioError } = useLivePortfolio();
  const { activity, error: historyError } = useAsterTradeActivity();
  const { snapshot: logic, loading: logicLoading } = useLogicStatus();
  const { jpyRate } = useCurrency();
  const balanceUsd = snapshot?.account.balanceUsd ?? null;
  const balanceJpy = balanceUsd === null ? null : balanceUsd * jpyRate;
  const positions = snapshot?.positions || [];
  const liveOk = logic?.status === "running";

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.06)] md:p-4">
      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-5 md:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><Wallet className="h-4 w-4" />AsterDEX LIVE Portfolio</div>
            <div className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${liveOk ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" : "border-rose-400/30 bg-rose-500/10 text-rose-100"}`}>
              {logicLoading ? "状態確認中" : liveOk ? "全ロジック稼働中" : "一部ロジックに問題あり"}
            </div>
          </div>
          <h1 className="gold-heading mt-3 text-[2.1rem] font-black tracking-tight md:text-[3rem]">AsterDEX口座と自動売買の現在状態</h1>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-white/82">残高・建玉・24時間以内の約定回数は、AsterDEXとVPSの正本データから読み取り表示しています。取得不能な値は推測表示しません。</p>
          {logic?.v12.reason ? <p className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">V12: {logic.v12.reason}</p> : null}
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card title="ASTERDEX BALANCE" value={balanceUsd === null ? "取得不能" : `$${balanceUsd.toFixed(2)}`} detail={portfolioError || "口座総評価額（USD）"} tone={balanceUsd === null ? "bad" : "good"} />
          <Card title="POSITIONS" value={snapshot ? String(positions.length) : "取得不能"} detail="AsterDEXの現在の建玉保有数" />
          <Card title="NOTIFICATIONS" value={String(activity.total)} detail={historyError || "直近24時間の約定回数"} />
          <Card title="DASHBOARD BALANCE" value={balanceJpy === null ? "取得不能" : `¥${Math.round(balanceJpy).toLocaleString("ja-JP")}`} detail={`USD/JPY ${jpyRate.toFixed(2)} / ダッシュボード表示`} />
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          {(["v12", "pengu", "v52"] as const).map((key) => {
            const item = logic?.[key];
            const title = key === "v12" ? "V12 X1.00 ALL" : key === "pengu" ? "PENGU V2" : "V52 Stock";
            return <Card key={key} title={title} value={logicLabel(item?.status)} detail={item?.service ? `${item.service.activeState}/${item.service.subState} · PID ${item.service.mainPid || "—"}` : "状態取得待ち"} tone={item?.status === "running" ? "good" : "bad"} />;
          })}
        </section>

        <section className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="panel-gold rounded-[30px] p-4 md:p-5">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-lg font-black"><BarChart3 className="h-5 w-5 text-gold-100" />現在の建玉（OPERATIONAL WALLET）</div><span className="text-[11px] text-white/55">30秒更新</span></div>
            <div className="mt-4 space-y-2">
              {positions.length ? positions.map((position) => <div key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{position.symbol} <span className={position.side === "LONG" ? "text-profit" : "text-loss"}>{position.side}</span></div><div className="text-xs text-white/60">数量 {position.quantity.toFixed(6)} / 評価額 ${position.notionalUsd.toFixed(2)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-profit" : "text-loss"}>{position.unrealizedPnlUsd >= 0 ? "+" : ""}${position.unrealizedPnlUsd.toFixed(4)}</div><div className="text-xs text-white/55">Entry {position.entryPrice.toFixed(6)} / Mark {position.markPrice.toFixed(6)}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/65">{snapshot ? "現在、AsterDEXで確認できる建玉はありません。" : portfolioError || "AsterDEX建玉を取得できません。"}</div>}
            </div>
          </div>
          <div className="panel-gold rounded-[30px] p-4 md:p-5">
            <div className="flex items-center gap-2 text-lg font-black"><Activity className="h-5 w-5 text-gold-100" />24時間の通知数</div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-1"><Card title="V12" value={String(activity.byStrategy.V12)} detail="24時間の約定" /><Card title="PENGU" value={String(activity.byStrategy.PENGU)} detail="24時間の約定" /><Card title="V52" value={String(activity.byStrategy.V52)} detail="24時間の約定" /></div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/positions" className="group rounded-[22px] border border-gold-400/16 bg-white/[0.03] px-4 py-4"><div className="flex items-center justify-between font-bold">ダッシュボード<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></div><p className="mt-2 text-xs text-white/65">判定Gateと建玉</p></Link>
          <Link href="/wallets" className="group rounded-[22px] border border-gold-400/16 bg-white/[0.03] px-4 py-4"><div className="flex items-center justify-between font-bold">ウォレット<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></div><p className="mt-2 text-xs text-white/65">残高・維持率・余力</p></Link>
          <Link href="/history" className="group rounded-[22px] border border-gold-400/16 bg-white/[0.03] px-4 py-4"><div className="flex items-center justify-between font-bold">自動売買履歴<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></div><p className="mt-2 text-xs text-white/65">Aster公式約定履歴</p></Link>
          <Link href="/performance" className="group rounded-[22px] border border-gold-400/16 bg-white/[0.03] px-4 py-4"><div className="flex items-center justify-between font-bold"><CalendarDays className="h-4 w-4 text-gold-100" />カレンダー<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></div><p className="mt-2 text-xs text-white/65">日別損益と取引</p></Link>
        </section>

        <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-3 text-[11px] leading-5 text-white/60"><ShieldCheck className="mr-2 inline h-4 w-4 text-gold-100" />読み取り専用表示。HPから注文・取消・決済・建玉変更は行いません。</div>
      </div>
    </main>
  );
}
