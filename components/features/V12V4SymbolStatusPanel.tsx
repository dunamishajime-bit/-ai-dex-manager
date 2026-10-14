"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ChevronDown, RefreshCw } from "lucide-react";

import { useV12V4HpStatus } from "@/hooks/useV12V4HpStatus";
import {
  v12V4SymbolDisplayRows,
  type MarketRankingResponse,
  type V12V4SymbolDisplayRow,
} from "@/lib/v12-v4-symbol-status";

function nativeLabel(state: V12V4SymbolDisplayRow["state"]) {
  if (state === "CANDIDATE") return "V4候補観測";
  if (state === "FILTERED") return "V4除外観測";
  if (state === "NO_EMISSION") return "出力なし・詳細未提供";
  return "V4判定詳細未取得";
}

function nativeClass(state: V12V4SymbolDisplayRow["state"]) {
  if (state === "CANDIDATE") return "text-emerald-200";
  if (state === "FILTERED") return "text-rose-200";
  return "text-amber-100";
}
const METRICS = [
  ["return6hPct", "6h騰落率", "%"],
  ["return24hPct", "24h騰落率", "%"],
  ["btcRelative24hPct", "BTC比24h", "%"],
  ["volumeRatio", "出来高比", "x"],
  ["atrPct", "ATR比率", "%"],
  ["trendPct", "短期トレンド", "%"],
  ["breakoutPct", "24h高値比", "%"],
] as const;

function friendlyTime(at?: number | null): string {
  return typeof at === "number" && Number.isFinite(at) && at > 0
    ? new Date(at).toLocaleString("ja-JP") : "未取得";
}

