"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, RefreshCw, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils";

type LaneId = "pengu_goldcat" | "hype_freq" | "eth_reclaim";

type PositionSummary = {
  laneId?: LaneId;
  symbol?: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  entryTs: string;
  sizeMultiplier: number;
  entryCount?: number;
};

type CombinedResponse = {
  ok: boolean;
  strategyType?: "combined";
  activeLaneId?: LaneId;
  checkedAt?: string;
  runtimeMode?: "dry_run" | "live";
  signal?: {
    signalTs: string | null;
    side: "long" | "short" | "flat";
    moveBps: number;
    elapsedSec: number | null;
    bidSupportRatio: number | null;
    spreadBps: number | null;
    accepted: boolean;
    reason: string;
  };
  sizing?: {
    laneId?: LaneId;
    pengu15mAligned: boolean;
    strongAligned: boolean;
    moveBps: number;
    accelBps: number;
    multiplier: number;
    reason: string;
  };
  execution?: {
    laneId?: LaneId;
    executionSymbol?: string;
    holdMinutes: number;
    stopLossPct: number;
    takeProfitPct: number;
    trailActivationPct: number;
    trailRetracePct: number;
  };
  desiredAction?: "enter" | "exit" | "hold" | "skip";
  desiredSide?: "long" | "short" | "flat";
  desiredSymbol?: string;
  currentPosition?: PositionSummary | null;
  currentPositions?: PositionSummary[];
  reason?: string;
  cachedAt?: number;
  stale?: boolean;
  error?: string;
  runtimeControl?: {
    tradingPaused: boolean;
    pausedAt: string | null;
    pauseReason: string | null;
    activeStrategy: "legacy_paused" | "combined_dry_run" | "combined_live";
    updatedAt: string;
    combined?: {
      venue: "AsterDex";
      executionSymbol: string;
      referenceSignal: string;
      marketSymbol: string;
      mode: "dry_run" | "live";
    };
  };
  latestCombinedRun?: {
    triggerLabel?: string;
    executedAt: string;
    decisionTime: string;
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    reason: string;
    currentSymbol?: string;
    tradedCount: number;
    noopCount: number;
    skippedCount: number;
    errorCount: number;
  } | null;
};

function formatDateTime(value?: string | number | null) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function percent(value: number, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function bps(value: number, digits = 2) {
  return `${Number(value || 0).toFixed(digits)}bps`;
}

function sideLabel(side?: "long" | "short" | "flat") {
  if (side === "long") return "LONG";
  if (side === "short") return "SHORT";
  return "WAIT";
}

function actionLabel(action?: "enter" | "exit" | "hold" | "skip") {
  if (action === "enter") return "新規";
  if (action === "exit") return "決済";
  if (action === "hold") return "保有";
  return "見送り";
}

function modeLabel(mode?: "dry_run" | "live") {
  return mode === "live" ? "LIVE" : "DRY RUN";
}

function laneLabel(laneId?: LaneId) {
  if (laneId === "hype_freq") return "HYPE freq";
  if (laneId === "eth_reclaim") return "ETH reclaim";
  return "PENGU GoldCat";
}

function laneExecutionSymbol(position?: { laneId?: LaneId; symbol?: string } | null) {
  if (position?.symbol) return position.symbol;
  if (position?.laneId === "hype_freq") return "HYPE/USDT";
  if (position?.laneId === "eth_reclaim") return "ETH/USDT";
  return "PENGU/USDT";
}

function toneClass(ok: boolean, stale?: boolean) {
  if (!ok) return "border-loss/35 bg-loss/10 text-loss";
  if (stale) return "border-amber-300/35 bg-amber-300/10 text-amber-100";
  return "border-profit/35 bg-profit/10 text-profit";
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-white/55">{label}</div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/68">{detail}</div>
    </div>
  );
}

