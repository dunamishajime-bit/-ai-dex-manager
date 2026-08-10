"use client";

import { useMemo } from "react";
import { Activity, ShieldCheck, Wallet } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

export default function PositionsPage() {
  const { wallet } = useOperationalWallet();
  const { formatPrice } = useCurrency();
  const rows = useMemo(() => (wallet?.trackedHoldings || []).filter((holding) => Number(holding.amount) > 0).sort((a, b) => Number(b.usdValue || 0) - Number(a.usdValue || 0)), [wallet?.trackedHoldings]);
  const balance = typeof wallet?.lastAsterAccountBalanceUsd === "number" ? wallet.lastAsterAccountBalanceUsd : null;
  const available = typeof wallet?.lastAsterAvailableBalanceUsd === "number" ? wallet.lastAsterAvailableBalanceUsd : null;

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white md:p-4">
      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-5 md:p-7">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />Production dashboard</div>
          <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">{config.strategyLabel}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/82">PENGU Dual LS V1とV52 Stockを分けて表示します。V96/V97は現在停止中、V52は市場時間外に注文停止です。実状態を取得できない場合は推測表示しません。</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold"><span className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-white/75">LIVE状態：実API確認</span><span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V96/V97：停止</span><span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V52 Daily Loss {config.v52DailyLossPct}%</span><span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">PENGU Gross {config.penguMaximumGross.toFixed(2)}</span></div>
        </header>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Aster balance" value={balance === null ? "取得不能" : formatPrice(balance)} detail={available === null ? "取得時刻不明" : `利用可能 ${formatPrice(available)}`} /><Metric label="Crypto strategy" value="PENGU Dual LS" detail={`${config.cryptoSymbols.join(" / ")} / Gross ${config.penguMaximumGross.toFixed(2)}`} /><Metric label="Stock strategy" value="V52 Stock" detail={`${config.stockSymbols.join(" / ")} / 市場時間外は待機`} /><Metric label="Executor" value="AsterDirectTradeExecutor" detail="Fail Closed / 注文画面なし" /></section>
        <section className="panel-gold rounded-[30px] p-4 md:p-5"><div className="flex items-center gap-2 text-sm font-bold"><Wallet className="h-4 w-4 text-gold-100" />現在の保有状況</div><div className="mt-4 space-y-2">{rows.length ? rows.map((row) => <div key={row.symbol} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{row.symbol}</div><div className="text-xs text-white/60">{row.name}</div></div><div className="text-right"><div className="font-semibold">{Number(row.amount).toFixed(6)}</div><div className="text-xs text-emerald-200">{formatPrice(Number(row.usdValue || 0))}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/65">現在表示できる保有データはありません。取得不能と実残高0は区別して表示します。</div>}</div></section>
        <section className="grid gap-3 md:grid-cols-2"><div className="panel-gold rounded-[30px] p-4"><div className="flex items-center gap-2 font-bold"><Activity className="h-4 w-4 text-gold-100" />安全状態</div><p className="mt-3 text-sm leading-7 text-white/78">PENGU Dual LS V1は単一ポジション枠で判定し、V52は市場時間と参照データが正常な場合だけ注文許可になります。Kill Switch、Daily Loss、Gross、重複注文防止は共通Gateで維持します。</p></div><div className="panel-gold rounded-[30px] p-4"><div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-gold-100" />監視対象</div><p className="mt-3 text-sm leading-7 text-white/78">Crypto：{config.cryptoSymbols.join(", ")}</p><p className="text-sm leading-7 text-white/78">Stock：{config.stockSymbols.join(", ")}</p><p className="text-sm leading-7 text-white/78">V96/V97：現在停止</p></div></section>
        <section className="panel-gold rounded-[30px] p-4 md:p-5"><div className="flex items-center gap-2 text-sm font-bold"><Activity className="h-4 w-4 text-gold-100" />判定状況</div><p className="mt-3 text-sm leading-7 text-white/75">PENGUのLong/Short判定とV52の市場時間・参照データ状態を1時間ごとに読み取り確認します。</p><a href="/decision-status" className="mt-3 inline-flex rounded-lg border border-gold-400/25 px-3 py-2 text-sm text-gold-100 hover:bg-gold-400/10">判定状況を開く</a></section>
      </div>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{label}</div><div className="mt-2 text-xl font-black text-white">{value}</div><div className="mt-1 text-[11px] leading-5 text-white/72">{detail}</div></div>;
}
