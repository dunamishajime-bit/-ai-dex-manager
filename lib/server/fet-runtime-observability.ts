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
const DEFAULT_ASTER_BASE_URL = "https://fapi.asterdex.com";
const HOUR_MS = 3_600_000;
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
function configNumber(source: string, key: string): number | undefined {
  const match = source.match(new RegExp("\\b" + key + "\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)"));
  return match ? finite(match[1]) : undefined;
}
function median(values: number[]): number {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function nextDecisionAt(now: number, modulo: number, remainder: number): number {
  let hour = Math.ceil(now / HOUR_MS) * HOUR_MS;
  for (let i = 0; i < 48; i += 1) {
    if (new Date(hour).getUTCHours() % modulo === remainder) return hour;
    hour += HOUR_MS;
  }
  return hour;
}
async function readJson(path: string): Promise<Record<string, unknown>> {
  if (!isAbsolute(path)) throw new Error("FET_STATE_PATH_NOT_ABSOLUTE");
  const raw = await readFile(path);
  if (raw.byteLength > MAX_BYTES) throw new Error("FET_STATE_TOO_LARGE");
  const parsed = record(JSON.parse(raw.toString("utf8")));
  if (!parsed) throw new Error("FET_STATE_INVALID_JSON_OBJECT");
  return parsed;
}


type Kline = [number, string, string, string, string, string, number, ...unknown[]];

async function loadFetSignalDiagnostic(config: string): Promise<FetSignalDiagnostic> {
  const evaluatedAt = new Date().toISOString();
  const now = Date.now();
  const lookbackHours = configNumber(config, "lookbackHours") ?? 48;
  const volumeMedianHours = configNumber(config, "volumeMedianHours") ?? 72;
  const minimumVolumeRatio = configNumber(config, "minimumVolumeRatio") ?? 1.2;
  const holdHours = configNumber(config, "holdHours") ?? 24;
  const hardStopPct = configNumber(config, "hardStopPct") ?? 0.05;
  const profitFloorTriggerPct = configNumber(config, "profitFloorTriggerPct") ?? 0.05;
  const profitFloorStopPct = configNumber(config, "profitFloorStopPct") ?? 0.005;
  const decisionEntryHourModulo = configNumber(config, "decisionEntryHourModulo") ?? 4;
  const decisionEntryHourRemainder = configNumber(config, "decisionEntryHourRemainder") ?? 1;
  const liveEntryWindowMs = configNumber(config, "liveEntryWindowMs") ?? 5 * 60_000;
  const entryTs = Math.floor(now / HOUR_MS) * HOUR_MS;
  const entryHourUtc = new Date(entryTs).getUTCHours();
  const entryWindowOpen =
    entryHourUtc % decisionEntryHourModulo === decisionEntryHourRemainder
    && now - entryTs <= liveEntryWindowMs;
  const followingDecision = entryWindowOpen
    ? entryTs
    : nextDecisionAt(entryTs + HOUR_MS, decisionEntryHourModulo, decisionEntryHourRemainder);

  try {
    const baseUrl = String(process.env.ASTER_API_BASE_URL || process.env.ASTER_FUTURES_BASE_URL || DEFAULT_ASTER_BASE_URL).replace(/\/$/, "");
    const url = new URL(baseUrl + "/fapi/v3/klines");
    url.searchParams.set("symbol", "FETUSDT");
    url.searchParams.set("interval", "1h");
    url.searchParams.set("limit", "120");
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("ASTER_PUBLIC_KLINES_" + response.status);
    const rows = await response.json() as Kline[];
    const completed = rows
      .map((row) => ({
        openTs: Number(row[0]),
        closeTs: Number(row[6]),
        high: Number(row[2]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }))
      .filter((row) =>
        Number.isFinite(row.openTs) && Number.isFinite(row.closeTs)
        && Number.isFinite(row.high) && Number.isFinite(row.close) && Number.isFinite(row.volume)
        && row.openTs > 0 && row.closeTs > 0 && row.closeTs < entryTs
        && row.high > 0 && row.close > 0 && row.volume >= 0,
      )
      .sort((a, b) => a.openTs - b.openTs);

    const latest = completed.at(-1);
    const prior48 = completed.slice(-(lookbackHours + 1), -1);
    const prior72 = completed.slice(-(volumeMedianHours + 1), -1);
    if (!latest || prior48.length !== lookbackHours || prior72.length !== volumeMedianHours) {
      throw new Error("FET_PUBLIC_KLINES_HISTORY_INCOMPLETE");
    }

    const prior48hHigh = Math.max(...prior48.map((row) => row.high));
    const volumeMedian72h = median(prior72.map((row) => row.volume));
    const volumeRatio = volumeMedian72h > 0 ? latest.volume / volumeMedian72h : 0;
    const breakoutDistancePct = prior48hHigh > 0 ? latest.close / prior48hHigh - 1 : 0;
    const latestBarAligned = latest.openTs === entryTs - HOUR_MS;
    const breakoutPass = latestBarAligned && latest.close > prior48hHigh;
    const volumePass = latestBarAligned && volumeRatio + 1e-12 >= minimumVolumeRatio;
    const signalEligible = entryWindowOpen && breakoutPass && volumePass;
    const gates: FetGateDiagnostic[] = [
      {
        key: "ENTRY_WINDOW",
        label: "4時間エントリー窓",
        pass: entryWindowOpen,
        value: "UTC " + String(entryHourUtc).padStart(2, "0") + ":00 / " + Math.max(0, Math.round((now - entryTs) / 1000)) + "秒経過",
        threshold: "UTC hour % " + decisionEntryHourModulo + " = " + decisionEntryHourRemainder + " / " + Math.round(liveEntryWindowMs / 60_000) + "分以内",
        reason: entryWindowOpen ? "現在はFET判定・新規エントリー対象時間です。" : "現在は新規エントリー時間外です。",
      },
      {
        key: "BREAKOUT_48H",
        label: lookbackHours + "h High ブレイク",
        pass: breakoutPass,
        value: latest.close.toFixed(6) + " / High " + prior48hHigh.toFixed(6) + " (" + (breakoutDistancePct * 100).toFixed(2) + "%)",
        threshold: "直近確定1h Close > 過去" + lookbackHours + "h High",
        reason: !latestBarAligned ? "直近確定1h足が判定時刻と未整合です。" : breakoutPass ? "ブレイク条件を通過しています。" : "まだ過去Highを上抜けていません。",
      },
      {
        key: "VOLUME_72H",
        label: volumeMedianHours + "h Volume",
        pass: volumePass,
        value: volumeRatio.toFixed(3) + "x",
        threshold: "Volume / " + volumeMedianHours + "h中央値 ≥ " + minimumVolumeRatio.toFixed(2) + "x",
        reason: !latestBarAligned ? "直近確定1h足が判定時刻と未整合です。" : volumePass ? "出来高条件を通過しています。" : "必要出来高比に未到達です。",
      },
    ];

    return {
      available: true,
      evaluatedAt,
      referenceTs: latest.closeTs,
      entryTs,
      entryHourUtc,
      entryWindowOpen,
      nextDecisionAt: followingDecision,
      latestClose: latest.close,
      prior48hHigh,
      breakoutDistancePct,
      latestVolume: latest.volume,
      volumeMedian72h,
      volumeRatio,
      minimumVolumeRatio,
      lookbackHours,
      volumeMedianHours,
      holdHours,
      hardStopPct,
      profitFloorTriggerPct,
      profitFloorStopPct,
      decisionEntryHourModulo,
      decisionEntryHourRemainder,
      liveEntryWindowMs,
      signalEligible,
      signalReason: signalEligible
        ? "FET BRK48 LONGの時間・ブレイク・出来高Gateがすべて成立しています。"
        : gates.filter((gate) => !gate.pass).map((gate) => gate.label + "未成立").join(" / "),
      gates,
    };
  } catch (error) {
    return {
      available: false,
      evaluatedAt,
      entryTs,
      entryHourUtc,
      entryWindowOpen,
      nextDecisionAt: followingDecision,
      minimumVolumeRatio,
      lookbackHours,
      volumeMedianHours,
      holdHours,
      hardStopPct,
      profitFloorTriggerPct,
      profitFloorStopPct,
      decisionEntryHourModulo,
      decisionEntryHourRemainder,
      liveEntryWindowMs,
      signalEligible: false,
      signalReason: "FET公開market data判定を取得できません: " + (error instanceof Error ? error.message : String(error)),
      gates: [],
    };
  }
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
