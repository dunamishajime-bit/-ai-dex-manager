import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

type Sleeve = "V12" | "V52";
type Status = "発火候補" | "候補に近い" | "条件不足" | "対象時間外" | "取得不能";
type JsonObject = Record<string, unknown>;

const MAX_JSON_BYTES = 512 * 1024;

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

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function side(value: unknown): DecisionStatusItem["side"] {
  if (typeof value === "number") return value > 0 ? "LONG" : value < 0 ? "SHORT" : "WAIT";
  const normalized = String(value || "").toUpperCase();
  return normalized === "LONG" || normalized === "1" ? "LONG" : normalized === "SHORT" || normalized === "-1" ? "SHORT" : "WAIT";
}

async function readState(pathValue: string | undefined, label: string): Promise<JsonObject> {
  const configuredPath = String(pathValue || "").trim();
  if (!configuredPath) throw new Error(`${label}の絶対パスがUIサービスに設定されていません。`);
  if (!isAbsolute(configuredPath)) throw new Error(`${label}は絶対パスで設定してください。`);
  const content = await readFile(configuredPath, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) throw new Error(`${label}が読み取り上限を超えています。`);
  const parsed = object(JSON.parse(content));
  if (!parsed) throw new Error(`${label}の形式が不正です。`);
  return parsed;
}

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
        protection: "ATR/リスク sizing、resident protection、共有daily-risk、Kill Switch。Crypto共有2.00x / Total2.50x",
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
        protection: "Long/Short hard stop・trailing・max hold。新規ShortのみV20 failure/deadline exit。Crypto Gross上限2.00x / Global Gross上限2.50x",
        note: "VPS stateを実読取できた場合のみLIVE表示。未接続・停止・古いstateはLIVEにしません。",
        reason: "PENGU runner stateの実読取結果を待機中です。",
      },
      {
        id: "QUALITY102_CAUSAL_V1",
        label: "Quality102 derived high-vol sleeve",
        status: "UNCONFIRMED",
        releaseSha: config.vpsObservedReleases.quality102,
        venue: "Aster Futures crypto sleeve",
        timeframe: "LIVE時点の利用可能データのみ",
        entryPolicy: "Derived HIGH_VOL selector。1 slot / 最大0.50x。V12・PENGU・V52を優先し、残余Crypto/Total Grossだけを使用",
        protection: "Crypto Gross最大2.00x / Total Gross最大2.50x、shared risk、Kill Switch、reconciliation、stale-data Fail Closed",
        note: "歴史的102件selector parity未証明部分とBRKはLIVEに流用せずFail Closed。derived sleeveの実state/heartbeatだけを表示します。",
        reason: "Quality102 runner state/heartbeatの実読取結果を待機中です。",
      },
      {
        id: "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",
        label: "V52 Top2 Aster-only",
        status: "UNCONFIRMED",
        releaseSha: config.vpsObservedReleases.v52,
        venue: "Aster-only stock sleeves",
        timeframe: "米国株時間・V11_EQ / V50 window",
        entryPolicy: "固定snapshotのV50候補をRank1通常=1.00x（basis≥65/net≥5）、強=1.25x（100/15）、Rank2=0.25x（85/10）で最大2建玉。各20秒窓（11:30/12:30/13:30 NY）",
        protection: "V50 max hold4h・basis stop1.75x・adverse10bps、V11 tiers 0.75/1.00/1.25/1.50、日次損失・建玉照合・共有Kill Switch。Stock1.50x / Crypto2.00x / Global2.50x",
        note: "VPS stateを実読取できた場合のみLIVE表示。一時的なデータ品質・板・spread拒否だけ窓内retryし、最終拒否はFail Closedです。",
        reason: "V52 runner stateの実読取結果を待機中です。",
      },
    ],
  };
}

function unavailableItem(symbol: string, sleeve: Sleeve, checkedAt: string, reason: string): DecisionStatusItem {
  return {
    symbol,
    sleeve,
    rank: 0,
    score: 0,
    scoreMax: 1,
    status: "取得不能",
    side: "WAIT",
    reason: `${reason} VPSのsanitized snapshotがない場合、過去データから推測表示しません。`,
    checkedAt,
    source: "VPS runner state / sanitized decision snapshot",
  };
}

function v12ItemsFromSnapshot(state: JsonObject, checkedAt: string): DecisionStatusItem[] {
  const candidates = Array.isArray(state.candidates) ? state.candidates.map(object).filter((item): item is JsonObject => Boolean(item)) : [];
  if (!candidates.length) return config.v12Symbols.map((symbol) => unavailableItem(symbol, "V12", checkedAt, "V12 decision snapshotに候補がありません。"));

  const btcRegime = text(state.btcRegime ?? state.regime) || "UNKNOWN";
  const referenceTs = finite(state.referenceTs);
  return candidates
    .map((candidate, index) => {
      const rank = finite(candidate.rank) ?? index + 1;
      const score = finite(candidate.score) ?? 0;
      const symbolName = text(candidate.symbol) || `CANDIDATE_${index + 1}`;
      const candidateSide = side(candidate.side);
      const status: Status = rank <= 2 ? "候補に近い" : "条件不足";
      return {
        symbol: symbolName,
        sleeve: "V12" as const,
        rank,
        score,
        scoreMax: 1,
        status,
        side: candidateSide,
        reason: `V12 runner候補Rank${rank}。score=${score.toFixed(4)} / BTC regime=${btcRegime}。候補順位は発火・発注成立を意味しません。実runnerのSignal Gate・共有risk・容量Gateを別途確認します。`,
        checkedAt,
        source: "VPS V12 sanitized decision snapshot",
        dataUpdatedAt: referenceTs === undefined ? undefined : new Date(referenceTs).toISOString(),
      } satisfies DecisionStatusItem;
    })
    .sort((left, right) => left.rank - right.rank || right.score - left.score);
}

