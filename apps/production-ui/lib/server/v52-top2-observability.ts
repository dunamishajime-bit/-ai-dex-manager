import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { loadCurrentProductionRuntime, type CurrentProductionRuntime } from "@/lib/server/current-production-runtime";

type JsonObject = Record<string, unknown>;
const MAX_JSON_BYTES = 512 * 1024;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export type V52Top2Candidate = {
  candidateRank?: number;
  qualifiedRank?: number;
  symbol?: string;
  basisBps?: number;
};

export type V52Top2DecisionRow = {
  candidateRank?: number;
  qualifiedRank?: number;
  symbol?: string;
  requestedGross?: number;
  allocatedGross?: number;
  availableGrossBeforeEntry?: number;
  globalGrossBeforeReservation?: number;
  globalGrossAfterReservation?: number;
  activeV50Slots?: number;
  rank2Accepted?: boolean | null;
  rank2RejectedReason?: string | null;
  orderBlockedReason?: string | null;
  orderSendAttempted?: boolean;
  orderResult?: string;
  attemptIndex?: number;
};

export type V52CostDecision = {
  timestamp?: number;
  nyDay?: string;
  strategy?: string;
  symbol?: string;
  window?: string;
  direction?: string;
  signalBasisBps?: number;
  currentBasisBps?: number;
  estimatedRoundTripCostBps?: number;
  spreadBps?: number;
  vwapSlippageBps?: number;
  calculatedNetEdgeBps?: number;
  accepted?: boolean;
  rejectionReasons?: string[];
  grossRequested?: number;
  grossAccepted?: number;
};

export type V52Top2Window = {
  window: string;
  decisionWindowEntered: boolean;
  signalCaptureSucceeded: boolean;
  transientRetryCount: number;
  candidates: V52Top2Candidate[];
  entries: V52Top2DecisionRow[];
  rejections: V52Top2DecisionRow[];
};

