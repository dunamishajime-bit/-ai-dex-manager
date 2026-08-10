import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { loadPenguDualLsV1DecisionSnapshot } from "@/lib/server/pengu-dual-ls-v1-decision-snapshot";

type Sleeve = "V96" | "V52";
type Status = "発火候補" | "候補に近い" | "条件不足" | "対象時間外" | "取得不能";
type Candle = { openTime: number; closeTime: number; close: number; volume: number };

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
  v96: { items: DecisionStatusItem[] };
  v52: { marketOpen: boolean; marketLabel: string; items: DecisionStatusItem[] };
  error?: string;
};

let cache: { expiresAt: number; snapshot: DecisionStatusSnapshot } | null = null;
const CACHE_TTL_MS = 55 * 60 * 1000;
const ASTER_BASE_URL = process.env.ASTER_API_BASE_URL?.trim() || "https://fapi.asterdex.com";

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchKlines(symbol: string): Promise<Candle[]> {
  const url = new URL("/fapi/v3/klines", ASTER_BASE_URL);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1h");
  url.searchParams.set("limit", "100");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Aster市場データの取得に失敗しました。");
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Aster市場データの形式が不正です。");
  const now = Date.now();
  return payload.map((row): Candle | null => {
    if (!Array.isArray(row)) return null;
    const openTime = finite(row[0]);
    const close = finite(row[4]);
    const volume = finite(row[5]);
    const closeTime = finite(row[6]);
    if (!openTime || !closeTime || close <= 0 || volume < 0 || closeTime > now) return null;
    return { openTime, closeTime, close, volume };
  }).filter((row): row is Candle => Boolean(row));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function evaluateCandles(symbol: string, sleeve: Sleeve, candles: Candle[], checkedAt: string): DecisionStatusItem {
  if (candles.length < 25) {
    return {
      symbol, sleeve, rank: 0, score: 0, scoreMax: 4, status: "取得不能", side: "WAIT",
      reason: "判定に必要な完成済み1時間足が不足しています。", checkedAt,
      source: "Aster公開市場データ（完成済み1時間足）",
    };
  }
  const latest = candles[candles.length - 1];
  const closes = candles.map((candle) => candle.close);
  const sma20 = average(closes.slice(-20));
  const sma72 = average(closes.slice(-72));
  const momentum6 = latest.close / closes[closes.length - 7] - 1;
  const volumeRatio = latest.volume / Math.max(average(candles.slice(-21, -1).map((candle) => candle.volume)), 1e-12);
  const checks = [
    { label: "短期移動平均を上回っている", passed: latest.close > sma20 },
    { label: "長期移動平均を上回っている", passed: latest.close > sma72 },
    { label: "6時間モメンタムがプラス", passed: momentum6 > 0 },
    { label: "出来高比率が0.7以上", passed: volumeRatio >= 0.7 },
  ];
  const score = checks.filter((check) => check.passed).length;
  const failures = checks.filter((check) => !check.passed).map((check) => check.label);
  const status: Status = score === checks.length ? "発火候補" : score >= 3 ? "候補に近い" : "条件不足";
  return {
    symbol, sleeve, rank: score, score, scoreMax: checks.length, status,
    side: status === "発火候補" ? "LONG" : "WAIT",
    reason: status === "発火候補" ? "公開市場データ上の監視条件を満たしています。実Runnerの注文許可を意味しません。" : `未達条件: ${failures.join("、")}。`,
    checkedAt, source: "Aster公開市場データ（V96実Runner判定ではありません）",
    dataUpdatedAt: new Date(latest.closeTime).toISOString(),
  };
}

function newYorkMarketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = finite(values.hour) * 60 + finite(values.minute);
  const open = values.weekday !== "Sat" && values.weekday !== "Sun" && minutes >= 570 && minutes < 960;
  return { open, label: "米国株市場 09:30–16:00（ニューヨーク時間）" };
}

function unavailableItem(symbol: string, sleeve: Sleeve, checkedAt: string, reason: string, source = "実Runner判定スナップショット") : DecisionStatusItem {
  return { symbol, sleeve, rank: 0, score: 0, scoreMax: 1, status: "取得不能", side: "WAIT", reason, checkedAt, source };
}

