import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type FetGateDiagnostic = {
  key: "ENTRY_WINDOW" | "BREAKOUT_48H" | "VOLUME_72H";
  label: string;
  pass: boolean;
  value: string;
  threshold: string;
  reason: string;
};

export type FetSignalDiagnostic = {
  available: boolean;
  evaluatedAt: string;
  referenceTs?: number;
  entryTs?: number;
  entryHourUtc?: number;
  entryWindowOpen?: boolean;
  nextDecisionAt?: number;
  latestClose?: number;
  prior48hHigh?: number;
  breakoutDistancePct?: number;
  latestVolume?: number;
  volumeMedian72h?: number;
  volumeRatio?: number;
  minimumVolumeRatio?: number;
  lookbackHours?: number;
  volumeMedianHours?: number;
  holdHours?: number;
  hardStopPct?: number;
  profitFloorTriggerPct?: number;
  profitFloorStopPct?: number;
  decisionEntryHourModulo?: number;
  decisionEntryHourRemainder?: number;
  liveEntryWindowMs?: number;
  signalEligible?: boolean;
  signalReason: string;
  gates: FetGateDiagnostic[];
};

export type FetRuntimeStatus = {
  ok: boolean;
  readOnly: true;
  tradingMutation: 0;
  strategyId: "FET_BRK48_RESIDUAL";
  symbol: "FETUSDT";
  status: "LIVE" | "STALE" | "UNAVAILABLE" | "UNCONFIRMED";
  reason: string;
  checkedAt: string;
  updatedAt?: number;
  heartbeatAt?: number;
  serviceUnit?: string;
  heartbeatSafetyState?: string;
  lastReferenceTs?: number;
  lastReconciledAt?: number;
  expectedRuntimeSha?: string;
  runtimeCommitSha?: string;
  maximumGross?: number;
  killSwitchActive?: boolean;
  manualReview?: string;
  signal?: FetSignalDiagnostic;
  position?: {
    symbol: string;
    side: "LONG";
    quantity: number;
    entryPrice: number;
    gross: number;
    hardStop: number;
    entryTs: number;
    exitTs: number;
    stopOrderIdRecorded: boolean;
    protectionMode?: string;
    profitFloorArmedAt?: number;
    profitFloorTriggerPrice?: number;
  };
  pending?: {
    action: string;
    reason: string;
    targetGross?: number;
    updatedAt?: number;
  };
  warning?: string;
};

