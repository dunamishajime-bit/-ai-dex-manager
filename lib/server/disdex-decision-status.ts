import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

type Sleeve = "PENGU" | "V52";
type Status = "発火候補" | "候補に近い" | "条件不足" | "対象時間外" | "取得不能";

export type DecisionStatusItem = {
  symbol: string;
  sleeve: Sleeve;
  rank: number;
  score: number;
  scoreMax: number;
  status: Status;
  side: "LONG" | "SHORT" | "WAIT";
  reason: string;
  checkedAt: string;
  source: string;
  dataUpdatedAt?: string;
};

export type DecisionStatusSnapshot = {
  ok: boolean;
  readOnly: true;
  refreshIntervalMinutes: 60;
  checkedAt: string;
  source: string;
  pengu: { items: DecisionStatusItem[] };
  v52: { marketOpen: boolean; marketLabel: string; items: DecisionStatusItem[] };
  error?: string;
};

let cache: { expiresAt: number; snapshot: DecisionStatusSnapshot } | null = null;
const CACHE_TTL_MS = 55 * 60 * 1000;

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

function unavailableItem(symbol: string, sleeve: Sleeve, checkedAt: string, reason: string): DecisionStatusItem {
  return { symbol, sleeve, rank: 0, score: 0, scoreMax: 0, status: "取得不能", side: "WAIT", reason, checkedAt, source: "実ランナーの読み取り専用スナップショット未接続" };
}

export async function loadDecisionStatus(): Promise<DecisionStatusSnapshot> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.snapshot;
  const checkedAt = new Date(now).toISOString();
  const market = newYorkMarketClock(new Date(now));
  const penguItems = config.cryptoSymbols.map((symbol) => unavailableItem(symbol, "PENGU", checkedAt, "PENGU_DUAL_LS_V1の実ランナー判定スナップショットを取得できないため、発火候補を推測表示していません。"));
  const v52Items = config.stockSymbols.map((symbol) => market.open
    ? unavailableItem(symbol, "V52", checkedAt, "市場時間内ですが、V52参照データの読み取り結果を取得できません。")
    : { symbol, sleeve: "V52" as const, rank: 0, score: 0, scoreMax: 0, status: "対象時間外" as const, side: "WAIT" as const, reason: "米国株市場の対象時間外です。市場開始まで参照データ取得と新規注文判定を行いません。", checkedAt, source: market.label });
  const snapshot: DecisionStatusSnapshot = { ok: !market.open, readOnly: true, refreshIntervalMinutes: 60, checkedAt, source: "実ランナーの読み取り専用スナップショット / V52市場時間ゲート", pengu: { items: penguItems }, v52: { marketOpen: market.open, marketLabel: market.label, items: v52Items }, error: market.open ? "PENGU判定とV52参照データの実ランナースナップショットが未接続です。" : undefined };
  cache = { expiresAt: now + CACHE_TTL_MS, snapshot };
  return snapshot;
}
