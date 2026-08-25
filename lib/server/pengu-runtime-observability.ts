import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

const MAX_JSON_BYTES = 512 * 1024;
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type PenguRuntimeStatus = {
  status: "LIVE" | "STALE" | "UNAVAILABLE";
  configured: boolean;
  capturedAt: string;
  updatedAt?: number;
  mode?: string;
  killSwitchActive?: boolean;
  releaseSha?: string;
  reason: string;
  latestSignal?: PenguSignalObservability;
  executionTrace: PenguExecutionTrace;
  failures: Array<{ occurredAt?: number; message: string }>;
  position?: { side?: number; quantity?: number; gross?: number; entryPrice?: number };
  pending?: { phase?: string; side?: string; reduceOnly?: boolean; targetGross?: number; reason?: string };
};

export type PenguSignalObservability = {
  strategyId?: string;
  referenceTs?: number;
  entryTs?: number;
  side?: number;
  targetGross?: number;
  reason?: string;
  features: Record<string, number>;
  decision: {
    side?: number;
    longEligible?: boolean;
    shortEligible?: boolean;
    active?: boolean;
    reason?: string;
  };
  diagnostics: {
    evaluatedDecisionBars?: number;
    latestCompletedPenguTs?: number;
    latestCompletedBtcTs?: number;
    edgeTriggered?: boolean;
    longEligible?: boolean;
    shortEligible?: boolean;
    shortSetupActive?: boolean;
    shortSetupArmed?: boolean;
    cooldownBlocked?: boolean;
  };
};

