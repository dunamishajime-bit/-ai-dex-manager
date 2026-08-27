import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

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
  referenceStatus?: string;
  referenceOrdersAllowed?: boolean;
  killSwitchActive: boolean;
  killSwitchReason?: string;
  activeV50Slots: number;
  v50DailyEntries: number;
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

function unavailable(capturedAt: string, configured: boolean, error: string): V52Top2Observability {
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
    positions: [],
    windows: config.v52Top2Policy.windowsNy.map((window) => windowSnapshot(window, null)),
    errors: [error],
  };
}

export async function loadV52Top2Observability(): Promise<V52Top2Observability> {
  const capturedAt = new Date().toISOString();
  const configuredPath = String(process.env.V52_ASTER_ONLY_STATE_PATH || "").trim();
  if (!configuredPath) return unavailable(capturedAt, false, "V52_ASTER_ONLY_STATE_PATH がUIサービスに設定されていません。");
  if (!isAbsolute(configuredPath)) return unavailable(capturedAt, true, "V52_ASTER_ONLY_STATE_PATH は絶対パスで設定してください。");

  try {
    const content = await readFile(configuredPath, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) return unavailable(capturedAt, true, "V52 runner state が読み取り上限を超えています。");
    const state = object(JSON.parse(content));
    if (!state) return unavailable(capturedAt, true, "V52 runner state の形式が不正です。");

    const updatedAt = finite(state.updatedAt);
    const ageMs = updatedAt === undefined ? undefined : Math.max(0, Date.now() - updatedAt);
    const killSwitch = object(state.killSwitch);
    const killSwitchActive = Boolean(killSwitch?.active ?? state.killSwitchActive);
    const positionsObject = object(state.positions) || {};
    const positions = Object.entries(positionsObject).map(([slot, value]) => {
      const position = object(value) || {};
      return { slot, symbol: text(position.symbol), side: text(position.side), gross: finite(position.gross) };
    }).filter((position) => position.slot.startsWith("V50") || position.slot === "V11_EQ");
    const windows = config.v52Top2Policy.windowsNy.map((window) => windowSnapshot(window, object(state.v52Top2Telemetry)?.[window]));
    const status = updatedAt !== undefined && ageMs !== undefined && ageMs <= STALE_AFTER_MS && !killSwitchActive ? "LIVE" : "STALE";
    const reason = killSwitchActive
      ? "V52共有Kill Switchが有効です。"
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
      referenceStatus: text(state.referenceStatus),
      referenceOrdersAllowed: bool(state.referenceOrdersAllowed),
      killSwitchActive,
      killSwitchReason: text(killSwitch?.reason ?? state.killSwitchReason),
      activeV50Slots: positions.filter((position) => position.slot.startsWith("V50")).length,
      v50DailyEntries: finite(state.v50DailyEntries) || 0,
      positions,
      windows,
      errors: [],
    };
  } catch (error) {
    return unavailable(capturedAt, true, error instanceof Error ? error.message : "V52 runner state を読み取れません。");
  }
}
