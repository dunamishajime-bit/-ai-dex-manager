"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { HistoryAnalyticsNav } from "@/components/features/HistoryAnalyticsNav";
import { Card } from "@/components/ui/Card";

type LogicKey = "V12" | "PENGU" | "Q102" | "FET" | "V52" | "UNATTRIBUTED";

type Trade = {
  id: string;
  symbol: string;
  side: string;
  executedAt: string;
  realizedPnlUsd: number;
  commissionUsd: number;
  netPnlUsd: number;
  logic: LogicKey;
  logicLabel: string;
  variant: string;
  eventType: string;
  reason: string;
  attributed: boolean;
};

type LogicSummary = {
  logic: LogicKey;
  label: string;
  fillCount: number;
  exitCount: number;
  wins: number;
  losses: number;
  winRatePct: number;
  realizedPnlUsd: number;
  commissionUsd: number;
  netPnlUsd: number;
};

type Analytics = {
  generatedAt: string | null;
  attribution: { matched: number; total: number; coveragePct: number };
  balance: {
    currentAssetUsd: number | null;
    availableBalanceUsd: number | null;
    source: string;
    observedAt: string | null;
  };
  totals: {
    realizedPnlUsd: number;
    commissionUsd: number;
    fundingUsd: number;
    netPnlUsd: number;
    fillCount: number;
    exitCount: number;
    wins: number;
    losses: number;
    winRatePct: number;
  };
  assetSeriesBasis: string;
  assetSeries: Array<{ at: string; label: string; assetUsd: number; cumulativePnlUsd: number }>;
  trades: Trade[];
  logicSummaries: LogicSummary[];
  logicSeries: Record<LogicKey, Array<{ at: string; label: string; cumulativePnlUsd: number; pnlUsd: number }>>;
  monthly: Array<{ month: string; totalNetPnlUsd: number; fundingUsd: number; byLogic: Record<LogicKey, number> }>;
};

type Props = {
  logic?: Exclude<LogicKey, "UNATTRIBUTED">;
  title?: string;
};

function money(value: number | null | undefined, digits = 2, signed = true) {
  if (value == null || !Number.isFinite(value)) return "-";
  const prefix = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : value < 0 ? "-" : "";
  return `${prefix}$${Math.abs(value).toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function pnlClass(value: number) {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-white";
}

function compactUsd(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(abs < 10 ? 2 : 0)}`;
}

