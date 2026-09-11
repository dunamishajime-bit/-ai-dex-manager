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
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />本番運用ダッシュボード</div>
          <h1 className="gold-heading mt-3 text-3xl font-black tracking-tight md:text-5xl">{config.strategyLabel}</h1>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-white/82">Asterの最新データから、残高・建玉・未決済注文・保護注文を表示します。取得できない情報は未取得と表示します。</p>
          <p className="mt-2 max-w-4xl rounded-2xl border border-amber-400/25 bg-amber-500/5 px-4 py-3 text-[12px] leading-6 text-amber-100/85">Quality102 Causal V4は1 slotの補完スリーブです。V12・PENGU・V52を優先し、上限は {config.quality102Runtime.strategyGrossCap.toFixed(2)}x / Crypto {config.quality102Runtime.cryptoGrossCap.toFixed(2)}x / Total {config.quality102Runtime.totalGrossCap.toFixed(2)}xです。</p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="口座残高" value={snapshot ? formatPrice(snapshot.account.balanceUsd) : "未取得"} detail={snapshot ? `利用可能 ${formatPrice(snapshot.account.availableUsd)}` : error || "残高を取得できません"} />
          <Metric label="実建玉" value={snapshot ? String(snapshot.positions.length) : "—"} detail={snapshot ? `含み損益 ${formatPrice(snapshot.account.unrealizedPnlUsd)}` : "取得待ち"} />
          <Metric label="未決済注文" value={snapshot ? String(snapshot.orders.count) : "—"} detail={snapshot ? `保護注文 ${snapshot.orders.protectionCount}` : "取得待ち"} />
          <Metric label="データ時刻" value={snapshot ? "Aster同期済み" : loading ? "確認中" : "未取得"} detail={snapshot ? snapshot.capturedAt.replace("T", " ").slice(0, 16) + " UTC" : ""} />
        </section>

        <section className="grid gap-3 xl:grid-cols-3">
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-gold-100" />V12 X1.00 ALL Top2</div><p className="mt-3 text-[12px] leading-6 text-white/78">14銘柄を判定します。最大2建玉、1建玉最大 {config.v12PerPositionGross.toFixed(2)}x、合計上限 {config.v12Gross.toFixed(2)}x。ATRとリスクに応じて配分し、Crypto共有上限は {config.sharedCryptoGross.toFixed(2)}xです。</p><p className="mt-2 text-[11px] text-white/58">{config.v12Symbols.join(" / ")}</p></div>
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Layers3 className="h-4 w-4 text-gold-100" />PENGU Short V20 + Recovery V8</div><p className="mt-3 text-[12px] leading-6 text-white/78">PENGUUSDTをLong / Shortで判定します。通常シグナルを優先し、不成立時だけRecovery V8を評価します。</p><p className="mt-2 text-[11px] text-white/58">通常 {config.penguGross.toFixed(2)}x / V8 {config.penguRecoveryV8.recoveryGross.toFixed(2)}x / Crypto共有 {config.sharedCryptoGross.toFixed(1)}x</p></div>
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-gold-100" />V52 Top2</div><p className="mt-3 text-[12px] leading-6 text-white/78">米国市場の候補をRank1・Rank2で判定します。basis・net edge・データ品質・容量Gateを通過した候補だけ発注します。</p><p className="mt-2 text-[11px] text-white/58">Rank1 {config.v52Top2Policy.rank1RequestedGross.toFixed(2)}x / Rank2 {config.v52Top2Policy.rank2RequestedGross.toFixed(2)}x / 最大{config.v52Top2Policy.maxConcurrentPositions}建玉</p></div>
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-amber-200" />Quality102 Causal V4</div><p className="mt-3 text-[12px] leading-6 text-white/78">PB / MR / BRK / REVを判定する1 slotの補完スリーブです。V12・PENGU・V52を優先し、余剰Grossだけを最大 {config.quality102Runtime.strategyGrossCap.toFixed(2)}x 使用します。</p><p className="mt-2 text-[11px] text-white/58">{config.quality102Runtime.symbols.join(" / ")}</p><p className="mt-2 text-[10px] text-amber-100/65">Crypto {config.quality102Runtime.cryptoGrossCap.toFixed(2)}x / Total {config.quality102Runtime.totalGrossCap.toFixed(2)}x / Historical frozen Q102はLIVE未使用</p></div>
        </section>

        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold"><Activity className="h-4 w-4 text-gold-100" />Aster実建玉</div><span className="text-[11px] text-white/55">30秒ごとに更新</span></div>
          <div className="mt-4 space-y-2">
            {snapshot?.positions.length ? snapshot.positions.map((position) => <div key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{position.symbol} <span className={position.side === "LONG" ? "text-profit" : "text-loss"}>{position.side}</span></div><div className="text-xs text-white/60">Qty {position.quantity.toFixed(6)} / Notional {formatPrice(position.notionalUsd)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-profit" : "text-loss"}>{formatPrice(position.unrealizedPnlUsd)}</div><div className="text-xs text-white/55">Entry {position.entryPrice.toFixed(6)} / Mark {position.markPrice.toFixed(6)}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/65">{snapshot ? "現在、Asterで確認できる実建玉はありません。" : error || "Aster実建玉を取得できません。"}</div>}
          </div>
        </section>

        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-bold"><Layers3 className="h-4 w-4 text-gold-100" />未決済注文 / 保護注文</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label="未決済注文" value={snapshot ? String(snapshot.orders.count) : "—"} detail="Aster実注文" /><Metric label="保護注文" value={snapshot ? String(snapshot.orders.protectionCount) : "—"} detail="reduce-only / stop系" /><Metric label="安全方針" value="Fail Closed" detail="未取得時は注文を許可しません" /></div>
        </section>

        <p className="rounded-[22px] border border-gold-400/14 bg-black/25 px-4 py-3 text-[11px] leading-5 text-white/62">この画面は読み取り専用です。HPから注文・取消・決済・建玉変更は行いません。実残高・建玉・注文の正本はAsterとVPS runnerです。</p>
      </div>
    </main>
  );
}