export type PenguExecutionTrace = {
  currentStage: string;
  currentStageLabel: string;
  summary: string;
  nextAction: string;
  steps: Array<{ key: string; label: string; state: "pass" | "blocked" | "pending" | "unknown"; detail: string }>;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function number(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const FEATURE_KEYS = [
  "open", "high", "low", "close", "previousLow", "priorHigh18h", "penguReturn24h", "penguReturn72h",
  "btcReturn24h", "relativeReturn24h", "ema72", "ema168", "btcEma168Distance", "volumeRatio6OverPrior36",
  "atr24Ratio", "rsi14",
] as const;

function unavailableTrace(reason: string): PenguExecutionTrace {
  return {
    currentStage: "unavailable",
    currentStageLabel: "PENGU判定データ未取得",
    summary: reason,
    nextAction: "PENGU runnerの絶対パスと次回の確定1時間足を確認します。",
    steps: [{ key: "snapshot", label: "1. runner snapshot接続", state: "unknown", detail: reason }],
  };
}

function unavailable(capturedAt: string, configured: boolean, reason: string): PenguRuntimeStatus {
  return { status: "UNAVAILABLE", configured, capturedAt, reason, executionTrace: unavailableTrace(reason), failures: [] };
}

function configuredPath() {
  for (const name of [
    "PENGU_DUAL_LS_V2_DECISION_SNAPSHOT_PATH",
    "PENGU_DUAL_LS_V2_STATE_PATH",
    "PENGU_DUAL_LS_V2_RUNNER_STATE_PATH",
    "PENGU_RUNTIME_STATE_PATH",
  ]) {
    const value = String(process.env[name] || "").trim();
    if (value) return { name, value };
  }
  return null;
}

function killSwitchPath() {
  for (const name of [
    "DISDEX_SHARED_KILL_SWITCH_FILE",
    "DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE",
    "PENGU_DUAL_LS_V2_KILL_SWITCH_FILE",
  ]) {
    const value = String(process.env[name] || "").trim();
    if (value) return { name, value };
  }
  return null;
}

async function readKillSwitch() {
  const configured = killSwitchPath();
  if (!configured) return { configured: false, active: false, reason: undefined as string | undefined };
  if (!isAbsolute(configured.value)) throw new Error(`${configured.name}は絶対パスで設定してください。`);
  try {
    const parsed = object(JSON.parse(await readFile(configured.value, "utf8")));
    if (!parsed || typeof parsed.active !== "boolean") throw new Error("共有Kill Switchの形式が不正です。");
    return { configured: true, active: parsed.active, reason: text(parsed.reason) };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT") return { configured: true, active: false, reason: undefined };
    throw error;
  }
}

function finiteRecord(value: unknown) {
  const row = object(value);
  return Object.fromEntries(FEATURE_KEYS.flatMap((key) => {
    const parsed = number(row?.[key]);
    return parsed === undefined ? [] : [[key, parsed]];
  }));
}

function signalObservability(value: unknown): PenguSignalObservability | undefined {
  const row = object(value);
  if (!row) return undefined;
  const decision = object(row.decision) || {};
  const diagnostics = object(row.diagnostics) || {};
  return {
    strategyId: text(row.strategyId),
    referenceTs: number(row.referenceTs),
    entryTs: number(row.entryTs),
    side: number(row.side),
    targetGross: number(row.targetGross),
    reason: text(row.reason),
    features: finiteRecord(row.features),
    decision: {
      side: number(decision.side),
      longEligible: typeof decision.longEligible === "boolean" ? decision.longEligible : undefined,
      shortEligible: typeof decision.shortEligible === "boolean" ? decision.shortEligible : undefined,
      active: typeof decision.active === "boolean" ? decision.active : undefined,
      reason: text(decision.reason),
    },
    diagnostics: {
      evaluatedDecisionBars: number(diagnostics.evaluatedDecisionBars),
      latestCompletedPenguTs: number(diagnostics.latestCompletedPenguTs),
      latestCompletedBtcTs: number(diagnostics.latestCompletedBtcTs),
      edgeTriggered: typeof diagnostics.edgeTriggered === "boolean" ? diagnostics.edgeTriggered : undefined,
      longEligible: typeof diagnostics.longEligible === "boolean" ? diagnostics.longEligible : undefined,
      shortEligible: typeof diagnostics.shortEligible === "boolean" ? diagnostics.shortEligible : undefined,
      shortSetupActive: typeof diagnostics.shortSetupActive === "boolean" ? diagnostics.shortSetupActive : undefined,
      shortSetupArmed: typeof diagnostics.shortSetupArmed === "boolean" ? diagnostics.shortSetupArmed : undefined,
      cooldownBlocked: typeof diagnostics.cooldownBlocked === "boolean" ? diagnostics.cooldownBlocked : undefined,
    },
  };
}

function buildExecutionTrace(
  signal: PenguSignalObservability | undefined,
  killSwitchActive: boolean,
  killSwitchReason: string | undefined,
  position: PenguRuntimeStatus["position"],
  pending: PenguRuntimeStatus["pending"],
  failures: PenguRuntimeStatus["failures"],
): PenguExecutionTrace {
  if (!signal) return unavailableTrace("PENGU runnerのlatestSignalがありません。");
  const longEligible = signal.decision.longEligible === true;
  const shortEligible = signal.decision.shortEligible === true;
  const signalActive = signal.decision.active === true || signal.side === 1 || signal.side === -1;
  const steps: PenguExecutionTrace["steps"] = [
    { key: "completed-bar", label: "1. 確定1時間足", state: signal.referenceTs ? "pass" : "unknown", detail: signal.referenceTs ? `PENGU/BTC確定足 ${new Date(signal.referenceTs).toLocaleString("ja-JP")}` : "確定足時刻未取得" },
    { key: "direction", label: "2. Long / Short条件", state: signalActive ? "pass" : "blocked", detail: signal.reason || signal.decision.reason || "Long/Short条件未成立" },
    { key: "shared-risk", label: "3. 共有リスク / Kill Switch", state: killSwitchActive ? "blocked" : "pass", detail: killSwitchActive ? `停止中：${killSwitchReason || "共有Kill Switch"}` : "Kill Switch inactive / 共有リスクGate通過" },
    { key: "position", label: "4. 建玉・容量Gate", state: pending ? "pending" : position ? "pass" : "pass", detail: pending ? `${pending.phase || "ORDER"} ${pending.side || "—"}` : position ? `PENGU建玉あり side=${position.side ?? "—"} / exit・保護判定へ` : "PENGU建玉なし / 新規容量を確認" },
    { key: "entry-window", label: "5. 発注Window / 同一注文防止", state: signalActive && !pending ? "unknown" : signalActive ? "pending" : "blocked", detail: pending ? "pending orderの照合を優先" : signalActive ? "entryTs・最小Notional・account lock・idempotencyをrunnerで確認" : "発注Signal未成立のため注文Windowへ進まない" },
    { key: "execution", label: "6. 発注・約定照合", state: pending ? "pending" : "blocked", detail: pending ? "Aster注文の約定/拒否/取消照合待ち" : "注文未送信。自然シグナルと全Gate通過が必要" },
  ];
  const failureNote = failures.length ? ` / 直近失敗履歴${failures.length}件（最新：${failures[failures.length - 1]?.message || "—"}）` : "";
  if (!signalActive) return { currentStage: "signal-blocked", currentStageLabel: "条件不足・未発火", summary: `PENGUは確定1時間足を評価済みですが、Long=${longEligible ? "成立" : "未成立"} / Short=${shortEligible ? "成立" : "未成立"}のため発注していません。${failureNote}`, nextAction: "次の確定1時間足でLong/Short条件、BTC相対条件、volume・ATR・RSIを再評価します。", steps };
  if (pending) return { currentStage: "pending", currentStageLabel: "注文処理中", summary: "PENGU Signalは成立し、pending orderの照合段階です。", nextAction: "Asterの注文結果と建玉を照合します。", steps };
  return { currentStage: "signal-eligible", currentStageLabel: "Signal成立・注文Gate確認", summary: "PENGU Signalは成立しています。entry window・容量・共有lock・最小Notionalを通過した場合だけ発注します。", nextAction: "runnerの次回tickで注文GateとAster照合を確認します。", steps };
}

export async function loadPenguRuntimeObservability(): Promise<PenguRuntimeStatus> {
  const capturedAt = new Date().toISOString();
  const configured = configuredPath();
  if (!configured) return unavailable(capturedAt, false, "PENGU runner stateの絶対パスがUIサービスに設定されていません。");
  if (!isAbsolute(configured.value)) return unavailable(capturedAt, true, `${configured.name}は絶対パスで設定してください。`);
  try {
    const content = await readFile(configured.value, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) return unavailable(capturedAt, true, "PENGU runner stateが読み取り上限を超えています。");
    const state = object(JSON.parse(content));
    if (!state) return unavailable(capturedAt, true, "PENGU runner stateの形式が不正です。");
    const killSwitch = object(state.killSwitch);
    const sharedKillSwitch = await readKillSwitch();
    const killSwitchActive = killSwitch?.active === true || state.killSwitchActive === true || sharedKillSwitch.active;
    const updatedAt = number(state.updatedAt ?? state.lastHeartbeatAt ?? state.stateUpdatedAt ?? state.lastCycleAt ?? state.capturedAt);
    const ageMs = updatedAt === undefined ? undefined : Math.max(0, Date.now() - updatedAt);
    const mode = text(state.mode);
    const releaseSha = text(state.releaseSha ?? state.sourceSha ?? state.commitSha);
    const latestSignal = signalObservability(state.latestSignal);
    const positionObject = object(state.position);
    const pendingObject = object(state.pending);
    const position = positionObject ? { side: number(positionObject.side), quantity: number(positionObject.quantity), gross: number(positionObject.gross), entryPrice: number(positionObject.entryPrice) } : undefined;
    const pending = pendingObject ? { phase: text(pendingObject.phase), side: text(pendingObject.side), reduceOnly: pendingObject.reduceOnly === true, targetGross: number(pendingObject.targetGross), reason: text(pendingObject.reason) } : undefined;
    const failures = Array.isArray(state.failures) ? state.failures.slice(-8).map((failure) => {
      const item = object(failure) || {};
      return { occurredAt: number(item.occurredAt), message: text(item.message) || "PENGU runner failure" };
    }) : [];
    const executionTrace = buildExecutionTrace(latestSignal, killSwitchActive, sharedKillSwitch.reason || text(killSwitch?.reason), position, pending, failures);
    if (updatedAt === undefined || ageMs === undefined) return { status: "STALE", configured: true, capturedAt, mode, killSwitchActive, releaseSha, reason: "PENGU runner stateに更新時刻がありません。", latestSignal, executionTrace, failures, position, pending };
    if (killSwitchActive) return { status: "STALE", configured: true, capturedAt, updatedAt, mode, killSwitchActive, releaseSha, reason: `PENGU Kill Switchが有効です。${sharedKillSwitch.reason || ""}`.trim(), latestSignal, executionTrace, failures, position, pending };
    if (ageMs > STALE_AFTER_MS) return { status: "STALE", configured: true, capturedAt, updatedAt, mode, killSwitchActive, releaseSha, reason: `PENGU runner stateが${Math.round(ageMs / 60000)}分更新されていません。`, latestSignal, executionTrace, failures, position, pending };
    if (mode && mode.toLowerCase() !== "live") return { status: "STALE", configured: true, capturedAt, updatedAt, mode, killSwitchActive, releaseSha, reason: `PENGU runner mode=${mode}のためLIVE確認にしません。`, latestSignal, executionTrace, failures, position, pending };
    return { status: "LIVE", configured: true, capturedAt, updatedAt, mode, killSwitchActive, releaseSha, reason: `PENGU runner stateを確認しました。最新判定：${latestSignal?.reason || "未取得"}`, latestSignal, executionTrace, failures, position, pending };
  } catch (error) {
    return unavailable(capturedAt, true, error instanceof Error ? error.message : "PENGU runner stateを読み取れません。");
  }
}
