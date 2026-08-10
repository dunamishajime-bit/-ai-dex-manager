import fs from "fs/promises";
import path from "path";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { readLiveDecisionCache } from "@/lib/server/live-decision-cache-db";

type Sleeve = "PENGU" | "V52";
export type DecisionStatus = "発火候補" | "候補に近い" | "条件不足" | "対象時間外" | "取得不能";

export type DecisionStatusItem = {
  symbol: string;
  sleeve: Sleeve;
  rank: number;
  score: number;
  scoreMax: number;
  status: DecisionStatus;
  side: "LONG" | "SHORT" | "WAIT";
  reason: string;
  checkedAt: string;
  source: string;
  dataUpdatedAt?: string;
  distanceToTrigger?: string;
};

export type DecisionStatusSnapshot = {
  ok: boolean;
  readOnly: true;
  dataAvailable: boolean;
  refreshIntervalMinutes: 60;
  checkedAt: string;
  source: string;
  pengu: { items: DecisionStatusItem[] };
  v52: { marketOpen: boolean; marketLabel: string; items: DecisionStatusItem[] };
  error?: string;
};

type SnapshotCandidate = {
  schemaVersion?: number;
  strategyId?: unknown;
  checkedAt?: unknown;
  source?: unknown;
  dataUpdatedAt?: unknown;
  pengu?: { items?: unknown };
  v52?: { marketOpen?: unknown; marketLabel?: unknown; items?: unknown };
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const VALID_STATUSES = new Set<DecisionStatus>(["発火候補", "候補に近い", "条件不足", "対象時間外", "取得不能"]);
const VALID_SIDES = new Set(["LONG", "SHORT", "WAIT"] as const);

let cache: { expiresAt: number; snapshot: DecisionStatusSnapshot } | null = null;

function newYorkMarketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const open = values.weekday !== "Sat" && values.weekday !== "Sun" && minutes >= 570 && minutes < 960;
  return { open, label: "米国株市場 09:30-16:00（ニューヨーク時間）" };
}

function unavailableItem(symbol: string, sleeve: Sleeve, checkedAt: string, reason: string, source = "実ランナーの読み取り専用スナップショット未接続"): DecisionStatusItem {
  return {
    symbol,
    sleeve,
    rank: 0,
    score: 0,
    scoreMax: 0,
    status: "取得不能",
    side: "WAIT",
    reason,
    checkedAt,
    source,
  };
}

