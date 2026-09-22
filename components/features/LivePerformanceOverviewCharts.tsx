"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/Card";

type Analytics = {
  attribution: { coveragePct: number };
  totals: { netPnlUsd: number };
  balance: { currentAssetUsd: number | null };
  assetSeriesBasis: string;
  assetSeries: Array<{ at: string; label: string; assetUsd: number; cumulativePnlUsd: number }>;
};

function money(value: number, signed = false) {
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compact(value: number) {
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

export function LivePerformanceOverviewCharts() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/system/live-performance", { cache: "no-store" });
        const payload = await response.json();
        if (!cancelled && response.ok && payload?.ok) setAnalytics(payload.analytics as Analytics);
      } catch {
        // Existing performance page remains usable even if this read-only enrichment is unavailable.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const series = analytics?.assetSeries || [];
  const currentAsset = analytics?.balance.currentAssetUsd ?? null;
  const netPnl = analytics?.totals.netPnlUsd ?? 0;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="トータル資産推移" glow="gold">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-white/40">Current Asset</div>
            <div className="mt-1 text-xl font-bold text-white">{currentAsset == null ? "-" : money(currentAsset)}</div>
          </div>
          <div className="text-right text-[11px] text-white/35">
            {analytics?.assetSeriesBasis === "OBSERVED_BALANCE_SNAPSHOTS"
              ? "Aster口座残高snapshot"
              : "Aster公式実損益から再構成"}
          </div>
        </div>
        <div className="h-[280px] w-full">
          {series.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="performanceAssetFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e8c65a" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#e8c65a" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#25303d" />
                <XAxis dataKey="label" stroke="#7f8a99" fontSize={10} minTickGap={30} />
                <YAxis stroke="#7f8a99" fontSize={10} tickFormatter={compact} width={68} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0b1017", borderColor: "#374151" }}
                  formatter={(value) => [money(numeric(value)), "資産"]}
                />
                <Area type="monotone" dataKey="assetUsd" stroke="#e8c65a" fill="url(#performanceAssetFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-white/35">実資産データを取得中です</div>
          )}
        </div>
      </Card>

      <Card title="トータル損益推移" glow="gold">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-xs text-white/40">Net Realized PnL</div>
            <div className={`mt-1 text-xl font-bold ${netPnl > 0 ? "text-emerald-400" : netPnl < 0 ? "text-red-400" : "text-white"}`}>
              {money(netPnl, true)}
            </div>
          </div>
          <div className="text-right text-[11px] text-white/35">
            ロジック帰属率 {analytics ? `${analytics.attribution.coveragePct.toFixed(1)}%` : "-"}
          </div>
        </div>
        <div className="h-[280px] w-full">
          {series.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#25303d" />
                <XAxis dataKey="label" stroke="#7f8a99" fontSize={10} minTickGap={30} />
                <YAxis stroke="#7f8a99" fontSize={10} tickFormatter={compact} width={68} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0b1017", borderColor: "#374151" }}
                  formatter={(value) => [money(numeric(value), true), "累積損益"]}
                />
                <ReferenceLine y={0} stroke="#5d6673" />
                <Line type="monotone" dataKey="cumulativePnlUsd" stroke="#4ade80" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-white/35">実損益データを取得中です</div>
          )}
        </div>
      </Card>
    </div>
  );
}
