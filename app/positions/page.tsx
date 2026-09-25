"use client";

import { Activity, Layers3, ShieldCheck } from "lucide-react";

import { useCurrency } from "@/context/CurrencyContext";
import { useLivePortfolio } from "@/hooks/useLivePortfolio";
import { useProductionRuntime } from "@/hooks/useProductionRuntime";

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="panel-gold rounded-[24px] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/72">{label}</div><div className="mt-2 text-xl font-black text-white">{value}</div><div className="mt-1 text-[11px] leading-5 text-white/72">{detail}</div></div>;
}

export default function PositionsPage() {
  const { snapshot, loading, error } = useLivePortfolio();
  const { snapshot: productionRuntime, error: productionRuntimeError } = useProductionRuntime();
  const { formatPrice } = useCurrency();
  const caps = productionRuntime?.caps;
  const v12 = productionRuntime?.v12;
  const pengu = productionRuntime?.pengu;
  const q102 = productionRuntime?.quality102;
  const v52 = productionRuntime?.v52;
  const lineage = productionRuntime?.runtimeLineage;
  const totalNotionalUsd = snapshot?.positions.reduce((sum, position) => sum + position.notionalUsd, 0) ?? 0;
  const equityUsd = snapshot?.account.balanceUsd ?? 0;
  const usedMarginUsd = snapshot ? Math.max(0, snapshot.account.balanceUsd - snapshot.account.availableUsd) : 0;
  const marginUsePct = equityUsd > 0 ? (usedMarginUsd / equityUsd) * 100 : 0;
  const grossUsed = equityUsd > 0 ? totalNotionalUsd / equityUsd : 0;
  const cryptoGrossRemaining = caps ? Math.max(0, caps.cryptoGross - grossUsed) : null;
  const cryptoNotionalRemainingUsd = cryptoGrossRemaining != null ? cryptoGrossRemaining * equityUsd : null;
  const entryOrderCount = snapshot?.orders.entryOrderCount ?? 0;
  const protectionBySymbol = snapshot?.orders.items.filter((order) => order.protection).reduce<Record<string, typeof snapshot.orders.items>>((grouped, order) => {
    (grouped[order.symbol] ||= []).push(order);
    return grouped;
  }, {}) ?? {};

  return (
    <main className="relative min-w-0 min-h-full overflow-x-hidden overflow-y-visible rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white md:p-4">
      <div className="relative z-10 min-w-0 space-y-3">
        <header className="panel-gold min-w-0 rounded-[30px] p-5 md:p-7 [overflow-wrap:anywhere]">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/76"><ShieldCheck className="h-4 w-4" />Current Production Dashboard</div>
          <h1 className="gold-heading mt-3 break-words text-2xl font-black leading-tight tracking-tight sm:text-3xl md:text-5xl">{productionRuntime && v12 && pengu && v52 ? `${v12.strategyId} / ${pengu.strategyId} / Q102 ${q102?.selectorMode ?? "UNAVAILABLE"} / ${v52.policyId}` : "DISTerminal Production Runtime"}</h1>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-white/82">Asterの読み取り結果を正本として、口座残高、実建玉、未決済注文、保護注文を表示します。データ未取得時は正常稼働と推測表示しません。</p>
          <p className={`mt-2 max-w-4xl rounded-2xl border px-4 py-3 text-[12px] leading-6 ${productionRuntime && lineage?.synchronized ? "border-emerald-400/25 bg-emerald-500/5 text-emerald-100/85" : "border-amber-400/25 bg-amber-500/5 text-amber-100/85"}`}>{productionRuntime && caps && q102 ? `${lineage?.synchronized ? "Runtime SHA同期" : "RUNTIME MISMATCH"} / Production ${productionRuntime.releaseSha.slice(0, 12)} / Q102 ${q102.selectorMode} ${caps.quality102Gross.toFixed(2)}x / Crypto ${caps.cryptoGross.toFixed(2)}x / Total ${caps.totalGross.toFixed(2)}x` : `Production runtime未接続${productionRuntimeError ? `: ${productionRuntimeError}` : "。旧固定値は表示しません。"}`}</p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="口座評価額" value={snapshot ? formatPrice(snapshot.account.balanceUsd) : "UNAVAILABLE"} detail={snapshot ? `Aster利用可能 ${formatPrice(snapshot.account.availableUsd)}` : error || "Aster state unavailable"} />
          <Metric label="実建玉" value={snapshot ? `${snapshot.positions.length} 通貨` : "—"} detail={snapshot ? `Notional合計 ${formatPrice(totalNotionalUsd)} / 含み損益 ${formatPrice(snapshot.account.unrealizedPnlUsd)}` : "実建玉取得待ち"} />
          <Metric label="新規待機注文" value={snapshot ? String(entryOrderCount) : "—"} detail={snapshot ? `保護注文は別枠 ${snapshot.orders.protectionCount}件` : "未決済注文取得待ち"} />
          <Metric label="Live source" value={snapshot ? "Aster synced" : loading ? "Loading" : "Unavailable"} detail={snapshot ? snapshot.capturedAt.replace("T", " ").slice(0, 16) + " UTC" : "推測表示なし"} />
        </section>

        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm font-bold">資金使用量 / 注文余力</div><span className="text-[11px] text-white/55">Aster実残高・実建玉から30秒ごとに再計算</span></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="証拠金使用" value={snapshot ? formatPrice(usedMarginUsd) : "—"} detail={snapshot ? `${marginUsePct.toFixed(1)}%使用 / 利用可能 ${formatPrice(snapshot.account.availableUsd)}` : "取得待ち"} />
            <Metric label="Gross使用" value={snapshot && caps ? `${grossUsed.toFixed(2)}x / ${caps.cryptoGross.toFixed(2)}x` : "—"} detail={snapshot ? `実建玉Notional ${formatPrice(totalNotionalUsd)}` : "取得待ち"} />
            <Metric label="Crypto Gross余力" value={cryptoGrossRemaining != null ? `${cryptoGrossRemaining.toFixed(2)}x` : "—"} detail={cryptoNotionalRemainingUsd != null ? `約 ${formatPrice(cryptoNotionalRemainingUsd)} 相当の追加Notional余地` : "Production cap取得待ち"} />
            <Metric label="V12建玉枠" value={snapshot?.strategyUsage.v12 && v12 ? `${snapshot.strategyUsage.v12.positionCount}/${v12.maximumPositions} 使用` : "—"} detail={snapshot?.strategyUsage.v12 && v12 ? `${snapshot.strategyUsage.v12.positionCount >= v12.maximumPositions ? "新規V12 slotは空きなし" : `空き ${Math.max(0, v12.maximumPositions - snapshot.strategyUsage.v12.positionCount)} slot`} / V12 gross ${snapshot.strategyUsage.v12.gross.toFixed(2)}x` : "V12 runner state取得待ち"} />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-white/55">Gross余力は「追加できるNotionalの理論上限」で、実際の発注可否は各ロジックのslot・family gross・共有risk・Entry Gateでさらに制限されます。証拠金使用額はAsterの口座評価額−available balanceから算出しています。</p>
        </section>

        <section className="grid gap-3 xl:grid-cols-3">
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-gold-100" />{v12?.strategyId ?? "V12 runtime未取得"}</div>{v12 && caps ? <><p className="mt-3 text-[12px] leading-6 text-white/78">1建玉最大 {caps.v12PerPositionGross.toFixed(2)}x / 最大{v12.maximumPositions}建玉 / Base {caps.v12BaseGross.toFixed(2)}x / Dynamic Residual {caps.v12DynamicGross.toFixed(2)}x / Crypto共有 {caps.cryptoGross.toFixed(2)}x / Aster 5x Cross。</p><p className="mt-2 text-[11px] leading-5 text-sky-100/75">Entry Quality: 通常 Score ≥ {v12.neutralScoreThreshold.toFixed(4)} / Strong regime {v12.strongRegimeQualityScoreMinimum.toFixed(2)}–{v12.strongRegimeQualityScoreMaximum.toFixed(2)} + ATR/Price ≥ {(v12.strongRegimeQualityMinimumAtrRatio * 100).toFixed(1)}% / non-strong relaxed Momentum ≥ {(v12.relaxedRegimeMinimumMomentumPct * 100).toFixed(1)}% + ATR ≥ {(v12.relaxedRegimeMinimumAtrRatio * 100).toFixed(1)}%</p></> : <p className="mt-3 text-[12px] leading-6 text-amber-100/80">Production runtime未取得。旧固定値は表示しません。</p>}</div>
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Layers3 className="h-4 w-4 text-gold-100" />{pengu?.strategyId ?? "PENGU runtime未取得"}</div>{pengu && caps ? <><p className="mt-3 text-[12px] leading-6 text-white/78">Gross上限 {caps.penguGross.toFixed(2)}x / Recovery {pengu.recoveryRule} 初期 {pengu.recoveryInitialGross.toFixed(2)}x / hard-stop後 cooldown {pengu.hardStopCooldownHours}h / Recovery max hold {pengu.recoveryMaxHoldHours}h。</p><p className="mt-2 text-[11px] leading-5 text-white/58">Recovery hard stop {(pengu.recoveryHardStopPct * 100).toFixed(1)}% / trail activation {(pengu.recoveryTrailActivationPct * 100).toFixed(1)}% / retrace {(pengu.recoveryTrailRetracePct * 100).toFixed(1)}% / Crypto共有 {caps.cryptoGross.toFixed(2)}x / daily loss {caps.sharedCryptoDailyLossPct}%</p></> : <p className="mt-3 text-[12px] leading-6 text-amber-100/80">Production runtime未取得。旧固定値は表示しません。</p>}</div>
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-gold-100" />{v52 ? `V52 / ${v52.policyId}` : "V52 runtime未取得"}</div>{v52 && caps ? <><p className="mt-3 text-[12px] leading-6 text-white/78">{v52.strategy}: Basis ≥{v52.minimumEntryBasisBps}bps / Convergence {v52.convergenceBps}bps / Stop {v52.basisStopMultiple}x / Net Edge ≥{v52.minimumNetEdgeBps}bps / Max Cost {v52.maximumRoundTripCostBps}bps / Spread ≤{v52.maximumSpreadBps}bps / Hold ≤{v52.maximumHoldingHours}h。</p><p className="mt-2 text-[11px] leading-5 text-white/58">Slot上限 {caps.v52V50Gross.toFixed(2)}x / Stock {caps.stockGross.toFixed(2)}x / Global {caps.totalGross.toFixed(1)}x / Aster 5x Cross</p></> : <p className="mt-3 text-[12px] leading-6 text-amber-100/80">Production runtime未取得。旧固定値は表示しません。</p>}</div>
          <div className="panel-gold rounded-[28px] p-4"><div className="flex items-center gap-2 text-sm font-black"><Activity className="h-4 w-4 text-amber-200" />Q102 {q102?.selectorMode ?? "runtime未取得"}</div>{q102 && caps ? <><p className="mt-3 text-[12px] leading-6 text-white/78">{q102.selectorMode}の1-slot補完スリーブ。最大 {caps.quality102Gross.toFixed(2)}x / Crypto {caps.cryptoGross.toFixed(2)}x / Total {caps.totalGross.toFixed(2)}x。</p><p className="mt-2 text-[10px] leading-5 text-amber-100/65">Family Gross: HIGH_VOL {q102.familyGross.HIGH_VOL.toFixed(3)}x / MR {q102.familyGross.MR.toFixed(2)}x / BRK {q102.familyGross.BRK.toFixed(3)}x / REV {q102.familyGross.REV.toFixed(2)}x / PB {q102.familyGross.PB.toFixed(2)}x / Aster 5x Cross</p></> : <p className="mt-3 text-[12px] leading-6 text-amber-100/80">Production runtime未取得。旧固定値は表示しません。</p>}</div>
        </section>

        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-bold"><Activity className="h-4 w-4 text-gold-100" />Aster実建玉</div><span className="text-[11px] text-white/55">30秒ごとに更新</span></div>
          <div className="mt-4 space-y-2">
            {snapshot?.positions.length ? snapshot.positions.map((position) => <div key={`${position.symbol}-${position.positionSide}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"><div><div className="font-bold">{position.symbol} <span className={position.side === "LONG" ? "text-profit" : "text-loss"}>{position.side}</span></div><div className="text-xs text-white/60">Qty {position.quantity.toFixed(6)} / Notional {formatPrice(position.notionalUsd)}</div></div><div className="text-right"><div className={position.unrealizedPnlUsd >= 0 ? "text-profit" : "text-loss"}>{formatPrice(position.unrealizedPnlUsd)}</div><div className="text-xs text-white/55">Entry {position.entryPrice.toFixed(6)} / Mark {position.markPrice.toFixed(6)}</div></div></div>) : <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/65">{snapshot ? "現在、Asterで確認できる実建玉はありません。" : error || "Aster実建玉を取得できません。"}</div>}
          </div>
        </section>

        <section className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-sm font-bold"><Layers3 className="h-4 w-4 text-gold-100" />注文内訳</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4"><Metric label="実建玉" value={snapshot ? String(snapshot.positions.length) : "—"} detail="現在保有している通貨数" /><Metric label="新規待機注文" value={snapshot ? String(entryOrderCount) : "—"} detail="Entry方向の未約定注文" /><Metric label="保護注文" value={snapshot ? String(snapshot.orders.protectionCount) : "—"} detail="既存建玉を守る損切り・利確注文" /><Metric label="Aster未決済注文 合計" value={snapshot ? String(snapshot.orders.count) : "—"} detail={snapshot ? `新規 ${entryOrderCount} + 保護 ${snapshot.orders.protectionCount}` : "取得待ち"} /></div>
          {snapshot ? <div className="mt-4 grid gap-3 md:grid-cols-2">{Object.entries(protectionBySymbol).map(([symbol, orders]) => <div key={symbol} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="font-bold text-white">{symbol} 保護注文</div><div className="mt-2 space-y-2">{orders.map((order, index) => { const purpose = /TAKE_PROFIT/i.test(order.type) ? "利確" : /STOP/i.test(order.type) ? "損切り" : "保護"; return <div key={`${symbol}-${order.type}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs"><div><span className="font-semibold text-white">{purpose}</span> <span className="text-white/60">{order.type}</span><div className="mt-1 text-white/45">Qty {order.quantity} / {order.side} / {order.status}</div></div><div className="text-right text-[10px] text-emerald-100/80">{order.reduceOnly ? "reduce-only" : order.closePosition ? "close-position" : "保護系注文"}</div></div>; })}</div></div>)}</div> : null}
          <div className="mt-3 rounded-2xl border border-sky-400/15 bg-sky-500/5 px-4 py-3 text-[11px] leading-5 text-sky-100/75"><b>意味:</b> STOP_MARKET＝価格が不利方向へ進んだ時の損切り、TAKE_PROFIT_MARKET＝利益目標到達時の利確です。reduce-only / close-positionは既存建玉を減らす・閉じるための指定で、新しい建玉を増やす注文ではありません。</div>
        </section>

        <p className="rounded-[22px] border border-gold-400/14 bg-black/25 px-4 py-3 text-[11px] leading-5 text-white/62">この画面は読み取り専用です。HPから注文・取消・決済・建玉変更は行いません。実残高・建玉・注文の正本はAsterとVPS runnerです。</p>
      </div>
    </main>
  );
}