function numeric(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function LivePerformanceDashboard({ logic, title }: Props) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/system/live-performance", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "実績データの取得に失敗しました");
      setAnalytics(payload.analytics as Analytics);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "実績データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = useMemo(
    () => logic ? analytics?.logicSummaries.find((row) => row.logic === logic) : null,
    [analytics, logic],
  );

  const monthly = useMemo(() => {
    if (!analytics) return [];
    return analytics.monthly.map((row) => ({
      month: row.month.replace("-", "/"),
      pnlUsd: logic ? Number(row.byLogic[logic] || 0) : row.totalNetPnlUsd,
    }));
  }, [analytics, logic]);

  const visibleTrades = useMemo(
    () => (analytics?.trades || []).filter((row) => !logic || row.logic === logic).slice(0, 40),
    [analytics, logic],
  );

  const logicSeries = logic && analytics ? analytics.logicSeries[logic] || [] : [];
  const netPnl = logic ? Number(summary?.netPnlUsd || 0) : Number(analytics?.totals.netPnlUsd || 0);
  const realizedPnl = logic ? Number(summary?.realizedPnlUsd || 0) : Number(analytics?.totals.realizedPnlUsd || 0);
  const commission = logic ? Number(summary?.commissionUsd || 0) : Number(analytics?.totals.commissionUsd || 0);
  const fillCount = logic ? Number(summary?.fillCount || 0) : Number(analytics?.totals.fillCount || 0);
  const winRate = logic ? Number(summary?.winRatePct || 0) : Number(analytics?.totals.winRatePct || 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-2xl font-bold text-transparent">
            {title || (logic ? `${logic} 実績集計` : "損益集計")}
          </h1>
          <p className="mt-2 text-sm text-white/45">
            Aster公式の実約定・実現損益をProductionの約定メタデータと照合して表示します。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/75 hover:bg-white/[0.08]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          再読み込み
        </button>
      </div>

      <HistoryAnalyticsNav />

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className={`grid gap-3 sm:grid-cols-2 ${logic ? "xl:grid-cols-4" : "xl:grid-cols-5"}`}>
        {!logic ? (
          <Card glow="gold" noHover>
            <div className="text-xs text-white/45">現在資産</div>
            <div className="mt-2 text-2xl font-black text-white">{money(analytics?.balance.currentAssetUsd, 2, false)}</div>
            <div className="mt-1 text-[11px] text-white/35">{analytics?.balance.source || "-"}</div>
          </Card>
        ) : null}

        <Card glow="gold" noHover>
          <div className="text-xs text-white/45">累積ネット損益</div>
          <div className={`mt-2 text-2xl font-black ${pnlClass(netPnl)}`}>{money(netPnl)}</div>
          <div className="mt-1 text-[11px] text-white/35">実現損益 − 手数料{logic ? "" : " + Funding"}</div>
        </Card>

        <Card glow="gold" noHover>
          <div className="text-xs text-white/45">実現損益</div>
          <div className={`mt-2 text-2xl font-black ${pnlClass(realizedPnl)}`}>{money(realizedPnl)}</div>
          <div className="mt-1 text-[11px] text-white/35">Aster official userTrades</div>
        </Card>

        <Card glow="gold" noHover>
          <div className="text-xs text-white/45">手数料</div>
          <div className="mt-2 text-2xl font-black text-amber-300">{money(commission, 2, false)}</div>
          <div className="mt-1 text-[11px] text-white/35">{fillCount} fills</div>
        </Card>

        <Card glow="gold" noHover>
          <div className="text-xs text-white/45">勝率</div>
          <div className="mt-2 text-2xl font-black text-white">{percent(winRate)}</div>
          <div className="mt-1 text-[11px] text-white/35">
            {logic
              ? `${summary?.wins || 0}勝 / ${summary?.losses || 0}敗`
              : `帰属率 ${percent(analytics?.attribution.coveragePct)}`}
          </div>
        </Card>
      </div>

      {!logic ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="トータル資産推移" glow="gold">
            <div className="h-[300px] w-full">
              {analytics?.assetSeries.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.assetSeries}>
                    <defs>
                      <linearGradient id="assetFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#e8c65a" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="#e8c65a" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#25303d" />
                    <XAxis dataKey="label" stroke="#7f8a99" fontSize={10} minTickGap={32} />
                    <YAxis stroke="#7f8a99" fontSize={10} tickFormatter={compactUsd} width={68} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0b1017", borderColor: "#374151" }}
                      formatter={(value) => [money(numeric(value), 2, false), "資産"]}
                    />
                    <Area type="monotone" dataKey="assetUsd" stroke="#e8c65a" fill="url(#assetFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/35">資産データがありません</div>
              )}
            </div>
            <div className="mt-2 text-[11px] text-white/35">
              {analytics?.assetSeriesBasis === "OBSERVED_BALANCE_SNAPSHOTS"
                ? "Aster口座残高snapshotによる実資産推移"
                : analytics?.assetSeriesBasis === "RECONSTRUCTED_REALIZED_WALLET"
                  ? "現在残高をアンカーに、公式実現損益・手数料・Fundingから逆算した実現ベース資産推移"
                  : "実約定の累積損益"}
            </div>
          </Card>

          <Card title="累積損益推移" glow="gold">
            <div className="h-[300px] w-full">
              {analytics?.assetSeries.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analytics.assetSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#25303d" />
                    <XAxis dataKey="label" stroke="#7f8a99" fontSize={10} minTickGap={32} />
                    <YAxis stroke="#7f8a99" fontSize={10} tickFormatter={compactUsd} width={68} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0b1017", borderColor: "#374151" }}
                      formatter={(value) => [money(numeric(value)), "累積損益"]}
                    />
                    <ReferenceLine y={0} stroke="#5d6673" />
                    <Line type="monotone" dataKey="cumulativePnlUsd" stroke="#4ade80" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/35">損益データがありません</div>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <Card title={`${logic} 累積損益推移`} glow="gold">
          <div className="h-[320px] w-full">
            {logicSeries.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={logicSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#25303d" />
                  <XAxis dataKey="label" stroke="#7f8a99" fontSize={10} minTickGap={32} />
                  <YAxis stroke="#7f8a99" fontSize={10} tickFormatter={compactUsd} width={68} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0b1017", borderColor: "#374151" }}
                    formatter={(value) => [money(numeric(value)), "累積損益"]}
                  />
                  <ReferenceLine y={0} stroke="#5d6673" />
                  <Line type="monotone" dataKey="cumulativePnlUsd" stroke="#e8c65a" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/35">まだ実約定がありません</div>
            )}
          </div>
        </Card>
      )}

      <Card title={logic ? `${logic} 月次損益` : "月次損益"} glow="gold">
        <div className="h-[270px] w-full">
          {monthly.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#25303d" />
                <XAxis dataKey="month" stroke="#7f8a99" fontSize={10} />
                <YAxis stroke="#7f8a99" fontSize={10} tickFormatter={compactUsd} width={68} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0b1017", borderColor: "#374151" }}
                  formatter={(value) => [money(numeric(value)), "損益"]}
                />
                <ReferenceLine y={0} stroke="#5d6673" />
                <Bar dataKey="pnlUsd" fill="#d4b45a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-white/35">月次データがありません</div>
          )}
        </div>
      </Card>

      {!logic ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {(analytics?.logicSummaries || []).map((row) => (
            <Card key={row.logic} noHover>
              <div className="text-xs font-bold text-white/55">{row.label}</div>
              <div className={`mt-2 text-xl font-black ${pnlClass(row.netPnlUsd)}`}>{money(row.netPnlUsd)}</div>
              <div className="mt-1 text-[11px] text-white/35">{row.fillCount} fills / 勝率 {percent(row.winRatePct)}</div>
            </Card>
          ))}
        </div>
      ) : null}

      <Card title={logic ? `${logic} 直近実約定` : "直近実約定"} glow="gold">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-white/10 text-white/40">
              <tr>
                <th className="px-3 py-3">日時</th>
                <th className="px-3 py-3">ロジック</th>
                <th className="px-3 py-3">銘柄</th>
                <th className="px-3 py-3">区分</th>
                <th className="px-3 py-3 text-right">実現損益</th>
                <th className="px-3 py-3 text-right">手数料</th>
                <th className="px-3 py-3 text-right">ネット</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrades.map((row) => (
                <tr key={row.id} className="border-b border-white/5 text-white/75">
                  <td className="px-3 py-3 font-mono">{new Date(row.executedAt).toLocaleString("ja-JP")}</td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-white">{row.variant}</div>
                    {!row.attributed ? <div className="text-[10px] text-amber-400">未分類</div> : null}
                  </td>
                  <td className="px-3 py-3 font-mono">{row.symbol}</td>
                  <td className="px-3 py-3">{row.eventType === "EXIT_FILL" ? "決済" : row.eventType === "ENTRY_FILL" ? "新規" : row.side}</td>
                  <td className={`px-3 py-3 text-right font-mono ${pnlClass(row.realizedPnlUsd)}`}>{money(row.realizedPnlUsd, 4)}</td>
                  <td className="px-3 py-3 text-right font-mono text-amber-300">-{money(row.commissionUsd, 4, false)}</td>
                  <td className={`px-3 py-3 text-right font-mono font-bold ${pnlClass(row.netPnlUsd)}`}>{money(row.netPnlUsd, 4)}</td>
                </tr>
              ))}
              {!loading && visibleTrades.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-white/35">実約定がありません</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
