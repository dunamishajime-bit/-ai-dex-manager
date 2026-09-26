import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { loadCurrentProductionRuntime, type CurrentProductionRuntime } from "@/lib/server/current-production-runtime";

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
const CACHE_TTL_MS = 25_000;

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

export function runtimeSnapshot(
  checkedAt: string,
  currentRuntime: CurrentProductionRuntime | null,
): DecisionStatusSnapshot["runtime"] {
  const releaseSha = currentRuntime?.releaseSha ?? "UNAVAILABLE";
  const caps = currentRuntime?.caps;
  const v12 = currentRuntime?.v12;
  const pengu = currentRuntime?.pengu;
  const q102 = currentRuntime?.quality102;
  const v52 = currentRuntime?.v52;
  return {
    checkedAt,
    units: [
      {
        id: v12?.strategyId ?? "V12_X1.00_ALL",
        label: v12 ? v12.strategyId : "V12 runtime unavailable",
        status: "UNCONFIRMED",
        releaseSha,
        venue: "Aster Futures V3",
        timeframe: "closed H1 -> H2",
        entryPolicy: v12 && caps
          ? `Score>=${v12.neutralScoreThreshold.toFixed(4)} / Strong ${v12.strongRegimeQualityScoreMinimum.toFixed(2)}-${v12.strongRegimeQualityScoreMaximum.toFixed(2)} + ATR/Price>=${(v12.strongRegimeQualityMinimumAtrRatio * 100).toFixed(1)}% / Top${v12.maximumPositions} / Base ${caps.v12BaseGross.toFixed(2)}x / Dynamic ${caps.v12DynamicGross.toFixed(2)}x / per-position ${caps.v12PerPositionGross.toFixed(2)}x`
          : "Production runtime unavailable; no static contract fallback.",
        protection: caps
          ? `Crypto ${caps.cryptoGross.toFixed(2)}x / Total ${caps.totalGross.toFixed(2)}x / daily loss ${caps.sharedCryptoDailyLossPct}% / Aster 5x Cross`
          : "Production runtime unavailable.",
        note: "LIVE is shown only when VPS state and current Production contract are both readable.",
        reason: "Waiting for V12 runner state.",
      },
      {
        id: pengu?.strategyId ?? "PENGU_DUAL_LS_V2_FINAL",
        label: pengu?.strategyId ?? "PENGU runtime unavailable",
        status: "UNCONFIRMED",
        releaseSha,
        venue: "Aster PENGUUSDT",
        timeframe: "closed PENGU/BTC H1",
        entryPolicy: pengu && caps
          ? `Gross ${caps.penguGross.toFixed(2)}x / Recovery ${pengu.recoveryRule} ${pengu.recoveryInitialGross.toFixed(2)}x / cooldown ${pengu.hardStopCooldownHours}h`
          : "Production runtime unavailable; no static contract fallback.",
        protection: pengu && caps
          ? `Recovery hard stop ${(pengu.recoveryHardStopPct * 100).toFixed(1)}% / trail activation ${(pengu.recoveryTrailActivationPct * 100).toFixed(1)}% / retrace ${(pengu.recoveryTrailRetracePct * 100).toFixed(1)}% / Crypto ${caps.cryptoGross.toFixed(2)}x`
          : "Production runtime unavailable.",
        note: "LIVE is shown only when VPS state and current Production contract are both readable.",
        reason: "Waiting for PENGU runner state.",
      },
      {
        id: "QUALITY102_CAUSAL_V1",
        label: q102 ? `Q102 ${q102.selectorMode}` : "Q102 runtime unavailable",
        status: "UNCONFIRMED",
        releaseSha,
        venue: "Aster Futures crypto sleeve",
        timeframe: "causal LIVE data only",
        entryPolicy: q102 && caps
          ? `${q102.selectorMode} / 1 slot / max ${caps.quality102Gross.toFixed(2)}x / HIGH_VOL ${q102.familyGross.HIGH_VOL.toFixed(3)}x / BRK ${q102.familyGross.BRK.toFixed(3)}x`
          : "Production runtime unavailable; no static contract fallback.",
        protection: caps
          ? `Crypto ${caps.cryptoGross.toFixed(2)}x / Total ${caps.totalGross.toFixed(2)}x / shared risk / Kill Switch / Aster 5x Cross`
          : "Production runtime unavailable.",
        note: "No fixed CSV playback/replay; displays causal selector/planner/live-adapter state.",
        reason: "Waiting for Q102 runner state/heartbeat.",
      },
      {
        id: "FET_BRK48_RESIDUAL",
        label: "FET BRK48 Residual",
        status: "UNCONFIRMED",
        releaseSha,
        venue: "Aster Futures FETUSDT",
        timeframe: "BRK48 residual signal",
        entryPolicy: "FET BRK48の確定データだけを評価し、Core entryと競合時はpreemptibleな残余枠で判定",
        protection: "5x Cross・reduce-only protection・reconciliation・共有risk・Kill Switch",
        note: "flat / no-signal時もrunner heartbeatを表示し、state stale時はLIVEにしません。",
        reason: "Waiting for FET runner state.",
      },
      {
        id: "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96",
        label: v52 ? `V52 ${v52.policyId}` : "V52 runtime unavailable",
        status: "UNCONFIRMED",
        releaseSha,
        venue: "Aster-only stock sleeves",
        timeframe: "US stock V11_EQ / V50 windows",
        entryPolicy: v52
          ? `${v52.policyId}: Basis>=${v52.minimumEntryBasisBps}bps / Convergence ${v52.convergenceBps}bps / Net Edge>=${v52.minimumNetEdgeBps}bps / ${v52.windowsNy.join(" / ")} NY`
          : "Production runtime unavailable; no static contract fallback.",
        protection: v52 && caps
          ? `Hold<=${v52.maximumHoldingHours}h / basis stop ${v52.basisStopMultiple}x / Cost<=${v52.maximumRoundTripCostBps}bps / Spread<=${v52.maximumSpreadBps}bps / Stock ${caps.stockGross.toFixed(2)}x / Total ${caps.totalGross.toFixed(2)}x`
          : "Production runtime unavailable.",
        note: "LIVE is shown only when VPS state and current Production contract are both readable.",
        reason: "Waiting for V52 runner state.",
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
  const rejections = object(diagnostics?.rejectionCounters);
  if (!rejections) return "直近の拒否理由は未取得です。";
  const summary = Object.entries(rejections)
    .map(([reason, count]) => `${reason}=${Number(count) || 0}`)
    .filter((entry) => !entry.endsWith("=0"))
    .slice(0, 5)
    .join(" / ");
  return summary ? `直近Gate拒否: ${summary}` : "直近の候補拒否はありません。";
}

function v52ItemsFromState(state: JsonObject, checkedAt: string, runtime?: CurrentProductionRuntime["v52"]): DecisionStatusItem[] {
  const telemetry = object(state.v52Top2Telemetry);
  const windowNames = runtime?.windowsNy?.length ? runtime.windowsNy : Object.keys(telemetry || {});
  const windows = windowNames
    .map((window) => object(telemetry?.[window]))
    .filter((item): item is JsonObject => Boolean(item));
  const candidates = windows.flatMap((window) => Array.isArray(window.candidates) ? window.candidates.map(object).filter((item): item is JsonObject => Boolean(item)) : []);
  const dayParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const currentNyDay = `${dayParts.find((part) => part.type === "year")?.value}-${dayParts.find((part) => part.type === "month")?.value}-${dayParts.find((part) => part.type === "day")?.value}`;
  const diagnostics = object(state.v52GateDiagnostics);
  const diagnosticsNyDay = text(diagnostics?.nyDay ?? object(state.v50Top2Telemetry)?.nyDay ?? state.nyDay);
  const dailyFresh = diagnosticsNyDay === currentNyDay && (!state.v50DailyEntriesDay || state.v50DailyEntriesDay === currentNyDay);
  if (!dailyFresh) {
    const reason = `STALE / V52 daily diagnostics未更新（diagnostics=${diagnosticsNyDay || "未取得"} / current=${currentNyDay}）。前日のGate拒否は現在理由として表示しません。`;
    return config.stockSymbols.map((symbol) => ({
      ...unavailableItem(symbol, "V52", checkedAt, reason),
      status: "取得不能" as const,
      reason,
      source: "VPS V52 runner telemetry",
    }));
  }
  if (!candidates.length) {
    const reason = `本日判定済み / 条件適合候補なし（NY day ${currentNyDay}）。${rejectionSummary(state)}`;
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
        scoreMax: Math.max(runtime?.minimumEntryBasisBps ?? basisBps, basisBps),
        status: rank <= 2 ? "候補に近い" as const : "条件不足" as const,
        side: "WAIT" as const,
        reason: `V52 runner telemetry Rank${rank}候補。basis=${basisBps.toFixed(2)}bps / required=${runtime?.minimumEntryBasisBps ?? "runtime unavailable"}bps。V50/V11のnet edge・板・容量・発注Windowを別途通過する必要があります。`,
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
  const currentRuntime = await loadCurrentProductionRuntime().catch((error) => {
    errors.push(error instanceof Error ? error.message : "Current production runtime could not be resolved.");
    return null;
  });
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
      ? v52ItemsFromState(v52State, checkedAt, currentRuntime?.v52)
      : config.stockSymbols.map((symbol) => unavailableItem(symbol, "V52", checkedAt, errors[errors.length - 1] || "V52 runner stateを読み取れません。"));

  const snapshot: DecisionStatusSnapshot = {
    ok: errors.length === 0,
    readOnly: true,
    refreshIntervalMinutes: 0.5,
    checkedAt,
    source: "VPS runner state / sanitized decision snapshot",
    runtime: runtimeSnapshot(checkedAt, currentRuntime),
    v12: { items: v12Items },
    v52: { marketOpen: market.open, marketLabel: market.label, items: v52Items },
    error: errors.length ? errors.join(" / ") : undefined,
  };
  cache = { expiresAt: now + CACHE_TTL_MS, snapshot };
  return snapshot;
}
