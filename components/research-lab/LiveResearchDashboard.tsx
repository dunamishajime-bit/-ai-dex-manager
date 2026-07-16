"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ResearchDashboardPayload } from "@/lib/research-lab/dashboard-types";

const REFRESH_INTERVAL_MS = 60_000;

function formatPct(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function formatNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("ja-JP");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "未取得";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未取得";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function freshnessLabel(value: ResearchDashboardPayload["freshness"]) {
  if (value === "fresh") return { label: "最新", className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100" };
  if (value === "delayed") return { label: "更新待ち", className: "border-amber-400/30 bg-amber-500/10 text-amber-100" };
  if (value === "stale") return { label: "古いデータ", className: "border-rose-400/30 bg-rose-500/10 text-rose-100" };
  return { label: "状態不明", className: "border-white/15 bg-white/5 text-white/70" };
}

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55">{label}</span>
        <Icon className="h-4 w-4 text-gold-100" />
      </div>
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
      <p className="mt-2 text-[11px] leading-5 text-white/55">{note}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-[18px] border border-dashed border-white/10 bg-black/15 px-4 text-center text-sm text-white/50">
      {message}
    </div>
  );
}

export default function LiveResearchDashboard() {
  const [payload, setPayload] = useState<ResearchDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/research-lab/latest", { cache: "no-store" });
      const body = await response.json() as ResearchDashboardPayload & { error?: string; detail?: string };
      if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
      setPayload(body);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const chartData = useMemo(() => payload?.history.map((item) => ({
    cycle: `C${item.cycle}`,
    train: Number(item.bestTrainMonthlyPct.toFixed(2)),
    oos: item.bestOosMonthlyPct == null ? null : Number(item.bestOosMonthlyPct.toFixed(2)),
    stress: item.bestWorstStressMonthlyPct == null ? null : Number(item.bestWorstStressMonthlyPct.toFixed(2)),
  })) ?? [], [payload]);

  if (loading && !payload) {
    return (
      <section className="rounded-[24px] border border-gold-400/16 bg-white/[0.035] p-5">
        <div className="flex items-center gap-3 text-sm text-white/70">
          <RefreshCw className="h-4 w-4 animate-spin text-gold-100" />
          最新の研究結果を読み込んでいます…
        </div>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/[0.055] p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-200" />
          <div>
            <h2 className="font-bold text-rose-50">研究結果を取得できませんでした</h2>
            <p className="mt-2 text-sm text-rose-50/70">{error || "Stateブランチへの接続を確認してください。"}</p>
            <button
              type="button"
              onClick={() => void load(true)}
              className="mt-4 rounded-xl border border-rose-300/20 bg-black/20 px-4 py-2 text-xs font-bold text-rose-50"
            >
              再取得
            </button>
          </div>
        </div>
      </section>
    );
  }

  const freshness = freshnessLabel(payload.freshness);
  const latest = payload.latest;

  return (
    <section className="space-y-4 rounded-[26px] border border-sky-400/18 bg-[linear-gradient(180deg,rgba(14,24,38,0.78),rgba(4,8,14,0.95))] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-white md:text-2xl">最新自動研究ダッシュボード</h2>
            <span className={`rounded-full border px-3 py-1 text-[10px] font-bold ${freshness.className}`}>{freshness.label}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-white/55">
            XServer VPSのこの画面から、GitHub Actionsが保存した最新Stateを60秒ごとに自動取得します。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/65">
            最終完了 {formatDate(payload.lastRunAt)} JST
          </span>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-gold-400/20 bg-gold-400/10 px-3 py-2 text-xs font-bold text-gold-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            更新
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          自動更新に失敗しました。最後に取得できた結果を表示中です：{error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Cycle" value={`${payload.cycle}`} note={`次回Profile: ${payload.nextProfile.toUpperCase()}`} icon={Clock3} />
        <MetricCard label="Latest OOS" value={formatPct(latest?.bestOosMonthlyPct)} note={`目標 ${payload.targets.oosMonthlyPct}%以上`} icon={Target} />
        <MetricCard label="Latest Train" value={formatPct(latest?.bestTrainMonthlyPct)} note="Trainだけの高収益は採用しません" icon={Sparkles} />
        <MetricCard label="Latest MaxDD" value={formatPct(latest?.bestOosDrawdownPct)} note="OOS期間の最大下落率" icon={ShieldCheck} />
        <MetricCard label="Worst Stress" value={formatPct(latest?.bestWorstStressMonthlyPct)} note={`最終基準 ${payload.targets.stressMonthlyPct}%以上`} icon={AlertTriangle} />
        <MetricCard label="Unique Logic" value={formatNumber(payload.deduplication.totalUniqueLogic)} note={`今回 +${payload.deduplication.newUniqueLogicTested}`} icon={CheckCircle2} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-white">Cycle別 月利推移</h3>
              <p className="mt-1 text-[11px] text-white/50">Train・完全未使用OOS・最悪Cost Stressを比較</p>
            </div>
            <span className="text-[10px] text-white/40">直近30 cycle</span>
          </div>
          <div className="mt-4 h-72 w-full">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                  <XAxis dataKey="cycle" stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 11 }} />
                  <YAxis stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 11 }} tickFormatter={(value) => `${value}%`} />
                  <Tooltip
                    contentStyle={{ background: "#080b11", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12 }}
                    labelStyle={{ color: "white" }}
                    formatter={(value) => `${Number(value).toFixed(2)}%`}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={payload.targets.oosMonthlyPct} stroke="rgba(250,204,21,0.7)" strokeDasharray="5 5" label="OOS目標30%" />
                  <Line type="monotone" dataKey="train" name="Train" stroke="#facc15" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="oos" name="OOS" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="stress" name="Worst Stress" stroke="#fb7185" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyState message="Cycle履歴がまだありません。" />}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-gold-100" />
              <h3 className="font-bold text-white">最新Cycle</h3>
            </div>
            <div className="mt-4 space-y-2 text-xs text-white/70">
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>評価</span><b>{formatNumber(latest?.evaluations)}</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>OOS検証</span><b>{formatNumber(latest?.validated)}</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>最終候補</span><b>{formatNumber(latest?.finalCandidates)}</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>重複除外</span><b>{formatNumber(payload.deduplication.duplicateStrategiesSkipped)}</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>連続候補なし</span><b>{formatNumber(payload.consecutiveNoCandidate)}</b></div>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
            <h3 className="font-bold text-white">次回の自動改善</h3>
            <div className="mt-3 space-y-2">
              {payload.nextPlan.length ? payload.nextPlan.map((item) => (
                <div key={item} className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-xs leading-5 text-white/65">
                  {item}
                </div>
              )) : <p className="text-xs text-white/45">改善計画はまだありません。</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-white">次Cycleへ継承されるElite戦略</h3>
            <p className="mt-1 text-[11px] text-white/50">成績順位ではなく、次回探索に残された戦略構造と主要パラメータです。</p>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-white/55">{payload.elites.length} Elite</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {payload.elites.length ? payload.elites.map((elite) => (
            <article key={elite.id} className="rounded-[18px] border border-white/8 bg-white/[0.025] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold-100/65">{elite.family}</div>
                  <h4 className="mt-1 text-sm font-black text-white">{elite.id}</h4>
                </div>
                <span className="rounded-lg border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-100">{elite.timeframeHours}H</span>
              </div>
              <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/55">{elite.thesis}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {elite.symbols.slice(0, 8).map((symbol) => (
                  <span key={symbol} className="rounded-md border border-white/8 bg-black/20 px-2 py-1 text-[10px] text-white/65">{symbol}</span>
                ))}
                {elite.symbols.length > 8 ? <span className="px-1 py-1 text-[10px] text-white/40">+{elite.symbols.length - 8}</span> : null}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-white/55">
                <div className="rounded-lg border border-white/8 px-2 py-2"><span className="block text-white/35">Leverage</span><b className="text-white/80">{elite.leverage.toFixed(2)}x</b></div>
                <div className="rounded-lg border border-white/8 px-2 py-2"><span className="block text-white/35">Risk / Trade</span><b className="text-white/80">{elite.riskPerTradePct.toFixed(2)}%</b></div>
                <div className="rounded-lg border border-white/8 px-2 py-2"><span className="block text-white/35">Margin Use</span><b className="text-white/80">{elite.maxMarginUsagePct.toFixed(1)}%</b></div>
                <div className="rounded-lg border border-white/8 px-2 py-2"><span className="block text-white/35">Edge / Cost</span><b className="text-white/80">{elite.minimumEdgeToCostRatio.toFixed(2)}</b></div>
              </div>
              <div className="mt-3 text-[10px] text-white/40">
                {elite.allowLong ? "Long" : ""}{elite.allowLong && elite.allowShort ? " / " : ""}{elite.allowShort ? "Short" : ""}・Neutral {elite.allowNeutralRegime ? "ON" : "OFF"}
              </div>
            </article>
          )) : <EmptyState message="Elite戦略がまだ保存されていません。" />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={payload.links.actions} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold text-white/70">
          Actions実行履歴 <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a href={payload.links.latestReport} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold text-white/70">
          最新レポート <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a href={payload.links.state} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold text-white/70">
          全State <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a href={payload.links.issues} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs font-bold text-white/70">
          候補・障害通知 <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </section>
  );
}