const STATE_SCHEMA = "fet-brk48-residual-state/v1";
const CURRENT_MARKER = "/home/deploy/disdex-trading/current/.disdex-release-sha";
const CURRENT_CONFIG = "/home/deploy/disdex-trading/current/config/fetBrk48Runtime.ts";
const DEFAULT_STATE = "/var/lib/disdex/fet-brk48-residual/state.json";
const DEFAULT_KILL_SWITCH = "/var/lib/disdex/shared/kill-switch.json";
const DEFAULT_HEARTBEAT = "/var/lib/disdex/runner-health/heartbeats/fet-brk48-residual.json";
const MAX_HEARTBEAT_AGE_MS = 10 * 60_000;
const MAX_BYTES = 512 * 1024;
const MAX_AGE_MS = 3 * 60_000;
const SHA_RE = /^[0-9a-f]{40}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
function finite(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function positive(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number > 0 ? number : undefined;
}
function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
async function readJson(path: string): Promise<Record<string, unknown>> {
  if (!isAbsolute(path)) throw new Error("FET_STATE_PATH_NOT_ABSOLUTE");
  const raw = await readFile(path);
  if (raw.byteLength > MAX_BYTES) throw new Error("FET_STATE_TOO_LARGE");
  const parsed = record(JSON.parse(raw.toString("utf8")));
  if (!parsed) throw new Error("FET_STATE_INVALID_JSON_OBJECT");
  return parsed;
}

/** Reads only VPS production artifacts. Never imports or executes the trading runner. */
export async function loadFetRuntimeObservability(): Promise<FetRuntimeStatus> {
  const checkedAt = new Date().toISOString();
  const base: FetRuntimeStatus = {
    ok: false, readOnly: true, tradingMutation: 0,
    strategyId: "FET_BRK48_RESIDUAL", symbol: "FETUSDT",
    status: "UNAVAILABLE", reason: "FET実stateを取得できません。", checkedAt,
  };
  try {
    const configured = String(process.env.FET_BRK48_STATE_PATH || DEFAULT_STATE).trim();
    const killSwitchPath = String(process.env.DISDEX_KILL_SWITCH_PATH || DEFAULT_KILL_SWITCH).trim();
    const heartbeatPath = String(process.env.FET_BRK48_HEARTBEAT_PATH || DEFAULT_HEARTBEAT).trim();
    const [marker, state, killSwitch, config, heartbeat] = await Promise.all([
      readFile(CURRENT_MARKER, "utf8"),
      readJson(configured),
      readJson(killSwitchPath),
      readFile(CURRENT_CONFIG, "utf8"),
      readJson(heartbeatPath).catch(() => null),
    ]);
    const expectedRuntimeSha = marker.trim();
    const runtimeCommitSha = nonEmpty(state.runtimeCommitSha);
    const updatedAt = positive(state.updatedAt);
    const maximumGrossMatch = config.match(/\bmaximumGross\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
    const maximumGross = maximumGrossMatch ? positive(maximumGrossMatch[1]) : undefined;
    const positionState = record(state.position);
    const pendingState = record(state.pending);
    const manualReview = nonEmpty(state.manualReview);
    const lastReferenceTs = positive(state.lastReferenceTs);
    const lastReconciledAt = positive(state.lastReconciledAt);
    const killSwitchActive = killSwitch.active === true ? true : killSwitch.active === false ? false : undefined;
    const heartbeatAt = positive(heartbeat?.heartbeatAt);
    const serviceUnit = nonEmpty(heartbeat?.serviceUnit);
    const heartbeatSafetyState = nonEmpty(heartbeat?.safetyState);
    const common: FetRuntimeStatus = {
      ...base, expectedRuntimeSha, runtimeCommitSha, updatedAt, maximumGross,
      lastReferenceTs, lastReconciledAt, manualReview, killSwitchActive,
      heartbeatAt, serviceUnit, heartbeatSafetyState,
    };

    if (state.schema !== STATE_SCHEMA || state.strategyId !== "FET_BRK48_RESIDUAL") {
      return { ...common, reason: "FET stateのschemaまたはstrategyIdが一致しません。" };
    }
    if (!SHA_RE.test(expectedRuntimeSha) || !runtimeCommitSha || !SHA_RE.test(runtimeCommitSha)) {
      return { ...common, reason: "本番SHAまたはFET state SHAが不正です。" };
    }
    if (runtimeCommitSha !== expectedRuntimeSha) {
      return { ...common, reason: "FET state SHAが現在の本番SHAと一致しません。" };
    }
    if (!updatedAt || updatedAt > Date.now() + 60_000) {
      return { ...common, reason: "FET stateの更新時刻が不正です。" };
    }
    if (!maximumGross) {
      return { ...common, status: "UNCONFIRMED", reason: "現在の本番FET Gross設定を取得できません。" };
    }
    let position: FetRuntimeStatus["position"];
    if (positionState) {
      const quantity = positive(positionState.quantity);
      const entryPrice = positive(positionState.entryPrice);
      const gross = positive(positionState.gross);
      const hardStop = positive(positionState.hardStop);
      const entryTs = positive(positionState.entryTs);
      const exitTs = positive(positionState.exitTs);
      if (positionState.symbol !== "FETUSDT" || positionState.side !== 1 ||
          !quantity || !entryPrice || !gross || !hardStop || !entryTs ||
          !exitTs || exitTs <= entryTs) {
        return { ...common, reason: "FET建玉stateの形式が不正です。" };
      }
      position = {
        symbol: "FETUSDT", side: "LONG", quantity, entryPrice, gross, hardStop,
        entryTs, exitTs,
        stopOrderIdRecorded: Boolean(nonEmpty(positionState.stopClientOrderId)),
      };
    }
    const pending = pendingState ? {
      action: nonEmpty(pendingState.action) || "UNKNOWN",
      reason: nonEmpty(pendingState.reason) || "PENDING",
      targetGross: positive(pendingState.targetGross),
      updatedAt: positive(pendingState.updatedAt),
    } : undefined;
    const complete = { ...common, position, pending };
    if (Date.now() - updatedAt > MAX_AGE_MS) {
      return { ...complete, status: "STALE" as const, reason: "FET runner stateの更新が3分以上ありません。" };
    }
    if (position && !position.stopOrderIdRecorded) {
      return { ...complete, status: "UNCONFIRMED", reason: "FET保有stateに保護STOP注文IDがありません。" };
    }
    if (killSwitchActive !== false || manualReview || pending) {
      return {
        ...complete, status: "UNCONFIRMED" as const,
        reason: manualReview ? "FET operator確認が必要です: " + manualReview
          : pending ? "FETに未解決のpending注文があります。"
          : "共有Kill Switchが有効か状態を確認できません。",
      };
    }
    if (!heartbeat || heartbeat.schema !== "disdex-runner-heartbeat/v1" ||
        heartbeat.runnerId !== "FET_BRK48_RESIDUAL" ||
        heartbeat.runtimeSha !== expectedRuntimeSha || heartbeat.expectedSha !== expectedRuntimeSha ||
        heartbeat.mode !== "LIVE" || heartbeat.liveEnabled !== true ||
        heartbeatSafetyState !== "HEALTHY" || !heartbeatAt ||
        heartbeatAt > Date.now() + 60_000 || Date.now() - heartbeatAt > MAX_HEARTBEAT_AGE_MS) {
      return { ...complete, status: "UNCONFIRMED", reason: "FET systemd identity / runner-health heartbeatが未取得・不一致・古い、またはBLOCKEDです。" };
    }
    return {
      ...complete, ok: true, status: "LIVE",
      reason: "本番SHA・最新state・runner-health HEALTHY（service identity確認済み）・Kill Switch inactive。",
      warning: "Aster実建玉と保護注文reduceOnlyのread-back、およびNRestarts=0の検証は別途必要です。",
    };
  } catch (error) {
    return { ...base, reason: "FET観測ファイルを読み取れません: " + (error instanceof Error ? error.message : String(error)) };
  }
}
