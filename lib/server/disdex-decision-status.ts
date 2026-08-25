import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

type Sleeve = "V12" | "V52";
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
  refreshIntervalMinutes: number;
  checkedAt: string;
  source: string;
  runtime: {
    checkedAt: string;
    units: Array<{
      id: string;
      label: string;
      status: "LIVE" | "STALE" | "UNAVAILABLE" | "UNCONFIRMED";
      releaseSha: string;
      venue: string;
      timeframe: string;
      entryPolicy: string;
      protection: string;
      note: string;
      reason?: string;
      updatedAt?: number;
    }>;
  };
  v12: { items: DecisionStatusItem[] };
  v52: { marketOpen: boolean; marketLabel: string; items: DecisionStatusItem[] };
  error?: string;
};

let cache: { expiresAt: number; snapshot: DecisionStatusSnapshot } | null = null;
const CACHE_TTL_MS = 55 * 60 * 1000;
const ASTER_BASE_URL = process.env.ASTER_API_BASE_URL?.trim() || "https://fapi.asterdex.com";

export function runtimeSnapshot(checkedAt: string): DecisionStatusSnapshot["runtime"] {
  return {
    checkedAt,
    units: [
      {
        id: "V12_X1.00_ALL",
        label: "V12 X1.00 ALL Top2",
        status: "UNCONFIRMED",
        releaseSha: config.vpsObservedReleases.v12,
        venue: "Aster Futures V3",
        timeframe: "完成済み1時間足 → 2時間足",
        entryPolicy: "BTC regime + 全候補score順位から上位最大2候補。合計1.50x / 1件1.00x",
        protection: "ATR/リスク sizing、resident protection、共有daily-risk、Kill Switch",
        note: "VPS stateを実読取できた場合のみLIVE表示。未接続・停止・古いstateはLIVEにしません。",
        reason: "V12 runner stateの実読取結果を待機中です。",
      },
      {
        id: "PENGU_DUAL_LS_V2_FINAL",
        label: "PENGU Dual LS V2 / Short V20",
        status: "UNCONFIRMED",
        releaseSha: config.vpsObservedReleases.pengu,
        venue: "Aster PENGUUSDT",
        timeframe: "完成済みPENGU/BTC 1時間足",
        entryPolicy: "Long/Short条件成立後、次の1時間足。Long最大0.9375x（base0.75×1.25）、Short最大0.75x、保有中の追加・反転なし",
        protection: "Long/Short hard stop・trailing・max hold。新規ShortのみV20 failure/deadline exit。Crypto Gross上限1.50x / Global Gross上限2.50x",
        note: "VPS stateを実読取できた場合のみLIVE表示。未接続・停止・古いstateはLIVEにしません。",
        reason: "PENGU runner stateの実読取結果を待機中です。",
      },
      {
        id: "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",
        label: "V52 Top2 Aster-only",
        status: "UNCONFIRMED",
        releaseSha: config.vpsObservedReleases.v52,
        venue: "Aster-only stock sleeves",
        timeframe: "米国株時間・V11_EQ / V50 window",
        entryPolicy: "固定snapshotのV50候補をRank1通常=1.00x（basis≥65/net≥5）、強=1.25x（100/15）、Rank2=0.25x（85/10）で最大2建玉。各20秒窓（11:30/12:30/13:30 NY）",
        protection: "V50 max hold4h・basis stop1.75x・adverse10bps、V11 tiers 0.75/1.00/1.25/1.50、日次損失・建玉照合・共有Kill Switch。Stock1.50x / Crypto1.50x / Global2.50x",
        note: "VPS stateを実読取できた場合のみLIVE表示。一時的なデータ品質・板・spread拒否だけ窓内retryし、最終拒否はFail Closedです。",
        reason: "V52 runner stateの実読取結果を待機中です。",
      },
    ],
  };
}

