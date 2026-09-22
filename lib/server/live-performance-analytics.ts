import { readFile } from "node:fs/promises";

import { HISTORICAL_FILL_LINEAGE_BY_ORDER_ID } from "@/lib/server/historical-fill-lineage";

export const LIVE_LOGIC_KEYS = ["V12", "PENGU", "Q102", "FET", "V52", "UNATTRIBUTED"] as const;
export type LiveLogicKey = (typeof LIVE_LOGIC_KEYS)[number];

type AsterHistoryRow = {
  id?: string;
  orderId?: string;
  symbol?: string;
  side?: string;
  price?: number;
  quantity?: number;
  quoteQuantity?: number;
  realizedPnl?: number;
  commission?: number;
  commissionAsset?: string;
  time?: number;
  executedAt?: string;
};

type FillEvent = {
  strategyId?: string;
  eventType?: string;
  symbol?: string;
  orderId?: string;
  clientOrderId?: string;
  executedAt?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  reduceOnly?: boolean;
  entryVersion?: string;
  routeLabel?: string;
  family?: string;
};

type FundingRow = {
  symbol?: string;
  incomeType?: string;
  income?: number | string;
  asset?: string;
  time?: number;
  executedAt?: string;
};

type HistorySnapshot = {
  generatedAt?: string;
  entries?: AsterHistoryRow[];
  fundingIncome?: FundingRow[];
  account?: {
    asset?: string;
    walletBalance?: number;
    availableBalance?: number;
    observedAt?: string;
  };
};

type EquityPoint = {
  observedAt: string;
  walletBalance: number;
  availableBalance?: number;
};

type MarginGuardSnapshot = {
  checkedAt?: number;
  totalMarginBalanceUsd?: number;
  availableBalanceUsd?: number;
};

export type LivePerformanceTrade = {
  id: string;
  orderId: string | null;
  symbol: string;
  side: string;
  executedAt: string;
  realizedPnlUsd: number;
  commissionUsd: number;
  netPnlUsd: number;
  logic: LiveLogicKey;
  logicLabel: string;
  variant: string;
  strategyId: string;
  eventType: string;
  reason: string;
  clientOrderId: string | null;
  attributed: boolean;
};

export type LivePerformancePoint = {
  at: string;
  label: string;
  assetUsd: number;
  cumulativePnlUsd: number;
};

