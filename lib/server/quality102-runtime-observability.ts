import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

type JsonObject = Record<string, unknown>;

const MAX_JSON_BYTES = 256 * 1024;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const DEFAULT_HEARTBEAT_PATH = "/var/lib/disdex/runner-health/heartbeats/quality102-causal-v1.json";

export const quality102Policy = Object.freeze({
  strategyGrossCap: 0.5,
  cryptoGrossCap: 2,
  totalGrossCap: 2.5,
  symbols: [
    "APTUSDT", "ARBUSDT", "ENAUSDT", "FILUSDT", "JUPUSDT", "ONDOUSDT", "OPUSDT",
    "RENDERUSDT", "SEIUSDT", "SUIUSDT", "TAOUSDT", "TIAUSDT", "TRXUSDT",
  ] as const,
});

type Quality102Position = {
  symbol?: string;
  side?: string;
  quantity?: number;
  gross?: number;
  entryPrice?: number;
};

export type Quality102RuntimeStatus = {
  ok: boolean;
  readOnly: true;
  tradingMutation: 0;
  configured: boolean;
  status: "LIVE" | "STALE" | "UNAVAILABLE";
  capturedAt: string;
  updatedAt?: number;
  stateUpdatedAt?: number;
  heartbeatUpdatedAt?: number;
  mode?: string;
  safetyState?: string;
  runtimeSha?: string;
  expectedReleaseSha?: string;
  releaseShaVerified?: boolean;
  selectorMode: string;
  historicalSelectorParity: boolean;
  brkLiveEnabled: boolean;
  caps: {
    strategyGrossCap: number;
    cryptoGrossCap: number;
    totalGrossCap: number;
  };
  symbols: string[];
  position?: Quality102Position;
  pending?: { phase?: string; symbol?: string; side?: string; reason?: string };
  reason: string;
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
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function readJson(pathValue: string, label: string): Promise<JsonObject> {
  const content = await readFile(pathValue, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) throw new Error(`${label}が読み取り上限を超えています。`);
  const parsed = object(JSON.parse(content));
  if (!parsed) throw new Error(`${label}の形式が不正です。`);
  return parsed;
}

function unavailable(capturedAt: string, configured: boolean, error: string): Quality102RuntimeStatus {
  return {
    ok: false,
    readOnly: true,
    tradingMutation: 0,
    configured,
    status: "UNAVAILABLE",
    capturedAt,
    selectorMode: "DERIVED_HIGH_VOL_ONLY",
    historicalSelectorParity: false,
    brkLiveEnabled: false,
    caps: {
      strategyGrossCap: quality102Policy.strategyGrossCap,
      cryptoGrossCap: quality102Policy.cryptoGrossCap,
      totalGrossCap: quality102Policy.totalGrossCap,
    },
    symbols: [...quality102Policy.symbols],
    reason: error,
    errors: [error],
  };
}

function position(value: unknown): Quality102Position | undefined {
  const row = object(value);
  if (!row) return undefined;
  return {
    symbol: text(row.symbol),
    side: text(row.side),
    quantity: finite(row.quantity ?? row.qty),
    gross: finite(row.gross),
    entryPrice: finite(row.entryPrice),
  };
}

function symbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [...quality102Policy.symbols];
  const result = value
    .map((item) => text(object(item)?.symbol ?? item))
    .filter((item): item is string => Boolean(item))
    .slice(0, quality102Policy.symbols.length);
  return result.length ? result : [...quality102Policy.symbols];
}

