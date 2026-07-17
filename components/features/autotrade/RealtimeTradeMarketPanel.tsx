"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

type RealtimeKlineAnalysis = {
  lastClose: number;
  sma7: number;
  sma25: number;
  sma99: number;
  mom20: number;
  previousHigh: number;
  highDistance: number;
  volumeRatio: number;
  hhhl: boolean;
  maStackUp: boolean;
  candleChange: number;
};

type RealtimeSnapshot = {
  symbol: string;
  pair: string;
  lastPrice?: number;
  priceChange24h?: number;
  quoteVolume24h?: number;
  fifteenMinutes?: RealtimeKlineAnalysis | null;
  oneHour?: RealtimeKlineAnalysis | null;
  realtimeScore?: number;
  realtimeLabel?: string;
  fetchedAt?: string;
  error?: string;
};

type RealtimeTradeResponse = {
  ok: boolean;
  fetchedAt: string;
  source: string;
  usage: string;
  note: string;
  snapshots: RealtimeSnapshot[];
};

function pct(value?: number, digits = 2) {
  const numeric = Number(value || 0);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
}

function price(value?: number) {
  const numeric = Number(value || 0);
  if (Math.abs(numeric) >= 1000) return numeric.toFixed(2);
  if (Math.abs(numeric) >= 1) return numeric.toFixed(4);
  return numeric.toFixed(6);
}

function labelTone(label?: string) {
  if (label === "強い上昇候補") return "border-profit/35 bg-profit/10 text-profit";
  if (label === "監視候補") return "border-gold-300/35 bg-gold-300/10 text-gold-100";
  if (label === "中立") return "border-white/15 bg-white/[0.04] text-white/78";
  return "border-loss/30 bg-loss/10 text-loss";
}

function shortTime(value?: string) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function SnapshotCard({ snapshot }: { snapshot: RealtimeSnapshot }) {
  const m15 = snapshot.fifteenMinutes || null;
  const h1 = snapshot.oneHour || null;

  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-black text-white">{snapshot.symbol}/USDT</div>
          <div className="mt-1 text-[11px] text-white/60">取得: {shortTime(snapshot.fetchedAt)}</div>
        </div>
        <div className={cn("rounded-full border px-3 py-1 text-[11px] font-bold", labelTone(snapshot.realtimeLabel))}>
          {snapshot.error ? "取得エラー" : snapshot.realtimeLabel}
        </div>
      </div>

      {snapshot.error ? (
        <div className="mt-3 rounded-[16px] border border-loss/25 bg-loss/10 p-3 text-xs text-loss">
          {snapshot.error}
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-[14px] bg-white/[0.04] p-2">
              <div className="text-white/50">価格</div>
              <div className="mt-1 font-black text-white">{price(snapshot.lastPrice)}</div>
            </div>
            <div className="rounded-[14px] bg-white/[0.04] p-2">
              <div className="text-white/50">24h</div>
              <div className={cn("mt-1 font-black", Number(snapshot.priceChange24h || 0) >= 0 ? "text-profit" : "text-loss")}>
                {pct(snapshot.priceChange24h)}
              </div>
            </div>
            <div className="rounded-[14px] bg-white/[0.04] p-2">
              <div className="text-white/50">リアルタイムScore</div>
              <div className="mt-1 font-black text-gold-100">{Number(snapshot.realtimeScore || 0).toFixed(2)}</div>
            </div>
            <div className="rounded-[14px] bg-white/[0.04] p-2">
              <div className="text-white/50">出来高</div>
              <div className="mt-1 font-black text-white">{Number(snapshot.quoteVolume24h || 0).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
            <div className="rounded-[16px] border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 font-bold text-white">15分足 短期判断</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-white/72">
                <span>mom20</span><span className="text-right font-bold text-white">{pct(m15?.mom20)}</span>
                <span>出来高比率</span><span className="text-right font-bold text-white">{Number(m15?.volumeRatio || 0).toFixed(2)}</span>
                <span>直近高値差</span><span className="text-right font-bold text-white">{pct(m15?.highDistance)}</span>
                <span>SMA並び</span><span className="text-right font-bold text-white">{m15?.maStackUp ? "上向き" : "未成立"}</span>
                <span>高値安値</span><span className="text-right font-bold text-white">{m15?.hhhl ? "切り上げ" : "未成立"}</span>
              </div>
            </div>

            <div className="rounded-[16px] border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 font-bold text-white">1時間足 トレンド確認</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-white/72">
                <span>mom20</span><span className="text-right font-bold text-white">{pct(h1?.mom20)}</span>
                <span>出来高比率</span><span className="text-right font-bold text-white">{Number(h1?.volumeRatio || 0).toFixed(2)}</span>
                <span>直近高値差</span><span className="text-right font-bold text-white">{pct(h1?.highDistance)}</span>
                <span>SMA並び</span><span className="text-right font-bold text-white">{h1?.maStackUp ? "上向き" : "未成立"}</span>
                <span>高値安値</span><span className="text-right font-bold text-white">{h1?.hhhl ? "切り上げ" : "未成立"}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function RealtimeTradeMarketPanel() {
  const [response, setResponse] = useState<RealtimeTradeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/market/realtime-trade", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as RealtimeTradeResponse | null;
      if (!res.ok || !json?.ok) throw new Error("リアルタイム相場データを取得できませんでした。");
      setResponse(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "リアルタイム相場データを取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 60000);
    return () => window.clearInterval(timer);
  }, []);

  const sorted = useMemo(() => {
    return [...(response?.snapshots || [])].sort((left, right) =>
      Number(right.realtimeScore || 0) - Number(left.realtimeScore || 0),
    );
  }, [response?.snapshots]);

  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Activity className="h-4 w-4 text-gold-100" />
            リアルタイム相場参考データ
          </div>
          <p className="mt-1 text-xs leading-5 text-white/64">
            Binanceの15分足・1時間足を取得し、Telegram GPTの相場確認と同じ材料をHPにも表示します。現時点では参考表示のみで、このデータ単体では発注しません。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-full border border-gold-300/25 bg-gold-300/10 px-4 py-2 text-xs font-bold text-gold-100 transition hover:bg-gold-300/15"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          更新
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-[18px] border border-loss/30 bg-loss/10 px-4 py-4 text-sm text-loss">{error}</div>
      ) : loading && !response ? (
        <div className="mt-3 rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/70">
          リアルタイム相場データを取得しています。
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <TrendingUp className="h-3.5 w-3.5 text-gold-100" />
            最終取得: {shortTime(response?.fetchedAt)}
            <span className="rounded-full border border-white/10 px-2 py-1">reference only</span>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {sorted.map((snapshot) => (
              <SnapshotCard key={snapshot.symbol} snapshot={snapshot} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