export type LiveLogicSummary = {
  logic: LiveLogicKey;
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

export type LivePerformanceAnalytics = {
  generatedAt: string | null;
  source: "ASTER_OFFICIAL_USER_TRADES";
  attribution: {
    matched: number;
    total: number;
    coveragePct: number;
  };
  balance: {
    currentAssetUsd: number | null;
    availableBalanceUsd: number | null;
    source: "ASTER_BALANCE_SNAPSHOT" | "MARGIN_GUARD" | "UNAVAILABLE";
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
  assetSeriesBasis: "OBSERVED_BALANCE_SNAPSHOTS" | "RECONSTRUCTED_REALIZED_WALLET" | "CUMULATIVE_PNL_ONLY";
  assetSeries: LivePerformancePoint[];
  trades: LivePerformanceTrade[];
  logicSummaries: LiveLogicSummary[];
  logicSeries: Record<LiveLogicKey, Array<{ at: string; label: string; cumulativePnlUsd: number; pnlUsd: number }>>;
  monthly: Array<{
    month: string;
    totalNetPnlUsd: number;
    fundingUsd: number;
    byLogic: Record<LiveLogicKey, number>;
  }>;
};

export type LivePerformancePaths = {
  historyPath?: string;
  fillSpoolPath?: string;
  marginGuardPath?: string;
  equityHistoryPath?: string;
};

const DEFAULT_HISTORY_PATH = process.env.DISDEX_GIT_HISTORY_SNAPSHOT_PATH?.trim()
  || "/home/deploy/ai-dex-manager/data/trade-history-git.json";
const DEFAULT_FILL_SPOOL = process.env.DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH?.trim()
  || "/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl";
const DEFAULT_MARGIN_GUARD = process.env.DISDEX_MARGIN_GUARD_STATE_PATH?.trim()
  || "/var/lib/disdex/shared/margin-risk/guard-live.json";
const DEFAULT_EQUITY_HISTORY = process.env.DISDEX_ACCOUNT_EQUITY_HISTORY_PATH?.trim()
  || "/home/deploy/ai-dex-manager/data/account-equity-history.json";

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function mergeFillEvent(base: FillEvent | undefined, next: FillEvent | undefined): FillEvent {
  const merged: FillEvent = { ...(base || {}) };
  if (!next) return merged;
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && value !== null && value !== "") {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

async function readFillEvents(path: string): Promise<FillEvent[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as FillEvent];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function logicLabel(logic: LiveLogicKey) {
  return logic === "UNATTRIBUTED" ? "未分類" : logic;
}

function classifyStrategy(event?: FillEvent): { logic: LiveLogicKey; variant: string; strategyId: string } {
  const strategyId = String(event?.strategyId || "").trim();
  const upper = strategyId.toUpperCase();
  const trace = [
    strategyId,
    event?.reason,
    event?.clientOrderId,
    event?.entryVersion,
    event?.routeLabel,
    event?.family,
    event?.metadata ? JSON.stringify(event.metadata) : "",
  ].filter(Boolean).join(" ").toUpperCase();

  if (upper.startsWith("V12")) {
    if (/ALTERNATE|ALT_ROUTE|RESIDUAL|DYNAMIC/.test(trace)) return { logic: "V12", variant: "V12 別ルート / Dynamic Residual", strategyId };
    if (/RANK3/.test(trace)) return { logic: "V12", variant: "V12 Rank3", strategyId };
    return { logic: "V12", variant: "V12 通常", strategyId };
  }
  if (upper.includes("PENGU")) {
    if (/RECOVERY_V8/.test(trace)) return { logic: "PENGU", variant: "PENGU Recovery V8", strategyId };
    if (/SHORT_V20/.test(trace)) return { logic: "PENGU", variant: "PENGU Short V20", strategyId };
    if (/LONG_V2_FINAL/.test(trace)) return { logic: "PENGU", variant: "PENGU Long", strategyId };
    return { logic: "PENGU", variant: "PENGU", strategyId };
  }
  if (upper.includes("QUALITY102") || upper.includes("Q102")) {
    const family = ["S34_4H_GRID", "HIGH_VOL", "BRK", "REV", "PB", "MR"].find((value) => trace.includes(value));
    return { logic: "Q102", variant: family ? `Q102 ${family}` : "Q102 Causal V4", strategyId };
  }
  if (upper.includes("FET_BRK48") || upper === "FET") {
    return { logic: "FET", variant: "FET BRK48", strategyId };
  }
  if (upper.startsWith("V52") || upper.includes("V11_EQ") || upper.includes("V50")) {
    const variant = upper.includes("V11_EQ") ? "V52 / V11_EQ" : upper.includes("V50") ? "V52 / V50" : "V52";
    return { logic: "V52", variant, strategyId };
  }
  return { logic: "UNATTRIBUTED", variant: "未分類", strategyId: strategyId || "UNKNOWN" };
}

function isoFrom(row: { executedAt?: string; time?: number }) {
  if (row.executedAt && Number.isFinite(Date.parse(row.executedAt))) return new Date(row.executedAt).toISOString();
  const time = finite(row.time);
  return time > 0 ? new Date(time).toISOString() : new Date(0).toISOString();
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function pointLabel(iso: string) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function emptyLogicRecord(): Record<LiveLogicKey, number> {
  return { V12: 0, PENGU: 0, Q102: 0, FET: 0, V52: 0, UNATTRIBUTED: 0 };
}

function normalizeEquityHistory(raw: unknown): EquityPoint[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { points?: unknown[] }).points)
      ? (raw as { points: unknown[] }).points
      : [];
  return rows.flatMap((value) => {
    const row = value as Partial<EquityPoint>;
    const walletBalance = finite(row.walletBalance, Number.NaN);
    const at = String(row.observedAt || "");
    if (!Number.isFinite(walletBalance) || !Number.isFinite(Date.parse(at))) return [];
    return [{ observedAt: new Date(at).toISOString(), walletBalance, availableBalance: finite(row.availableBalance, Number.NaN) }];
  }).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}

export async function loadLivePerformanceAnalytics(paths: LivePerformancePaths = {}): Promise<LivePerformanceAnalytics> {
  const historyPath = paths.historyPath || DEFAULT_HISTORY_PATH;
  const fillSpoolPath = paths.fillSpoolPath || DEFAULT_FILL_SPOOL;
  const marginGuardPath = paths.marginGuardPath || DEFAULT_MARGIN_GUARD;
  const equityHistoryPath = paths.equityHistoryPath || DEFAULT_EQUITY_HISTORY;

  const [history, fills, marginGuard, equityRaw] = await Promise.all([
    readJson<HistorySnapshot>(historyPath),
    readFillEvents(fillSpoolPath),
    readJson<MarginGuardSnapshot>(marginGuardPath),
    readJson<unknown>(equityHistoryPath),
  ]);

  const fillByOrderId = new Map<string, FillEvent>();
  for (const [orderId, raw] of Object.entries(HISTORICAL_FILL_LINEAGE_BY_ORDER_ID)) {
    fillByOrderId.set(orderId, mergeFillEvent(undefined, raw as FillEvent));
  }
  for (const event of fills) {
    const orderId = String(event.orderId || "").trim();
    if (orderId) fillByOrderId.set(orderId, mergeFillEvent(fillByOrderId.get(orderId), event));
  }

  const entries = Array.isArray(history?.entries) ? history!.entries! : [];
  const trades = entries.map((row, index): LivePerformanceTrade => {
    const orderId = row.orderId == null ? "" : String(row.orderId);
    const fill = orderId ? fillByOrderId.get(orderId) : undefined;
    const classified = classifyStrategy(fill);
    const realizedPnlUsd = finite(row.realizedPnl);
    const commissionUsd = Math.max(0, finite(row.commission));
    const executedAt = isoFrom(row);
    return {
      id: String(row.id || `${orderId || "trade"}-${index}`),
      orderId: orderId || null,
      symbol: String(row.symbol || "").toUpperCase(),
      side: String(row.side || "").toUpperCase(),
      executedAt,
      realizedPnlUsd,
      commissionUsd,
      netPnlUsd: realizedPnlUsd - commissionUsd,
      logic: classified.logic,
      logicLabel: logicLabel(classified.logic),
      variant: classified.variant,
      strategyId: classified.strategyId,
      eventType: String(fill?.eventType || (Math.abs(realizedPnlUsd) > 0 ? "EXIT_FILL" : "FILL")),
      reason: String(fill?.reason || "Aster公式約定"),
      clientOrderId: fill?.clientOrderId ? String(fill.clientOrderId) : null,
      attributed: Boolean(fill),
    };
  }).sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));

  const fundingRows = Array.isArray(history?.fundingIncome) ? history!.fundingIncome! : [];
  const fundingEvents = fundingRows.map((row) => ({
    at: isoFrom(row),
    amount: finite(row.income),
  })).filter((row) => row.amount !== 0);

  const realizedPnlUsd = trades.reduce((sum, row) => sum + row.realizedPnlUsd, 0);
  const commissionUsd = trades.reduce((sum, row) => sum + row.commissionUsd, 0);
  const fundingUsd = fundingEvents.reduce((sum, row) => sum + row.amount, 0);
  const netPnlUsd = realizedPnlUsd - commissionUsd + fundingUsd;
  const exitTrades = trades.filter((row) => row.eventType === "EXIT_FILL" || Math.abs(row.realizedPnlUsd) > 0);
  const wins = exitTrades.filter((row) => row.realizedPnlUsd > 0).length;
  const losses = exitTrades.filter((row) => row.realizedPnlUsd < 0).length;
  const matched = trades.filter((row) => row.attributed).length;

  const logicSummaries = LIVE_LOGIC_KEYS.map((logic): LiveLogicSummary => {
    const rows = trades.filter((row) => row.logic === logic);
    const exits = rows.filter((row) => row.eventType === "EXIT_FILL" || Math.abs(row.realizedPnlUsd) > 0);
    const logicWins = exits.filter((row) => row.realizedPnlUsd > 0).length;
    const logicLosses = exits.filter((row) => row.realizedPnlUsd < 0).length;
    return {
      logic,
      label: logicLabel(logic),
      fillCount: rows.length,
      exitCount: exits.length,
      wins: logicWins,
      losses: logicLosses,
      winRatePct: exits.length ? logicWins / exits.length * 100 : 0,
      realizedPnlUsd: rows.reduce((sum, row) => sum + row.realizedPnlUsd, 0),
      commissionUsd: rows.reduce((sum, row) => sum + row.commissionUsd, 0),
      netPnlUsd: rows.reduce((sum, row) => sum + row.netPnlUsd, 0),
    };
  });

  const logicSeries = Object.fromEntries(LIVE_LOGIC_KEYS.map((logic) => {
    let cumulative = 0;
    return [logic, trades.filter((row) => row.logic === logic).map((row) => {
      cumulative += row.netPnlUsd;
      return {
        at: row.executedAt,
        label: pointLabel(row.executedAt),
        cumulativePnlUsd: cumulative,
        pnlUsd: row.netPnlUsd,
      };
    })];
  })) as LivePerformanceAnalytics["logicSeries"];

  const monthlyMap = new Map<string, { month: string; totalNetPnlUsd: number; fundingUsd: number; byLogic: Record<LiveLogicKey, number> }>();
  for (const row of trades) {
    const month = monthKey(row.executedAt);
    const target = monthlyMap.get(month) || { month, totalNetPnlUsd: 0, fundingUsd: 0, byLogic: emptyLogicRecord() };
    target.totalNetPnlUsd += row.netPnlUsd;
    target.byLogic[row.logic] += row.netPnlUsd;
    monthlyMap.set(month, target);
  }
  for (const row of fundingEvents) {
    const month = monthKey(row.at);
    const target = monthlyMap.get(month) || { month, totalNetPnlUsd: 0, fundingUsd: 0, byLogic: emptyLogicRecord() };
    target.fundingUsd += row.amount;
    target.totalNetPnlUsd += row.amount;
    monthlyMap.set(month, target);
  }
  const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  const snapshotWallet = finite(history?.account?.walletBalance, Number.NaN);
  const snapshotAvailable = finite(history?.account?.availableBalance, Number.NaN);
  const guardBalance = finite(marginGuard?.totalMarginBalanceUsd, Number.NaN);
  const guardAvailable = finite(marginGuard?.availableBalanceUsd, Number.NaN);
  const currentAssetUsd = Number.isFinite(snapshotWallet) ? snapshotWallet : Number.isFinite(guardBalance) ? guardBalance : null;
  const availableBalanceUsd = Number.isFinite(snapshotAvailable) ? snapshotAvailable : Number.isFinite(guardAvailable) ? guardAvailable : null;
  const balanceSource = Number.isFinite(snapshotWallet)
    ? "ASTER_BALANCE_SNAPSHOT"
    : Number.isFinite(guardBalance)
      ? "MARGIN_GUARD"
      : "UNAVAILABLE";
  const balanceObservedAt = history?.account?.observedAt
    || (marginGuard?.checkedAt ? new Date(marginGuard.checkedAt).toISOString() : null);

  const equityHistory = normalizeEquityHistory(equityRaw);
  let assetSeriesBasis: LivePerformanceAnalytics["assetSeriesBasis"];
  let assetSeries: LivePerformancePoint[];

  if (equityHistory.length >= 2) {
    assetSeriesBasis = "OBSERVED_BALANCE_SNAPSHOTS";
    const first = equityHistory[0]?.walletBalance ?? 0;
    assetSeries = equityHistory.map((row) => ({
      at: row.observedAt,
      label: pointLabel(row.observedAt),
      assetUsd: row.walletBalance,
      cumulativePnlUsd: row.walletBalance - first,
    }));
  } else {
    const financialEvents = [
      ...trades.map((row) => ({ at: row.executedAt, amount: row.netPnlUsd })),
      ...fundingEvents.map((row) => ({ at: row.at, amount: row.amount })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const coveredPnl = financialEvents.reduce((sum, row) => sum + row.amount, 0);
    const base = currentAssetUsd == null ? 0 : currentAssetUsd - coveredPnl;
    let asset = base;
    let cumulative = 0;
    assetSeries = financialEvents.map((row) => {
      asset += row.amount;
      cumulative += row.amount;
      return { at: row.at, label: pointLabel(row.at), assetUsd: asset, cumulativePnlUsd: cumulative };
    });
    assetSeriesBasis = currentAssetUsd == null ? "CUMULATIVE_PNL_ONLY" : "RECONSTRUCTED_REALIZED_WALLET";
  }

  return {
    generatedAt: history?.generatedAt || null,
    source: "ASTER_OFFICIAL_USER_TRADES",
    attribution: {
      matched,
      total: trades.length,
      coveragePct: trades.length ? matched / trades.length * 100 : 0,
    },
    balance: {
      currentAssetUsd,
      availableBalanceUsd,
      source: balanceSource,
      observedAt: balanceObservedAt,
    },
    totals: {
      realizedPnlUsd,
      commissionUsd,
      fundingUsd,
      netPnlUsd,
      fillCount: trades.length,
      exitCount: exitTrades.length,
      wins,
      losses,
      winRatePct: exitTrades.length ? wins / exitTrades.length * 100 : 0,
    },
    assetSeriesBasis,
    assetSeries,
    trades: [...trades].reverse(),
    logicSummaries,
    logicSeries,
    monthly,
  };
}
