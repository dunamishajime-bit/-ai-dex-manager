"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, TrendingUp } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { useCurrency } from "@/context/CurrencyContext";
import { useOperationalWallet } from "@/hooks/useOperationalWallet";
import { cn } from "@/lib/utils";

type TradeHistoryEntry = {
  id: string;
  executedAt: string;
  walletAddress: string;
  action: "BUY" | "SELL";
  sourceSymbol: string;
  destSymbol: string;
  sourceUsdValue: number;
  realizedPnlUsd?: number;
  realizedPnlPct?: number;
  openedAt?: string;
};

type ClosedTrade = TradeHistoryEntry & {
  realizedPnlUsd: number;
  realizedPnlPct: number;
  openedAt: string;
};

type PeriodSummary = {
  key: string;
  label: string;
  startCapital: number;
  endCapital: number;
  pnlUsd: number;
  returnPct: number;
  tradeCount: number;
};

type PortfolioPeriodSummary = {
  label: string;
  startPortfolioUsd: number;
  endPortfolioUsd: number;
  pnlUsd: number;
  returnPct: number;
  capturedAt: string;
} | null;

const LOGIC_CHANGE_DATE_KEY = "2026-05-24";

function formatNumber(value?: number, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return value.toLocaleString("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatPct(value?: number, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${formatNumber(value, digits)}%`;
}

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  next.setDate(next.getDate() + (day === 0 ? -6 : 1 - day));
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function weekLabel(date: Date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

function toClosedTrades(entries: TradeHistoryEntry[]) {
  return entries
    .filter(
      (entry): entry is ClosedTrade =>
        entry.action === "SELL"
        && typeof entry.realizedPnlUsd === "number"
        && typeof entry.realizedPnlPct === "number"
        && Boolean(entry.openedAt),
    )
    .sort((left, right) => new Date(left.executedAt).getTime() - new Date(right.executedAt).getTime());
}

function buildPeriodSummaries(
  trades: ClosedTrade[],
  keyFn: (date: Date) => string,
  labelFn: (date: Date) => string,
) {
  if (!trades.length) return [] as PeriodSummary[];

  const seedCapital = Math.max(1, Number(trades[0].sourceUsdValue || 0));
  const grouped = new Map<string, { label: string; trades: ClosedTrade[] }>();

  for (const trade of trades) {
    const closeDate = new Date(trade.executedAt);
    const key = keyFn(closeDate);
    const current = grouped.get(key);
    if (current) {
      current.trades.push(trade);
    } else {
      grouped.set(key, { label: labelFn(closeDate), trades: [trade] });
    }
  }

  let rollingCapital = seedCapital;
  return Array.from(grouped.entries())
    .map(([key, group]) => {
      const pnlUsd = group.trades.reduce((sum, trade) => sum + trade.realizedPnlUsd, 0);
      const startCapital = rollingCapital;
      const endCapital = startCapital + pnlUsd;
      const returnPct = startCapital > 0 ? (pnlUsd / startCapital) * 100 : 0;
      rollingCapital = endCapital;
      return {
        key,
        label: group.label,
        startCapital,
        endCapital,
        pnlUsd,
        returnPct,
        tradeCount: group.trades.length,
      };
    })
    .reverse();
}

function buildCalendarDays(month: Date) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const start = startOfWeek(first);
  const end = startOfWeek(last);
  end.setDate(end.getDate() + 6);

  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function toneClass(value: number) {
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-white";
}

export default function PerformancePage() {
  const { formatPrice } = useCurrency();
  const { wallet } = useOperationalWallet();
  const [entries, setEntries] = useState<TradeHistoryEntry[]>([]);
  const [portfolioWeekly, setPortfolioWeekly] = useState<PortfolioPeriodSummary>(null);
  const [portfolioMonthly, setPortfolioMonthly] = useState<PortfolioPeriodSummary>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));

  async function loadEntries() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/system/trade-history", { cache: "no-store" });
      if (!response.ok) throw new Error("取引履歴の読み込みに失敗しました。");
      const data = await response.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "取引履歴の読み込みに失敗しました。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    async function loadPerformanceSummary() {
      if (!wallet?.userId && !wallet?.email) return;
      const params = new URLSearchParams();
      if (wallet?.userId) params.set("userId", wallet.userId);
      if (wallet?.email) params.set("email", wallet.email);
      const response = await fetch(`/api/system/performance-summary?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) return;
      setPortfolioWeekly(data.weekly ?? null);
      setPortfolioMonthly(data.monthly ?? null);
    }

    void loadPerformanceSummary();
  }, [wallet?.email, wallet?.userId]);

  useEffect(() => {
    void loadEntries();
  }, []);

  const closedTrades = useMemo(() => toClosedTrades(entries), [entries]);
  const weekly = useMemo(
    () => buildPeriodSummaries(closedTrades, (date) => dateKey(startOfWeek(date)), weekLabel).slice(0, 8),
    [closedTrades],
  );
  const monthly = useMemo(
    () => buildPeriodSummaries(closedTrades, (date) => monthKey(startOfMonth(date)), monthLabel).slice(0, 6),
    [closedTrades],
  );

  const latestTradeOpenedAt = closedTrades.length ? closedTrades[closedTrades.length - 1].openedAt : null;
  const latestWeek = weekly[0];
  const latestMonth = monthly[0];

  useEffect(() => {
    if (latestTradeOpenedAt) {
      setMonthCursor(startOfMonth(new Date(latestTradeOpenedAt)));
    }
  }, [latestTradeOpenedAt]);

  const calendarDays = useMemo(() => buildCalendarDays(monthCursor), [monthCursor]);
  const calendarMap = useMemo(() => {
    const map = new Map<string, ClosedTrade[]>();
    for (const trade of closedTrades) {
      const key = dateKey(new Date(trade.openedAt));
      map.set(key, [...(map.get(key) || []), trade]);
    }
    return map;
  }, [closedTrades]);

  const monthTrades = useMemo(
    () => closedTrades.filter((trade) => monthKey(new Date(trade.openedAt)) === monthKey(monthCursor)).reverse(),
    [closedTrades, monthCursor],
  );

  const portfolioUsd = Number(wallet?.lastPortfolioUsd || 0);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-2xl font-bold text-transparent">
            成績カレンダー
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            実際の約定履歴をもとに、週次・月次・日別の成績を確認できます。
          </p>
        </div>
        <button
          onClick={() => void loadEntries()}
          className="flex items-center gap-2 rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-2 text-sm text-gold-200 transition-colors hover:bg-gold-500/20"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          更新
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card glow="gold" noHover>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Current Portfolio</div>
          <div className="mt-2 text-2xl font-semibold text-white">{formatPrice(portfolioUsd)}</div>
          <div className="mt-1 text-sm text-gray-400">現在のAster口座評価額</div>
        </Card>
        <Card glow="gold" noHover>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Weekly Realized PnL</div>
          <div className={cn("mt-2 text-2xl font-semibold", toneClass(portfolioWeekly?.pnlUsd ?? 0))}>
            {portfolioWeekly ? formatPrice(portfolioWeekly.pnlUsd) : "-"}
          </div>
          <div className="mt-1 text-sm text-gray-400">
            {portfolioWeekly ? `${portfolioWeekly.label} / ${formatPct(portfolioWeekly.returnPct, 2)} / real balance` : "週次の残高履歴がまだ不足しています。"}
          </div>
        </Card>
        <Card glow="gold" noHover>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Monthly Realized PnL</div>
          <div className={cn("mt-2 text-2xl font-semibold", toneClass(portfolioMonthly?.pnlUsd ?? 0))}>
            {portfolioMonthly ? formatPrice(portfolioMonthly.pnlUsd) : "-"}
          </div>
          <div className="mt-1 text-sm text-gray-400">
            {portfolioMonthly ? `${portfolioMonthly.label} / ${formatPct(portfolioMonthly.returnPct, 2)} / real balance` : "月次の残高履歴がまだ不足しています。"}
          </div>
        </Card>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        上部カードはAster口座評価額のスナップショット差分です。下の週次・月次サマリーと日別一覧は closed trade の実現損益です。
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
        <Card title="週次サマリー" glow="gold">
          <div className="space-y-3">
            {weekly.map((item) => (
              <PeriodRow key={item.key} item={item} formatPrice={formatPrice} />
            ))}
            {!weekly.length && !isLoading ? <div className="text-sm text-gray-500">週次データはまだありません。</div> : null}
          </div>
        </Card>

        <Card title="月次サマリー" glow="gold">
          <div className="space-y-3">
            {monthly.map((item) => (
              <PeriodRow key={item.key} item={item} formatPrice={formatPrice} />
            ))}
            {!monthly.length && !isLoading ? <div className="text-sm text-gray-500">月次データはまだありません。</div> : null}
          </div>
        </Card>
      </div>

      <Card title="トレードカレンダー" glow="gold">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-gold-300" />
            <div>
              <div className="text-lg font-semibold text-white">{monthLabel(monthCursor)}</div>
              <div className="text-xs text-gray-500">エントリー日ベースでクローズ成績を表示</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/80 hover:bg-white/10"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMonthCursor(startOfMonth(latestTradeOpenedAt ? new Date(latestTradeOpenedAt) : new Date()))}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
            >
              最新月
            </button>
            <button
              type="button"
              onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/80 hover:bg-white/10"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-2 text-center text-xs uppercase tracking-[0.18em] text-gray-500">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
            <div key={label} className="py-2">
              {label}
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-7 gap-2 overflow-x-auto">
          {calendarDays.map((day) => {
            const key = dateKey(day);
            const trades = calendarMap.get(key) || [];
            const isLogicChangeDay = key === LOGIC_CHANGE_DATE_KEY;
            const inMonth = day.getMonth() === monthCursor.getMonth();
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[120px] min-w-[86px] rounded-xl border p-2 md:min-w-0",
                  inMonth ? "border-white/10 bg-white/[0.03]" : "border-white/5 bg-white/[0.015] opacity-45",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className={cn("text-sm font-semibold", inMonth ? "text-white" : "text-gray-500")}>
                    {day.getDate()}
                  </div>
                  {trades.length ? (
                    <div className="rounded-full border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 text-[10px] font-semibold text-gold-200">
                      {trades.length}
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1.5">
                  {trades.slice(0, 3).map((trade) => (
                    <div key={trade.id} className="rounded-lg border border-white/8 bg-black/20 px-2 py-1.5">
                      <div className="truncate text-[11px] font-semibold text-white">
                        {trade.sourceSymbol}/{trade.destSymbol}
                      </div>
                      <div className={cn("mt-1 text-[11px] font-semibold", toneClass(trade.realizedPnlPct))}>
                        {formatPct(trade.realizedPnlPct, 2)}
                      </div>
                    </div>
                  ))}
                  {trades.length > 3 ? <div className="text-[11px] text-gray-500">+{trades.length - 3} more</div> : null}
                  {isLogicChangeDay ? (
                    <div className="rounded-lg border border-amber-300/35 bg-amber-300/10 px-2 py-1.5 text-[10px] font-semibold leading-4 text-amber-100">
                      ロジック変更: combined へ移行
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <TrendingUp className="h-4 w-4 text-gold-300" />
            月内トレード一覧
          </div>
          <div className="space-y-2">
            {monthTrades.map((trade) => (
              <div
                key={trade.id}
                className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-white">
                    {trade.sourceSymbol}/{trade.destSymbol}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    entry {new Date(trade.openedAt).toLocaleDateString("ja-JP")} / close {new Date(trade.executedAt).toLocaleDateString("ja-JP")}
                  </div>
                </div>
                <div className="flex items-center gap-4 md:gap-6">
                  <TradeValue label="損益率" value={formatPct(trade.realizedPnlPct, 2)} tone={trade.realizedPnlPct} />
                  <TradeValue label="損益" value={formatPrice(trade.realizedPnlUsd)} tone={trade.realizedPnlUsd} />
                </div>
              </div>
            ))}
            {!monthTrades.length && !isLoading ? <div className="text-sm text-gray-500">この月のクローズ済み取引はまだありません。</div> : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

function PeriodRow({ item, formatPrice }: { item: PeriodSummary; formatPrice: (value: number) => string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{item.label}</div>
          <div className="mt-1 text-xs text-gray-500">
            start {formatPrice(item.startCapital)} / end {formatPrice(item.endCapital)}
          </div>
        </div>
        <div className="text-right">
          <div className={cn("text-lg font-semibold", toneClass(item.returnPct))}>{formatPct(item.returnPct, 2)}</div>
          <div className={cn("mt-1 text-xs", toneClass(item.pnlUsd))}>{formatPrice(item.pnlUsd)}</div>
        </div>
      </div>
    </div>
  );
}

function TradeValue({ label, value, tone }: { label: string; value: string; tone: number }) {
  return (
    <div className="text-right">
      <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className={cn("mt-1 text-sm font-semibold", toneClass(tone))}>{value}</div>
    </div>
  );
}