function snapshotPath() {
  const configured = process.env.DISDEX_DECISION_STATUS_SNAPSHOT_PATH?.trim();
  return configured || path.join(process.cwd(), "data", "disdex-decision-status.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeItems(value: unknown, sleeve: Sleeve, checkedAt: string, allowedSymbols: readonly string[]) {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(allowedSymbols.map((symbol) => symbol.toUpperCase()));
  const items: DecisionStatusItem[] = [];

  for (const raw of value) {
    if (!isPlainObject(raw)) return null;
    const symbol = String(raw.symbol || "").trim().toUpperCase();
    const status = String(raw.status || "") as DecisionStatus;
    const side = String(raw.side || "WAIT").toUpperCase() as DecisionStatusItem["side"];
    const reason = String(raw.reason || "").trim();
    if (!allowed.has(symbol) || !VALID_STATUSES.has(status) || !VALID_SIDES.has(side) || !reason) return null;
    const itemCheckedAt = typeof raw.checkedAt === "string" && raw.checkedAt ? raw.checkedAt : checkedAt;
    if (!Number.isFinite(Date.parse(itemCheckedAt))) return null;
    items.push({
      symbol,
      sleeve,
      rank: Math.max(0, Math.trunc(asFiniteNumber(raw.rank))),
      score: asFiniteNumber(raw.score),
      scoreMax: Math.max(0, asFiniteNumber(raw.scoreMax)),
      status,
      side,
      reason,
      checkedAt: itemCheckedAt,
      source: String(raw.source || "実ランナーの読み取り専用スナップショット"),
      dataUpdatedAt: typeof raw.dataUpdatedAt === "string" ? raw.dataUpdatedAt : undefined,
      distanceToTrigger: typeof raw.distanceToTrigger === "string" ? raw.distanceToTrigger : undefined,
    });
  }

  return items;
}

export function normalizeDecisionStatusSnapshot(raw: unknown, now = Date.now()): DecisionStatusSnapshot | null {
  if (!isPlainObject(raw)) return null;
  const candidate = raw as SnapshotCandidate;
  if (candidate.strategyId !== config.strategyId) return null;
  const checkedAt = typeof candidate.checkedAt === "string" ? candidate.checkedAt : "";
  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return null;

  const maxAgeMs = Math.max(60_000, Number(process.env.DISDEX_DECISION_STATUS_MAX_AGE_MS || DEFAULT_MAX_AGE_MS));
  if (now - checkedAtMs > maxAgeMs || checkedAtMs - now > 5 * 60 * 1000) return null;

  const penguItems = normalizeItems(candidate.pengu?.items, "PENGU", checkedAt, config.cryptoSymbols);
  const v52Items = normalizeItems(candidate.v52?.items, "V52", checkedAt, config.stockSymbols);
  if (!penguItems || !v52Items) return null;

  const marketOpen = candidate.v52?.marketOpen === true;
  const marketLabel = typeof candidate.v52?.marketLabel === "string" && candidate.v52.marketLabel
    ? candidate.v52.marketLabel
    : newYorkMarketClock(new Date(now)).label;

  return {
    ok: true,
    readOnly: true,
    dataAvailable: true,
    refreshIntervalMinutes: 60,
    checkedAt,
    source: typeof candidate.source === "string" && candidate.source ? candidate.source : "V96/V52実ランナーの読み取り専用スナップショット",
    pengu: { items: penguItems },
    v52: { marketOpen, marketLabel, items: v52Items },
  };
}

async function readCanonicalSnapshot() {
  try {
    const raw = await fs.readFile(snapshotPath(), "utf8");
    return normalizeDecisionStatusSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function readEmbeddedSnapshot() {
  const payload = await readLiveDecisionCache();
  if (!isPlainObject(payload)) return null;
  const embedded = (payload as unknown as Record<string, unknown>).decisionStatus;
  return normalizeDecisionStatusSnapshot(embedded);
}

export async function loadDecisionStatus(): Promise<DecisionStatusSnapshot> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.snapshot;

  const checkedAt = new Date(now).toISOString();
  const market = newYorkMarketClock(new Date(now));
  const fromCanonical = await readCanonicalSnapshot();
  const fromRunnerCache = fromCanonical || await readEmbeddedSnapshot();
  if (fromRunnerCache) {
    cache = { expiresAt: now + CACHE_TTL_MS, snapshot: fromRunnerCache };
    return fromRunnerCache;
  }

  const penguItems = config.cryptoSymbols.map((symbol) => unavailableItem(
    symbol,
    "PENGU",
    checkedAt,
    "PENGU_DUAL_LS_V1の実ランナー判定スナップショットが未取得のため、発火見込みを推測表示していません。",
  ));
  const v52Items = config.stockSymbols.map((symbol) => market.open
    ? unavailableItem(symbol, "V52", checkedAt, "市場時間内ですが、V52参照データの読み取り専用スナップショットが未取得です。")
    : {
        ...unavailableItem(symbol, "V52", checkedAt, "米国株市場の対象時間外です。市場開始まで参照データ取得と新規注文判定を行いません。", market.label),
        status: "対象時間外" as const,
      });
  const snapshot: DecisionStatusSnapshot = {
    ok: false,
    readOnly: true,
    dataAvailable: false,
    refreshIntervalMinutes: 60,
    checkedAt,
    source: "実ランナーの読み取り専用スナップショット未接続",
    pengu: { items: penguItems },
    v52: { marketOpen: market.open, marketLabel: market.label, items: v52Items },
    error: "実ランナーの判定スナップショットを取得できないため、発火候補を表示していません。",
  };
  cache = { expiresAt: now + CACHE_TTL_MS, snapshot };
  return snapshot;
}