export type V52Top2Observability = {
  ok: boolean;
  readOnly: true;
  tradingMutation: 0;
  configured: boolean;
  status: "LIVE" | "STALE" | "UNAVAILABLE";
  capturedAt: string;
  updatedAt?: number;
  mode?: string;
  reason?: string;
  referenceHealth?: { ready: boolean; reason: string };
  referenceStatus?: string;
  referenceOrdersAllowed?: boolean;
  killSwitchActive: boolean;
  killSwitchReason?: string;
  activeV50Slots: number;
  v50DailyEntries: number;
  currentNyDay: string;
  diagnosticsNyDay?: string;
  dailyDiagnosticsFresh: boolean;
  telemetryState: "CURRENT_DAY" | "STALE" | "MISSING";
  thresholds: {
    basisBps: number;
    convergenceBps: number;
    stopMultiple: number;
    netEdgeBps: number;
    maxCostBps: number;
    maxSpreadBps: number;
  };
  lastDecision?: V52CostDecision;
  rejectionCounters: Record<string, number>;
  positions: Array<{ slot: string; symbol?: string; side?: string; gross?: number }>;
  windows: V52Top2Window[];
  errors: string[];
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function nyDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function costDecision(value: unknown): V52CostDecision | undefined {
  const source = object(value);
  if (!source) return undefined;
  const reasons = Array.isArray(source.rejectionReasons)
    ? source.rejectionReasons.map((item) => text(item)).filter((item): item is string => Boolean(item))
    : undefined;
  return {
    timestamp: finite(source.timestamp),
    nyDay: text(source.nyDay),
    strategy: text(source.strategy),
    symbol: text(source.symbol),
    window: text(source.window),
    direction: text(source.direction),
    signalBasisBps: finite(source.signalBasisBps),
    currentBasisBps: finite(source.currentBasisBps),
    estimatedRoundTripCostBps: finite(source.estimatedRoundTripCostBps),
    spreadBps: finite(source.spreadBps),
    vwapSlippageBps: finite(source.VWAPSlippageBps ?? source.vwapSlippageBps),
    calculatedNetEdgeBps: finite(source.calculatedNetEdgeBps ?? source.estimatedNetEdgeBps),
    accepted: bool(source.accepted),
    rejectionReasons: reasons,
    grossRequested: finite(source.grossRequested),
    grossAccepted: finite(source.grossAccepted),
  };
}

function thresholdsFor(runtime: CurrentProductionRuntime | null): V52Top2Observability["thresholds"] {
  const v52 = runtime?.v52;
  return {
    basisBps: v52?.minimumEntryBasisBps ?? Number.NaN,
    convergenceBps: v52?.convergenceBps ?? Number.NaN,
    stopMultiple: v52?.basisStopMultiple ?? Number.NaN,
    netEdgeBps: v52?.minimumNetEdgeBps ?? Number.NaN,
    maxCostBps: v52?.maximumRoundTripCostBps ?? Number.NaN,
    maxSpreadBps: v52?.maximumSpreadBps ?? Number.NaN,
  };
}

async function readReferenceHealth() {
  const configuredUrl = String(process.env.V52_REFERENCE_HEALTH_URL || "").trim();
  if (!configuredUrl) return undefined;
  try {
    const response = await fetch(configuredUrl, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ready: false, reason: "REFERENCE_SERVICE_HTTP_" + response.status };
    const health = object(await response.json());
    const ready = health?.freshnessReady === true;
    return {
      ready,
      reason: ready ? "REFERENCE_FRESHNESS_READY" : text(health?.healthReason) || text(health?.pythError) || "REFERENCE_SOURCE_OR_QUOTE_QUALITY_NOT_READY",
    };
  } catch {
    return { ready: false, reason: "REFERENCE_SERVICE_UNAVAILABLE" };
  }
}

function row(value: unknown): V52Top2DecisionRow {
  const source = object(value) || {};
  return {
    candidateRank: finite(source.candidateRank),
    qualifiedRank: finite(source.qualifiedRank),
    symbol: text(source.symbol),
    requestedGross: finite(source.requestedGross),
    allocatedGross: finite(source.allocatedGross),
    availableGrossBeforeEntry: finite(source.availableGrossBeforeEntry),
    globalGrossBeforeReservation: finite(source.globalGrossBeforeReservation),
    globalGrossAfterReservation: finite(source.globalGrossAfterReservation),
    activeV50Slots: finite(source.activeV50Slots),
    rank2Accepted: bool(source.rank2Accepted) ?? null,
    rank2RejectedReason: text(source.rank2RejectedReason) ?? null,
    orderBlockedReason: text(source.orderBlockedReason) ?? null,
    orderSendAttempted: bool(source.orderSendAttempted),
    orderResult: text(source.orderResult),
    attemptIndex: finite(source.attemptIndex),
  };
}

function candidate(value: unknown): V52Top2Candidate {
  const source = object(value) || {};
  return {
    candidateRank: finite(source.candidateRank),
    qualifiedRank: finite(source.qualifiedRank),
    symbol: text(source.symbol),
    basisBps: finite(source.basisBps),
  };
}

function windowSnapshot(window: string, value: unknown): V52Top2Window {
  const source = object(value) || {};
  const candidates = Array.isArray(source.candidates) ? source.candidates.map(candidate).slice(0, 10) : [];
  const entries = Array.isArray(source.entries) ? source.entries.map(row).slice(-10) : [];
  const rejections = Array.isArray(source.rejections) ? source.rejections.map(row).slice(-10) : [];
  return {
    window,
    decisionWindowEntered: Boolean(source.decisionWindowEntered),
    signalCaptureSucceeded: Boolean(source.signalCaptureSucceeded),
    transientRetryCount: finite(source.transientRetryCount) || 0,
    candidates,
    entries,
    rejections,
  };
}

function unavailable(capturedAt: string, configured: boolean, error: string, thresholds: V52Top2Observability["thresholds"], windowsNy: string[]): V52Top2Observability {
  return {
    ok: false,
    readOnly: true,
    tradingMutation: 0,
    configured,
    status: "UNAVAILABLE",
    capturedAt,
    reason: error,
    killSwitchActive: false,
    activeV50Slots: 0,
    v50DailyEntries: 0,
    currentNyDay: nyDay(),
    dailyDiagnosticsFresh: false,
    telemetryState: "MISSING",
    thresholds,
    rejectionCounters: {},
    positions: [],
    windows: windowsNy.map((window) => windowSnapshot(window, null)),
    errors: [error],
  };
}

export async function loadV52Top2Observability(): Promise<V52Top2Observability> {
  const capturedAt = new Date().toISOString();
  const currentRuntime = await loadCurrentProductionRuntime().catch(() => null);
  const thresholds = thresholdsFor(currentRuntime);
  const windowsNy = currentRuntime?.v52.windowsNy ?? [];
  const configuredPath = String(process.env.V52_ASTER_ONLY_STATE_PATH || "").trim();
  if (!configuredPath) return unavailable(capturedAt, false, "V52_ASTER_ONLY_STATE_PATH がUIサービスに設定されていません。", thresholds, windowsNy);
  if (!isAbsolute(configuredPath)) return unavailable(capturedAt, true, "V52_ASTER_ONLY_STATE_PATH は絶対パスで設定してください。", thresholds, windowsNy);

  try {
    const content = await readFile(configuredPath, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) return unavailable(capturedAt, true, "V52 runner state が読み取り上限を超えています。", thresholds, windowsNy);
    const state = object(JSON.parse(content));
    if (!state) return unavailable(capturedAt, true, "V52 runner state の形式が不正です。", thresholds, windowsNy);

    const updatedAt = finite(state.updatedAt);
    const ageMs = updatedAt === undefined ? undefined : Math.max(0, Date.now() - updatedAt);
    const killSwitch = object(state.killSwitch);
    const killSwitchActive = Boolean(killSwitch?.active ?? state.killSwitchActive);
    const positionsObject = object(state.positions) || {};
    const positions = Object.entries(positionsObject).map(([slot, value]) => {
      const position = object(value) || {};
      return { slot, symbol: text(position.symbol), side: text(position.side), gross: finite(position.gross) };
    }).filter((position) => position.slot.startsWith("V50") || position.slot === "V11_EQ");
    const windows = windowsNy.map((window) => windowSnapshot(window, object(state.v52Top2Telemetry)?.[window]));
    const currentNyDay = nyDay();
    const diagnostics = object(state.v52GateDiagnostics);
    const telemetry = object(state.v50Top2Telemetry);
    const diagnosticsNyDay = text(diagnostics?.nyDay ?? telemetry?.nyDay ?? state.nyDay);
    const stateNyDay = text(state.nyDay);
    const entriesNyDay = text(state.v50DailyEntriesDay);
    const signalNyDay = text(state.v50SignalSnapshotDay);
    const dailyDiagnosticsFresh = diagnosticsNyDay === currentNyDay
      && (!stateNyDay || stateNyDay === currentNyDay)
      && (!entriesNyDay || entriesNyDay === currentNyDay)
      && (!signalNyDay || signalNyDay === currentNyDay);
    const lastDecision = costDecision(diagnostics?.lastDecision ?? telemetry?.lastDecision);
    const rejectionCounters = Object.fromEntries(Object.entries(object(diagnostics?.rejectionCounters ?? telemetry?.rejectionCounters) || {}).flatMap(([key, value]) => {
      const parsed = finite(value);
      return parsed === undefined ? [] : [[key, parsed]];
    }));
    const telemetryState: V52Top2Observability["telemetryState"] = !dailyDiagnosticsFresh
      ? "STALE"
      : lastDecision || windows.some((window) => window.candidates.length || window.entries.length || window.rejections.length)
        ? "CURRENT_DAY"
        : "MISSING";
    const referenceHealth = await readReferenceHealth();
    const baseLive = updatedAt !== undefined && ageMs !== undefined && ageMs <= STALE_AFTER_MS && !killSwitchActive && dailyDiagnosticsFresh;
    const status = baseLive && (referenceHealth?.ready ?? true) ? "LIVE" : "STALE";
    const stateReferenceOrdersAllowed = bool(state.referenceOrdersAllowed);
    const referenceOrdersAllowed = stateReferenceOrdersAllowed === true && (referenceHealth?.ready ?? true);
    const reason = killSwitchActive
      ? "V52共有Kill Switchが有効です。"
      : referenceHealth && !referenceHealth.ready
        ? "V52発注Gate停止：" + referenceHealth.reason
      : !dailyDiagnosticsFresh
        ? `V52 daily diagnosticsが古い日付です（diagnostics=${diagnosticsNyDay || "未取得"} / current=${currentNyDay}）。`
      : updatedAt === undefined
        ? "V52 runner stateに更新時刻がありません。"
        : ageMs !== undefined && ageMs > STALE_AFTER_MS
          ? `${"V52 runner stateが" + Math.round(ageMs / 60000) + "分更新されていません。"}`
          : "V52 runner stateを読み取りました。";
    return {
      ok: status === "LIVE",
      readOnly: true,
      tradingMutation: 0,
      configured: true,
      status,
      capturedAt,
      updatedAt,
      mode: text(state.mode),
      reason,
      referenceHealth,
      referenceStatus: text(state.referenceStatus),
      referenceOrdersAllowed,
      killSwitchActive,
      killSwitchReason: text(killSwitch?.reason ?? state.killSwitchReason),
      activeV50Slots: positions.filter((position) => position.slot.startsWith("V50")).length,
      v50DailyEntries: finite(state.v50DailyEntries) || 0,
      currentNyDay,
      diagnosticsNyDay,
      dailyDiagnosticsFresh,
      telemetryState,
      thresholds,
      lastDecision,
      rejectionCounters,
      positions,
      windows,
      errors: [],
    };
  } catch (error) {
    return unavailable(capturedAt, true, error instanceof Error ? error.message : "V52 runner state を読み取れません。", thresholds, windowsNy);
  }
}