function rejectionSummary(state: JsonObject): string {
  const diagnostics = object(state.v52GateDiagnostics);
  const rejections = object(diagnostics?.rejections);
  if (!rejections) return "直近の拒否理由は未取得です。";
  const summary = Object.entries(rejections)
    .map(([reason, count]) => `${reason}=${Number(count) || 0}`)
    .filter((entry) => !entry.endsWith("=0"))
    .slice(0, 5)
    .join(" / ");
  return summary ? `直近Gate拒否: ${summary}` : "直近の候補拒否はありません。";
}

function v52ItemsFromState(state: JsonObject, checkedAt: string): DecisionStatusItem[] {
  const telemetry = object(state.v52Top2Telemetry);
  const windows = config.v52Top2Policy.windowsNy
    .map((window) => object(telemetry?.[window]))
    .filter((item): item is JsonObject => Boolean(item));
  const candidates = windows.flatMap((window) => Array.isArray(window.candidates) ? window.candidates.map(object).filter((item): item is JsonObject => Boolean(item)) : []);
  if (!candidates.length) {
    const reason = `V52 runner telemetryに候補がありません。${rejectionSummary(state)}`;
    return config.stockSymbols.map((symbol) => ({
      ...unavailableItem(symbol, "V52", checkedAt, reason),
      status: "条件不足" as const,
      reason,
      source: "VPS V52 runner telemetry",
    }));
  }

  const updatedAt = finite(state.updatedAt);
  return candidates
    .map((candidate, index) => {
      const rank = finite(candidate.qualifiedRank ?? candidate.candidateRank) ?? index + 1;
      const basisBps = finite(candidate.basisBps) ?? 0;
      return {
        symbol: text(candidate.symbol) || `STOCK_CANDIDATE_${index + 1}`,
        sleeve: "V52" as const,
        rank,
        score: basisBps,
        scoreMax: Math.max(65, basisBps),
        status: rank <= 2 ? "候補に近い" as const : "条件不足" as const,
        side: "WAIT" as const,
        reason: `V52 runner telemetry Rank${rank}候補。basis=${basisBps.toFixed(2)}bps。V50/V11のnet edge・板・容量・発注Windowを別途通過する必要があります。`,
        checkedAt,
        source: "VPS V52 runner telemetry",
        dataUpdatedAt: updatedAt === undefined ? undefined : new Date(updatedAt).toISOString(),
      } satisfies DecisionStatusItem;
    })
    .sort((left, right) => left.rank - right.rank || right.score - left.score);
}

function newYorkMarketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minutes = (Number(values.hour) || 0) * 60 + (Number(values.minute) || 0);
  const open = values.weekday !== "Sat" && values.weekday !== "Sun" && minutes >= 570 && minutes < 960;
  return { open, label: "米国株式市場 09:30–16:00（ニューヨーク時間）" };
}

export async function loadDecisionStatus(options: { force?: boolean } = {}): Promise<DecisionStatusSnapshot> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) return cache.snapshot;

  const checkedAt = new Date(now).toISOString();
  const errors: string[] = [];
  let v12State: JsonObject | null = null;
  let v52State: JsonObject | null = null;

  try {
    v12State = await readState(process.env.V12_DECISION_SNAPSHOT_PATH || process.env.V12_X1_ALL_STATE_PATH, "V12 decision snapshot");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "V12 decision snapshotを読み取れません。");
  }

  const market = newYorkMarketClock(new Date(now));
  if (market.open) {
    try {
      v52State = await readState(process.env.V52_ASTER_ONLY_STATE_PATH, "V52 runner state");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "V52 runner stateを読み取れません。");
    }
  }

  const v12Items = v12State
    ? v12ItemsFromSnapshot(v12State, checkedAt)
    : config.v12Symbols.map((symbol) => unavailableItem(symbol, "V12", checkedAt, errors[0] || "V12 decision snapshotを読み取れません。"));
  const v52Items = !market.open
    ? config.stockSymbols.map((symbol) => ({
      symbol,
      sleeve: "V52" as const,
      rank: 0,
      score: 0,
      scoreMax: 1,
      status: "対象時間外" as const,
      side: "WAIT" as const,
      reason: "米国株式市場の対象時間外です。市場開始まで新規判定を行いません。",
      checkedAt,
      source: market.label,
    }))
    : v52State
      ? v52ItemsFromState(v52State, checkedAt)
      : config.stockSymbols.map((symbol) => unavailableItem(symbol, "V52", checkedAt, errors[errors.length - 1] || "V52 runner stateを読み取れません。"));

  const snapshot: DecisionStatusSnapshot = {
    ok: errors.length === 0,
    readOnly: true,
    refreshIntervalMinutes: 180,
    checkedAt,
    source: "VPS runner state / sanitized decision snapshot",
    runtime: runtimeSnapshot(checkedAt),
    v12: { items: v12Items },
    v52: { marketOpen: market.open, marketLabel: market.label, items: v52Items },
    error: errors.length ? errors.join(" / ") : undefined,
  };
  cache = { expiresAt: now + CACHE_TTL_MS, snapshot };
  return snapshot;
}