function finite(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

async function fetchKlines(symbol: string): Promise<Candle[]> {
  const url = new URL("/fapi/v3/klines", ASTER_BASE_URL);
  url.searchParams.set("symbol", symbol); url.searchParams.set("interval", "1h"); url.searchParams.set("limit", "100");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Aster market data request failed.");
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Aster market data response is invalid.");
  const now = Date.now();
  return payload.map((row): Candle | null => {
    if (!Array.isArray(row)) return null;
    const openTime = finite(row[0]); const close = finite(row[4]); const volume = finite(row[5]); const closeTime = finite(row[6]);
    if (!openTime || !closeTime || close <= 0 || volume < 0 || closeTime > now) return null;
    return { openTime, closeTime, close, volume };
  }).filter((row): row is Candle => Boolean(row));
}

function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

function evaluateCandles(symbol: string, sleeve: Sleeve, candles: Candle[], checkedAt: string): DecisionStatusItem {
  if (candles.length < 25) return { symbol, sleeve, rank: 0, score: 0, scoreMax: 4, status: "取得不能", side: "WAIT", reason: "判定に必要な完成済み1時間足が不足しています。", checkedAt, source: "Aster 公開市場データ（完成済み1時間足）" };
  const latest = candles[candles.length - 1]; const closes = candles.map((candle) => candle.close);
  const sma20 = average(closes.slice(-20)); const sma72 = average(closes.slice(-72));
  const momentum6 = latest.close / closes[closes.length - 7] - 1;
  const volumeRatio = latest.volume / Math.max(average(candles.slice(-21, -1).map((candle) => candle.volume)), 1e-12);
  const checks = [
    { label: "短期移動平均線より上", passed: latest.close > sma20 },
    { label: "長期移動平均線より上", passed: latest.close > sma72 },
    { label: "6時間モメンタムがプラス", passed: momentum6 > 0 },
    { label: "出来高比率が0.7以上", passed: volumeRatio >= 0.7 },
  ];
  const score = checks.filter((check) => check.passed).length;
  const failures = checks.filter((check) => !check.passed).map((check) => check.label);
  const status: Status = score === checks.length ? "発火候補" : score >= 3 ? "候補に近い" : "条件不足";
  return {
    symbol, sleeve, rank: score, score, scoreMax: checks.length, status,
    side: status === "発火候補" ? "LONG" : "WAIT",
    reason: status === "発火候補" ? "監視している基礎条件をすべて満たしています。実行前の本番Gate通過を別途確認します。" : "未達: " + failures.join("\u3001") + "\u3002",
    checkedAt, source: "Aster 公開市場データ（完成済み1時間足）", dataUpdatedAt: new Date(latest.closeTime).toISOString(),
  };
}

function newYorkMarketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = finite(values.hour) * 60 + finite(values.minute);
  const open = values.weekday !== "Sat" && values.weekday !== "Sun" && minutes >= 570 && minutes < 960;
  return { open, label: "米国株式市場 09:30–16:00（ニューヨーク時間）" };
}

function unavailableItem(symbol: string, sleeve: Sleeve, checkedAt: string, reason: string): DecisionStatusItem {
  return { symbol, sleeve, rank: 0, score: 0, scoreMax: 4, status: "取得不能", side: "WAIT", reason, checkedAt, source: "Aster 公開市場データ" };
}

export async function loadDecisionStatus(options: { force?: boolean } = {}): Promise<DecisionStatusSnapshot> {
  const now = Date.now(); if (!options.force && cache && cache.expiresAt > now) return cache.snapshot;
  const checkedAt = new Date(now).toISOString(); const v12Items: DecisionStatusItem[] = [];
  const market = newYorkMarketClock(new Date(now)); const v52Items: DecisionStatusItem[] = []; const errors: string[] = [];
  for (const symbol of config.v12Symbols) {
    try { v12Items.push(evaluateCandles(symbol, "V12", await fetchKlines(symbol), checkedAt)); }
    catch { errors.push(symbol); v12Items.push(unavailableItem(symbol, "V12", checkedAt, "Asterからこの銘柄の判定データを取得できません。")); }
  }
  v12Items.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol)); v12Items.forEach((item, index) => { item.rank = index + 1; });
  for (const symbol of config.stockSymbols) {
    if (!market.open) { v52Items.push({ symbol, sleeve: "V52", rank: 0, score: 0, scoreMax: 4, status: "対象時間外", side: "WAIT", reason: "米国株式市場の対象時間外です。市場開始まで新規判定を行いません。", checkedAt, source: market.label }); continue; }
    try { v52Items.push(evaluateCandles(symbol, "V52", await fetchKlines(symbol), checkedAt)); }
    catch { errors.push(symbol); v52Items.push(unavailableItem(symbol, "V52", checkedAt, "対象時間内ですが、Asterから株式市場データを取得できません。")); }
  }
  v52Items.sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol)); v52Items.forEach((item, index) => { item.rank = index + 1; });
  const snapshot: DecisionStatusSnapshot = { ok: errors.length === 0, readOnly: true, refreshIntervalMinutes: 180, checkedAt, source: "Aster public market data / runtime state observation", runtime: runtimeSnapshot(checkedAt), v12: { items: v12Items }, v52: { marketOpen: market.open, marketLabel: market.label, items: v52Items }, error: errors.length ? "一部銘柄の判定データを取得できません。" : undefined };
  cache = { expiresAt: now + CACHE_TTL_MS, snapshot }; return snapshot;
}
