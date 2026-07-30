"use client";

import { useMemo } from "react";
import { Activity, ShieldCheck, Wallet } from "lucide-react";

import { LiveDecisionPanel } from "@/components/features/autotrade/LiveDecisionPanel";
import { ManualTradeRunPanel } from "@/components/features/autotrade/ManualTradeRunPanel";
import { useCurrency } from "@/context/CurrencyContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

export default function PositionsPage() {
  const { wallet } = useOperationalWallet();
  const { formatPrice } = useCurrency();
  const rows = useMemo(() => (wallet?.trackedHoldings || []).filter((holding) => Number(holding.amount) > 0).sort((a, b) => Number(b.usdValue || 0) - Number(a.usdValue || 0)), [wallet?.trackedHoldings]);
  const balance = Number(wallet?.lastAsterAccountBalanceUsd ?? wallet?.lastPortfolioUsd ?? 0);
  const available = Number(wallet?.lastAsterAvailableBalanceUsd ?? wallet?.lastBalanceFormatted ?? 0);

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white md:p-4">
      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-5 md:p-7">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />Production dashboard</div>
          <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">V96 Crypto + V52 Stock</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/82">V96の暗号資産スリーブとV52の株式スリーブを分けて表示し、口座全体の安全ゲートを確認します。研究候補や旧Paper構成は本番状態として表示しません。</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-emerald-100">LIVE / {config.executor}</span>
            <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V96 {config.v96DailyLossPct}%</span>
            <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">V52 {config.v52DailyLossPct}%</span>
            <span className="rounded-full border border-gold-400/20 bg-gold-400/10 px-3 py-1.5 text-gold-50">Total Gross ≤ {config.maximumGross.toFixed(1)}</span>
          </div>
        </header>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Aster残高" value={formatPrice(balance)} detail={`利用可能 ${formatPrice(available)}`} />
          <Metric label="Crypto sleeve" value="V96" detail={config.cryptoSymbols.join(" / ")} />
          <Metric label="Stock sleeve" value="V52" detail={config.stockSymbols.join(" / ")} />
          <Metric label="Executor" value="Aster Direct" detail="One-way / Fail Closed" />
        </section>
        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-bold"><Wallet className="h-4 w-4 text-gold-100" />現在の口座内表示</div>
          <div className="mt-4 space-y-2">
            {rows.length ? rows.map((row) => <div key={row.symbol} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{row.symbol}</div><div className="text-xs text-white/60">{row.name}</div></div><div className="text-right"><div className="font-semibold">{Number(row.amount).toFixed(6)}</div><div className="text-xs text-emerald-200">{formatPrice(Number(row.usdValue || 0))}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/65">現在表示できる保有残高はありません。実口座状態の取得結果を待機しています。</div>}
          </div>
        </section>
        <section className="grid gap-3 md:grid-cols-2">
          <div className="panel-gold rounded-[30px] p-4"><div className="flex items-center gap-2 font-bold"><Activity className="h-4 w-4 text-gold-100" />安全状態</div><p className="mt-3 text-sm leading-7 text-white/78">V96が口座全体の最終防衛線、V52が戦略単体の停止線です。建玉・注文・承認の実状態が取得できない場合は新規注文を停止します。</p></div>
          <div className="panel-gold rounded-[30px] p-4"><div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-gold-100" />監視対象</div><p className="mt-3 text-sm leading-7 text-white/78">Crypto: {config.cryptoSymbols.join(", ")}</p><p className="text-sm leading-7 text-white/78">Stock: {config.stockSymbols.join(", ")}</p></div>
        </section>
        <ManualTradeRunPanel />
        <LiveDecisionPanel />
      </div>
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{label}</div><div className="mt-2 text-xl font-black text-white">{value}</div><div className="mt-1 text-[11px] leading-5 text-white/72">{detail}</div></div>;
}