export function LiveDecisionPanel({ compact = false }: { compact?: boolean }) {
  const [response, setResponse] = useState<CombinedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/system/auto-trade/live-decision", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as CombinedResponse | null;
        if (cancelled) return;

        if (json?.ok && json.strategyType === "combined") {
          setResponse(json);
          setError(null);
        } else {
          setError(json?.error || "combined の状態取得に失敗しました。");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "combined の状態取得に失敗しました。");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("auto-trade-live-decision-refresh", load);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("auto-trade-live-decision-refresh", load);
    };
  }, []);

  const summaryTone = useMemo(
    () => toneClass(Boolean(response?.signal?.accepted), response?.stale),
    [response?.signal?.accepted, response?.stale],
  );

  const currentPositions = useMemo(() => {
    if (Array.isArray(response?.currentPositions) && response.currentPositions.length > 0) {
      return response.currentPositions;
    }
    return response?.currentPosition ? [response.currentPosition] : [];
  }, [response?.currentPosition, response?.currentPositions]);

  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <TrendingUp className="h-4 w-4 text-white" />
          combined ライブ判断
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/70">
          <RefreshCw className="h-3.5 w-3.5" />
          {response?.runtimeMode ? modeLabel(response.runtimeMode) : "loading"}
        </div>
      </div>

      {loading ? (
        <div className="mt-3 rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/70">
          combined の最新状態を読み込んでいます。
        </div>
      ) : error ? (
        <div className="mt-3 rounded-[18px] border border-loss/35 bg-loss/10 px-4 py-6 text-sm text-loss">{error}</div>
      ) : response ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 lg:grid-cols-4">
            <StatCard
              label="Strategy"
              value={response.runtimeControl?.activeStrategy === "combined_live" ? "combined live" : "combined dry run"}
              detail={`${laneLabel(response.activeLaneId)} / ${response.execution?.executionSymbol || response.runtimeControl?.combined?.executionSymbol || "PENGU/USDT"} / ${currentPositions.length} position${currentPositions.length === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Signal"
              value={`${sideLabel(response.signal?.side)} / ${response.signal?.accepted ? "accepted" : "skip"}`}
              detail={response.signal?.reason || "-"}
            />
            <StatCard
              label="Sizing"
              value={`${Number(response.sizing?.multiplier || 1).toFixed(2)}x`}
              detail={response.sizing?.reason || "-"}
            />
            <StatCard
              label="Action"
              value={actionLabel(response.desiredAction)}
              detail={response.reason || "-"}
            />
          </div>

          <div className={cn("rounded-[20px] border px-4 py-4", summaryTone)}>
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
              {response.signal?.accepted ? <Activity className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              BTC 15m GoldCat シグナル
              <span className="rounded-full border border-white/12 px-2 py-0.5 text-[10px] font-bold text-white/80">
                {sideLabel(response.signal?.side)}
              </span>
            </div>
            <div className="mt-2 grid gap-2 text-[12px] text-white/82 md:grid-cols-2 xl:grid-cols-4">
              <div>判定時刻: {formatDateTime(response.signal?.signalTs || response.checkedAt)}</div>
              <div>move: {bps(response.signal?.moveBps || 0)}</div>
              <div>elapsed: {response.signal?.elapsedSec != null ? `${response.signal.elapsedSec}s` : "-"}</div>
              <div>spread: {response.signal?.spreadBps != null ? bps(response.signal.spreadBps) : "-"}</div>
              <div>bid support: {response.signal?.bidSupportRatio != null ? Number(response.signal.bidSupportRatio).toFixed(2) : "-"}</div>
              <div>lane: {laneLabel(response.activeLaneId)}</div>
              <div>sizing move: {bps(response.sizing?.moveBps || 0)}</div>
              <div>sizing accel: {bps(response.sizing?.accelBps || 0)}</div>
              <div>cache: {formatDateTime(response.cachedAt)}</div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Clock3 className="h-4 w-4 text-gold-100" />
                Exit 条件
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <StatCard label="Hold" value={`${response.execution?.holdMinutes || 25}m`} detail="最大保有時間" />
                <StatCard label="Stop Loss" value={percent(response.execution?.stopLossPct || 0)} detail="逆行時の損切り幅" />
                <StatCard label="Take Profit" value={percent(response.execution?.takeProfitPct || 0)} detail="利確ライン" />
                <StatCard
                  label="Trail"
                  value={`${percent(response.execution?.trailActivationPct || 0)} / ${percent(response.execution?.trailRetracePct || 0)}`}
                  detail="発動 / 戻し幅"
                />
              </div>
            </div>

            <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Activity className="h-4 w-4 text-gold-100" />
                現在ポジション
              </div>
              {currentPositions.length > 0 ? (
                <div className="mt-3 space-y-3 text-[12px] text-white/82">
                  {currentPositions.map((position, index) => (
                    <div key={`${position.laneId || "lane"}-${position.entryTs}-${index}`} className="rounded-[16px] border border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="font-bold text-white">
                        {laneLabel(position.laneId)} / {position.side.toUpperCase()} / {laneExecutionSymbol(position)} / {Number(position.sizeMultiplier).toFixed(2)}x
                      </div>
                      <div>建値: {Number(position.entryPrice || 0).toFixed(6)}</div>
                      <div>数量: {Number(position.quantity || 0).toFixed(6)}</div>
                      <div>建玉時刻: {formatDateTime(position.entryTs)}</div>
                      <div>追加回数: {position.entryCount || 1}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-[12px] leading-6 text-white/72">
                  現在はノーポジションです。条件成立までは USDT 待機です。
                </div>
              )}
            </div>
          </div>

          {!compact && response.latestCombinedRun ? (
            <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
              <div className="text-sm font-bold text-white">直近実行</div>
              <div className="mt-2 grid gap-2 text-[12px] text-white/82 md:grid-cols-2 xl:grid-cols-4">
                <div>実行時刻: {formatDateTime(response.latestCombinedRun.executedAt)}</div>
                <div>判定時刻: {formatDateTime(response.latestCombinedRun.decisionTime)}</div>
                <div>約定数: {response.latestCombinedRun.tradedCount}</div>
                <div>保持: {response.latestCombinedRun.noopCount}</div>
                <div>見送り: {response.latestCombinedRun.skippedCount}</div>
                <div>エラー: {response.latestCombinedRun.errorCount}</div>
                <div className="md:col-span-2 xl:col-span-4">理由: {response.latestCombinedRun.reason}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