async function loadPenguItem(checkedAt: string): Promise<DecisionStatusItem> {
  const result = await loadPenguDualLsV1DecisionSnapshot();
  if (!result.ok) {
    return unavailableItem(
      "PENGUUSDT",
      "V96",
      checkedAt,
      `PENGU_DUAL_LS_V1の実Runner判定スナップショットを取得できないため、発火候補を推測表示していません。${result.reason}`,
      result.source,
    );
  }
  const { snapshot } = result;
  const side = snapshot.side > 0 ? "LONG" : snapshot.side < 0 ? "SHORT" : "WAIT";
  const status: Status = snapshot.edgeTriggered && snapshot.side !== 0
    ? "発火候補"
    : snapshot.longEligible || snapshot.shortEligible
      ? "候補に近い"
      : "条件不足";
  const positionNote = snapshot.positionSide ? "保有中のため新規シグナルは注文に使いません。" : "";
  const modeNote = snapshot.mode === "LIVE" ? "" : `Runner mode=${snapshot.mode}。`;
  const dataTimestamp = snapshot.latestCompletedPenguTs || snapshot.referenceTs;
  return {
    symbol: "PENGUUSDT",
    sleeve: "V96",
    rank: status === "発火候補" ? 1 : 0,
    score: status === "発火候補" ? 1 : 0,
    scoreMax: 1,
    status,
    side,
    reason: `${modeNote}${snapshot.reason}${positionNote}`.trim(),
    checkedAt,
    source: result.source,
    dataUpdatedAt: dataTimestamp > 0 ? new Date(dataTimestamp).toISOString() : undefined,
  };
}

export async function loadDecisionStatus(): Promise<DecisionStatusSnapshot> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.snapshot;
  const checkedAt = new Date(now).toISOString();
  const v96Items: DecisionStatusItem[] = [];
  const market = newYorkMarketClock(new Date(now));
  const v52Items: DecisionStatusItem[] = [];
  const errors: string[] = [];
  for (const symbol of config.cryptoSymbols) {
    if (symbol === "PENGUUSDT") {
      const item = await loadPenguItem(checkedAt);
      v96Items.push(item);
      if (item.status === "取得不能") errors.push(symbol);
      continue;
    }
    try {
      v96Items.push(evaluateCandles(symbol, "V96", await fetchKlines(symbol), checkedAt));
    } catch {
      errors.push(symbol);
      v96Items.push(unavailableItem(symbol, "V96", checkedAt, "Asterから市場データを取得できません。"));
    }
  }
  v96Items.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
  v96Items.forEach((item, index) => { item.rank = item.rank || index + 1; });
  for (const symbol of config.stockSymbols) {
    if (!market.open) {
      v52Items.push({
        symbol, sleeve: "V52", rank: 0, score: 0, scoreMax: 0, status: "対象時間外", side: "WAIT",
        reason: "米国株市場の取引時間外です。参照データ取得と注文判定を停止しています。", checkedAt, source: market.label,
      });
      continue;
    }
    try {
      v52Items.push(evaluateCandles(symbol, "V52", await fetchKlines(symbol), checkedAt));
    } catch {
      errors.push(symbol);
      v52Items.push(unavailableItem(symbol, "V52", checkedAt, "Asterから株式参照データを取得できません。"));
    }
  }
  v52Items.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
  v52Items.forEach((item, index) => { item.rank = item.rank || index + 1; });
  const snapshot: DecisionStatusSnapshot = {
    ok: errors.length === 0,
    readOnly: true,
    refreshIntervalMinutes: 60,
    checkedAt,
    source: "PENGU_DUAL_LS_V1実Runner + Aster公開市場データ（読み取り専用）",
    v96: { items: v96Items },
    v52: { marketOpen: market.open, marketLabel: market.label, items: v52Items },
    error: errors.length ? `取得不能: ${errors.join("、")}` : undefined,
  };
  cache = { expiresAt: now + CACHE_TTL_MS, snapshot };
  return snapshot;
}
