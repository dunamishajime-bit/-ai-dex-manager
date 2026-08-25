"use client";

import { Activity, Layers3, ShieldCheck } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{label}</div><div className="mt-2 text-xl font-black text-white">{value}</div><div className="mt-1 text-[11px] leading-5 text-white/72">{detail}</div></div>;
}

export default function PositionsPage() {
  const { snapshot, loading, error } = useLivePortfolio();
  const { formatPrice } = useCurrency();

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white md:p-4">
      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-5 md:p-7">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />Current Production Dashboard</div>
          <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">{config.strategyLabel}</h1>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-white/82">Asterの読み取り結果を正本として、口座残高、実建玉、未決済注文、保護注文を表示します。データ未取得時は正常稼働と推測表示しません。</p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Aster balance" value={snapshot ? formatPrice(snapshot.account.balanceUsd) : "UNAVAILABLE"} detail={snapshot ? `Available ${formatPrice(snapshot.account.availableUsd)}` : error || "Aster state unavailable"} />
          <Metric label="Real positions" value={snapshot ? String(snapshot.positions.length) : "—"} detail={snapshot ? `Unrealized ${formatPrice(snapshot.account.unrealizedPnlUsd)}` : "実建玉取得待ち"} />
          <Metric label="Open orders" value={snapshot ? String(snapshot.orders.count) : "—"} detail={snapshot ? `Protection ${snapshot.orders.protectionCount}` : "未決済注文取得待ち"} />
          <Metric label="Live source" value={snapshot ? "Aster synced" : loading ? "Loading" : "Unavailable"} detail={snapshot ? snapshot.capturedAt.replace("T", " ").slice(0, 16) + " UTC" : "推測表示なし"} />
        </section>

        <section className="grid gap-3 xl:grid-cols-3">
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-gold-100" />V12 X1.00 ALL</div><p className="mt-3 text-[12px] leading-6 text-white/78">14銘柄のAster Futures V3 LIVE runner。要求GrossはATR/リスクで動的に決まり、最大 {config.v12Gross.toFixed(1)}x。V12＋PENGUのCrypto共有上限は {config.sharedCryptoGross.toFixed(1)}xです。</p><p className="mt-2 text-[11px] leading-5 text-white/58">{config.v12Symbols.join(" / ")}</p></div>
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Layers3 className="h-4 w-4 text-gold-100" />PENGU V2</div><p className="mt-3 text-[12px] leading-6 text-white/78">PENGUUSDTの独立LIVE runner。V12とCryptoリスクを共有し、重複建玉・追加注文は実runnerの安全ゲートに委譲します。</p><p className="mt-2 text-[11px] leading-5 text-white/58">Gross上限 {config.penguGross.toFixed(2)} / shared daily loss {config.sharedCryptoDailyLossPct}%</p></div>
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-gold-100" />V52 Top2 / Aster-only</div><p className="mt-3 text-[12px] leading-6 text-white/78">AMZN・META・MSFT・NVDA・TSLAを固定したV50候補snapshotで順位1位と2位を評価します。各候補はbasis・net edge・データ品質・板・容量Gateを通過した場合だけ発注経路へ進みます。</p><p className="mt-2 text-[11px] leading-5 text-white/58">Rank1 {config.v52Top2Policy.rank1RequestedGross.toFixed(2)}x / Rank2 {config.v52Top2Policy.rank2RequestedGross.toFixed(2)}x / 最大{config.v52Top2Policy.maxConcurrentPositions}建玉 / 日次{config.v52Top2Policy.maxDailyEntries}件 / Stock {config.v52Top2Policy.stockGrossCap.toFixed(1)}x / Global {config.v52Top2Policy.globalGrossCap.toFixed(1)}x</p><p className="mt-2 text-[10px] leading-5 text-white/40">release {config.v52ProductionReleaseSha.slice(0, 8)}… / tradingMutation=0</p></div>
        </section>

        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold"><Activity className="h-4 w-4 text-gold-100" />Aster実建玉</div><span className="text-[11px] text-white/55">30秒ごとに更新</span></div>
          <div className="mt-4 space-y-2">
            {snapshot?.positions.length ? snapshot.positions.map((position) => <div key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{position.symbol} <span className={position.side === "LONG" ? "text-profit" : "text-loss"}>{position.side}</span></div><div className="text-xs text-white/60">Qty {position.quantity.toFixed(6)} / Notional {formatPrice(position.notionalUsd)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-profit" : "text-loss"}>{formatPrice(position.unrealizedPnlUsd)}</div><div className="text-xs text-white/55">Entry {position.entryPrice.toFixed(6)} / Mark {position.markPrice.toFixed(6)}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/65">{snapshot ? "現在、Asterで確認できる実建玉はありません。" : error || "Aster実建玉を取得できません。"}</div>}
          </div>
        </section>

        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-bold"><Layers3 className="h-4 w-4 text-gold-100" />未決済注文 / 保護注文</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label="Open orders" value={snapshot ? String(snapshot.orders.count) : "—"} detail="Aster実注文" /><Metric label="Protection" value={snapshot ? String(snapshot.orders.protectionCount) : "—"} detail="reduce-only / stop系" /><Metric label="Data policy" value="Fail Closed" detail="取得不能時は注文許可を推測しない" /></div>
        </section>

        <p className="rounded-[22px] border border-gold-400/14 bg-black/25 px-4 py-3 text-[11px] leading-5 text-white/62">この画面は読み取り専用です。HPから注文・取消・決済・建玉変更は行いません。実残高・建玉・注文の正本はAsterとVPS runnerです。</p>
      </div>
    </main>
  );
}