/** V12 V4: always show its entire symbol inventory, even with no emitted candidates. */
export function V12V4SymbolStatusPanel() {
  const { snapshot, loading, error, refresh } = useV12V4HpStatus();
  const [ranking, setRanking] = useState<MarketRankingResponse | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);

  const loadMarket = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/system/realtime-ranking", { cache: "no-store", signal });
      const data: unknown = await response.json();
      if (!response.ok || !data || typeof data !== "object") throw new Error("市場指標の取得失敗");
      const value = data as MarketRankingResponse;
      if (value.readOnly !== true || value.tradingMutation !== 0 || !Array.isArray(value.rows)) {
        throw new Error("市場指標の読み取り専用契約不一致");
      }
      setRanking(value);
      setMarketError(null);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setRanking(null);
      setMarketError(cause instanceof Error ? cause.message : "市場指標の取得失敗");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadMarket(controller.signal);
    const timer = window.setInterval(() => void loadMarket(controller.signal), 30_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [loadMarket]);

  const rows = useMemo(() => v12V4SymbolDisplayRows(snapshot, ranking), [snapshot, ranking]);
  const nativeAvailable = snapshot?.displayStatus === "LIVE_VERIFIED" && snapshot.freshness.decision;
  const candidates = rows.filter((row) => row.state === "CANDIDATE").length;
  const filtered = rows.filter((row) => row.state === "FILTERED").length;

  return <section className="panel-gold min-w-0 rounded-[28px] p-4 md:p-5" data-testid="v12-v4-symbol-status">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />V12 V4 通貨別判定・観測</div>
        <p className="mt-2 max-w-4xl text-xs leading-6 text-white/65">
          対象通貨を全件表示します。「V4正式判定」は現行Runner由来の候補・filteredを観測できた場合のみ表示し、
          データ未取得をBLOCKやWAITと断定しません。市場Scoreと参考指標はAster公開相場による別計算で、V4の正式Score・発注Gate・勝率ではありません。
        </p>
      </div>
      <button type="button" onClick={() => { void refresh(); void loadMarket(); }} disabled={loading}
        className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/75 disabled:opacity-50">
        <RefreshCw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />更新
      </button>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="text-[10px] text-white/50">監視対象通貨</div>
        <div className="mt-1 text-xl font-bold text-white">{rows.length}</div>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="text-[10px] text-white/50">V4候補 / filtered 通貨</div>
        <div className="mt-1 text-xl font-bold text-white">{candidates} / {filtered}</div>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="text-[10px] text-white/50">通貨別V4 source</div>
        <div className={"mt-1 text-sm font-bold " + (nativeAvailable ? "text-emerald-200" : "text-amber-100")}>
          {nativeAvailable ? "確定snapshot観測済み" : "未接続・未更新"}
        </div>
        <div className="mt-1 text-[10px] text-white/45">確定時刻 {friendlyTime(snapshot?.timestamps.decisionTs)}</div>
      </div>
    </div>
    {!nativeAvailable ? <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-3 text-xs leading-6 text-amber-100">
      V12 V4の稼働状態と通貨別判定の取得状態は別です。
      {snapshot?.displayStatus === "LIVE_VERIFIED"
        ? "Runner自体はLIVE確認済みですが、通貨別のGate判定理由は現行のRunner telemetryに保存されていません。市場参考指標は表示できますが、各通貨の正式PASS/BLOCKは未取得です。"
        : "Runnerの正式LIVE状態を確認できません。"}
      {error ? " / " + error : ""}
    </div> : null}
    {marketError ? <p className="mt-2 text-xs text-amber-100">市場参考指標：{marketError}</p> : null}
    <div className="mt-4 grid gap-2">
      {rows.map((row) => <details key={row.symbol} className="group min-w-0 rounded-xl border border-white/10 bg-black/20">
        <summary className="grid min-w-0 cursor-pointer list-none grid-cols-[minmax(100px,1fr)_minmax(118px,1.2fr)_65px_22px] items-center gap-2 px-3 py-3 text-xs md:grid-cols-[140px_minmax(190px,1.1fr)_92px_92px_92px_22px]">
          <span className="font-bold text-white">{row.symbol}</span>
          <span className={"min-w-0 break-words font-semibold " + nativeClass(row.state)}>{nativeLabel(row.state)}</span>
          <span className="text-right text-white/75">{row.marketFresh && row.marketScore !== null ? row.marketScore.toFixed(2) : "—"}<span className="block text-[9px] text-white/45">市場Score</span></span>
          <span className="hidden text-right font-semibold text-white/65 md:block">{row.side ?? "未取得"}<span className="block text-[9px] font-normal">V4方向</span></span>
          <span className="hidden text-right text-white/65 md:block">{row.marketFeatures.volumeRatio?.toFixed(2) ?? "—"}<span className="block text-[9px]">出来高比・参考</span></span>
          <ChevronDown className="h-4 w-4 text-white/40 transition group-open:rotate-180" />
        </summary>
        <div className="min-w-0 border-t border-white/10 px-3 py-3 text-xs leading-6 text-white/75">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="font-semibold text-white">V12 V4正式判定の観測内容</div>
            <p className="mt-1">{row.message}</p>
            <p className="mt-1">方向：{row.side ?? "未取得"} / Route：{row.routes.length ? row.routes.join(" / ") : "未観測"}</p>
            {row.filteredReasons.length ? <div className="mt-1">除外理由：{row.filteredReasons.join(" / ")}</div> : null}
            <div className="mt-1 text-[10px] text-white/50">V4のnative Score・個別Gate・発注可能判定はRunner由来の実測がない限り補完しません。</div>
          </div>
          <div className="mt-2 rounded-lg border border-sky-400/15 bg-sky-500/[0.04] p-3">
            <div className="font-semibold text-sky-100">市場参考指標（V4判定には使用しない）</div>
            {row.marketFresh ? <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {METRICS.map(([key, label, unit]) => <div key={key} className="rounded-lg bg-black/25 px-2 py-1.5">
                <div className="text-[10px] text-white/50">{label}</div>
                <div className="font-semibold text-white">{typeof row.marketFeatures[key] === "number" ? row.marketFeatures[key].toFixed(2) + unit : "—"}</div>
              </div>)}
            </div> : <p className="mt-2 text-amber-100">Asterの有効な確定1時間足が未取得です。</p>}
          </div>
        </div>
      </details>)}
    </div>
    <p className="mt-3 text-[10px] leading-5 text-white/45">30秒間隔で取得。表示は読み取り専用で、注文・取消・建玉・取引Runnerへの変更は行いません。監視対象リストはProduction実装と照合した14通貨の互換在庫です。</p>
  </section>;
}
