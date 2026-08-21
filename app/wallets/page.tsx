"use client";

import { Link2, ShieldAlert, ShieldCheck, WalletCards } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { useLogicStatus } from "@/hooks/useLogicStatus";

function maskedAddress(address?: string | null) {
  if (!address) return "未取得";
  return address;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.035] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-100/70">{label}</div>
      <div className="mt-2 text-xl font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/60">{detail}</div>
    </div>
  );
}

export default function WalletsPage() {
  const { snapshot, loading, error } = useLivePortfolio();
  const { status, ownerBinding } = useLogicStatus();
  const { formatLarge, formatPrice, jpyRate } = useCurrency();
  const liveHealthy = status === "running" && Boolean(snapshot);

  return (
    <main className="min-h-full space-y-4 rounded-[28px] border border-gold-400/16 bg-[#04060a] p-4 text-white md:p-6">
      <header className="panel-gold rounded-[30px] p-5 md:p-7">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/75"><WalletCards className="h-4 w-4" /> AsterDEX account</div>
        <h1 className="gold-heading mt-3 text-3xl font-black md:text-5xl">運用ウォレット</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/75">AsterDEX口座を正本として、評価額・維持率・注文可能余力・実建玉とロジックの接続状態を表示します。ここから注文や入出金は行いません。</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="評価額 (JPY)" value={snapshot ? formatLarge(snapshot.account.balanceUsd) : "—"} detail={snapshot ? `USD ${formatPrice(snapshot.account.balanceUsd)} / rate ¥${jpyRate.toFixed(2)}` : error || "Aster残高を取得できません"} />
        <Metric label="維持証拠金" value={snapshot ? formatLarge(snapshot.account.maintenanceMarginUsd) : "—"} detail="Aster account snapshot" />
        <Metric label="注文可能余力" value={snapshot ? formatLarge(snapshot.account.availableUsd) : "—"} detail="新規注文に使えるAster残高" />
        <Metric label="運用ウォレット" value={liveHealthy ? "稼働中" : "問題あり"} detail={liveHealthy ? "V12 / PENGU V2 / V52を監視中" : "ロジックまたはAsterデータを確認してください"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="panel-gold rounded-[28px] p-5">
          <div className="flex items-center gap-2 text-sm font-black"><Link2 className="h-4 w-4 text-gold-100" />OWNER接続</div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-sm text-white/70">口座とロジック</span><span className={`inline-flex items-center gap-2 text-sm font-bold ${ownerBinding?.connected ? "text-emerald-300" : "text-rose-300"}`}>{ownerBinding?.connected ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}{ownerBinding?.connected ? "接続確認済み" : "未接続 / 要確認"}</span></div>
            <div className="mt-3 grid gap-2 text-xs text-white/65 sm:grid-cols-2"><div>Venue: {ownerBinding?.venue || "AsterDEX"}</div><div>Address: {maskedAddress(ownerBinding?.walletAddress)}</div><div className="sm:col-span-2">Binding: {ownerBinding?.strategies?.join(" / ") || "V12 / PENGU V2 / V52"}</div></div>
          </div>
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-6 text-white/65">{status === "running" ? "全ロジックの稼働状態を確認済みです。" : "V12または共有安全ゲートが停止中です。判定状況で原因を確認してください。"}</div>
        </div>

        <div className="panel-gold rounded-[28px] p-5">
          <div className="text-sm font-black">現在のウォレット</div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-white/50">AsterDEX account address</div><div className="mt-3 break-all font-mono text-lg font-bold text-gold-100">{maskedAddress(snapshot?.wallet?.address || ownerBinding?.walletAddress)}</div><div className="mt-2 text-xs leading-5 text-white/55">安全のため先頭と末尾のみ表示しています。</div></div>
          <div className="mt-3 grid grid-cols-2 gap-3"><Metric label="実建玉" value={snapshot ? String(snapshot.positions.length) : "—"} detail="Aster position risk" /><Metric label="未決済注文" value={snapshot ? String(snapshot.orders.count) : "—"} detail="保護注文を含む" /></div>
        </div>
      </section>

      <section className="panel-gold rounded-[28px] p-5"><div className="flex items-center justify-between gap-3"><div className="text-sm font-black">OPERATIONALWALLET — 建玉一覧</div><span className="text-[11px] text-white/50">30秒ごとに更新</span></div><div className="mt-4 space-y-2">{snapshot?.positions.length ? snapshot.positions.map((position) => <div key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3"><div><div className="font-bold">{position.symbol} <span className={position.side === "LONG" ? "text-emerald-300" : "text-rose-300"}>{position.side}</span></div><div className="text-xs text-white/55">数量 {position.quantity.toFixed(6)} / 評価額 {formatPrice(position.notionalUsd)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-emerald-300" : "text-rose-300"}>{formatPrice(position.unrealizedPnlUsd)}</div><div className="text-xs text-white/50">Entry {position.entryPrice.toFixed(6)} / Mark {position.markPrice.toFixed(6)}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/60">{snapshot ? "現在、Asterで確認できる建玉はありません。" : loading ? "Aster口座を照合中…" : error || "Aster口座を取得できません。"}</div>}</div></section>

      <p className="rounded-[22px] border border-gold-400/14 bg-black/25 px-4 py-3 text-[11px] leading-5 text-white/60">残高・建玉・注文の正本はAsterDEXです。V12がFail Closedのときは、稼働中とは表示しません。</p>
    </main>
  );
}