export async function loadQuality102RuntimeObservability(): Promise<Quality102RuntimeStatus> {
  const capturedAt = new Date().toISOString();
  const statePath = String(process.env.QUALITY102_CAUSAL_V1_STATE_PATH || "").trim();
  if (!statePath) return unavailable(capturedAt, false, "QUALITY102_CAUSAL_V1_STATE_PATH がUIサービスに設定されていません。");
  if (!isAbsolute(statePath)) return unavailable(capturedAt, true, "QUALITY102_CAUSAL_V1_STATE_PATH は絶対パスで設定してください。");

  try {
    const state = await readJson(statePath, "Quality102 state");
    const heartbeatPath = String(process.env.QUALITY102_CAUSAL_V1_HEARTBEAT_PATH || DEFAULT_HEARTBEAT_PATH).trim();
    let heartbeat: JsonObject | null = null;
    let heartbeatError: string | undefined;
    if (isAbsolute(heartbeatPath)) {
      try {
        heartbeat = await readJson(heartbeatPath, "Quality102 heartbeat");
      } catch (error) {
        heartbeatError = error instanceof Error ? error.message : "Quality102 heartbeatを読み取れません。";
      }
    }

    const stateUpdatedAt = finite(state.updatedAt);
    const heartbeatUpdatedAt = finite(heartbeat?.updatedAt ?? heartbeat?.heartbeatAt);
    const updatedAt = heartbeatUpdatedAt ?? stateUpdatedAt;
    const mode = text(heartbeat?.mode) ?? text(state.mode);
    const safetyState = text(heartbeat?.safetyState);
    const runtimeSha = text(heartbeat?.runtimeSha ?? state.runtimeCommitSha);
    const expectedReleaseSha = text(heartbeat?.expectedSha) ?? config.quality102Runtime.expectedReleaseSha;
    const selector = object(heartbeat?.quality102);
    const selectorMode = text(selector?.selectorMode) ?? "DERIVED_HIGH_VOL_ONLY";
    const historicalSelectorParity = bool(selector?.historicalSelectorParity) ?? false;
    const brkLiveEnabled = bool(selector?.brkLiveEnabled) ?? false;
    const killSwitchPath = String(process.env.QUALITY102_CAUSAL_V1_KILL_SWITCH_FILE || "").trim();
    let killSwitchActive = false;
    let killSwitchReason: string | undefined;
    if (killSwitchPath && isAbsolute(killSwitchPath)) {
      try {
        const killSwitch = await readJson(killSwitchPath, "Quality102 Kill Switch");
        killSwitchActive = killSwitch.active === true;
        killSwitchReason = text(killSwitch.reason);
      } catch {
        // A missing optional kill-switch file does not make the UI invent a stop;
        // the runner heartbeat/state remains the source of truth.
      }
    }

    const ageMs = updatedAt === undefined ? undefined : Math.max(0, Date.now() - updatedAt);
    const staleReason = updatedAt === undefined
      ? "Quality102 state/heartbeatに更新時刻がありません。"
      : ageMs !== undefined && ageMs > STALE_AFTER_MS
        ? `Quality102 state/heartbeatが${Math.round(ageMs / 60000)}分更新されていません。`
        : mode && mode.toUpperCase() !== "LIVE"
          ? `Quality102 runner mode=${mode}のためLIVE確認にしません。`
          : safetyState && safetyState.toUpperCase() !== "LIVE"
            ? `Quality102 safetyState=${safetyState}のためLIVE確認にしません。`
            : killSwitchActive
              ? `Quality102 Kill Switchが有効です。${killSwitchReason || ""}`.trim()
              : undefined;
    const status = staleReason ? "STALE" : "LIVE";
    const reason = status === "LIVE"
      ? `Quality102 ${selectorMode} heartbeatを確認しました。歴史selector parity=${historicalSelectorParity ? "true" : "false"}、BRK live=${brkLiveEnabled ? "true" : "false"}。`
      : staleReason!;

    const pendingObject = object(state.pending);
    return {
      ok: status === "LIVE",
      readOnly: true,
      tradingMutation: 0,
      configured: true,
      status,
      capturedAt,
      updatedAt,
      stateUpdatedAt,
      heartbeatUpdatedAt,
      mode,
      safetyState,
      runtimeSha,
      expectedReleaseSha,
      releaseShaVerified: runtimeSha ? runtimeSha === expectedReleaseSha : undefined,
      selectorMode,
      historicalSelectorParity,
      brkLiveEnabled,
      caps: {
        strategyGrossCap: finite(selector?.strategyGrossCap) ?? quality102Policy.strategyGrossCap,
        cryptoGrossCap: finite(selector?.cryptoGrossCap) ?? quality102Policy.cryptoGrossCap,
        totalGrossCap: finite(selector?.totalGrossCap) ?? quality102Policy.totalGrossCap,
      },
      symbols: symbols(heartbeat?.symbols),
      position: position(state.position ?? state.active),
      pending: pendingObject ? {
        phase: text(pendingObject.phase ?? pendingObject.action),
        symbol: text(pendingObject.symbol),
        side: text(pendingObject.side),
        reason: text(pendingObject.reason),
      } : undefined,
      reason: heartbeatError ? `${reason} heartbeat注意: ${heartbeatError}` : reason,
      errors: heartbeatError ? [heartbeatError] : [],
    };
  } catch (error) {
    return unavailable(capturedAt, true, error instanceof Error ? error.message : "Quality102 stateを読み取れません。");
  }
}
