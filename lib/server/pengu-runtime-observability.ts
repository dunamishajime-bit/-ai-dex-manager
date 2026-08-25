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

function unavailable(capturedAt: string, configured: boolean, reason: string): PenguRuntimeStatus {
  return { status: "UNAVAILABLE", configured, capturedAt, reason };
}

function configuredPath() {
  for (const name of [
    "PENGU_DUAL_LS_V2_STATE_PATH",
    "PENGU_DUAL_LS_V2_RUNNER_STATE_PATH",
    "PENGU_RUNTIME_STATE_PATH",
  ]) {
    const value = String(process.env[name] || "").trim();
    if (value) return { name, value };
  }
  return null;
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
    const killSwitchActive = killSwitch?.active === true || state.killSwitchActive === true;
    const updatedAt = number(state.updatedAt ?? state.lastHeartbeatAt ?? state.stateUpdatedAt ?? state.lastCycleAt ?? state.capturedAt);
    const ageMs = updatedAt === undefined ? undefined : Math.max(0, Date.now() - updatedAt);
    const mode = text(state.mode);
    const releaseSha = text(state.releaseSha ?? state.sourceSha ?? state.commitSha);
    if (updatedAt === undefined || ageMs === undefined) return { status: "STALE", configured: true, capturedAt, mode, killSwitchActive, releaseSha, reason: "PENGU runner stateに更新時刻がありません。" };
    if (killSwitchActive) return { status: "STALE", configured: true, capturedAt, updatedAt, mode, killSwitchActive, releaseSha, reason: "PENGU Kill Switchが有効です。" };
    if (ageMs > STALE_AFTER_MS) return { status: "STALE", configured: true, capturedAt, updatedAt, mode, killSwitchActive, releaseSha, reason: `PENGU runner stateが${Math.round(ageMs / 60000)}分更新されていません。` };
    if (mode && mode.toLowerCase() !== "live") return { status: "STALE", configured: true, capturedAt, updatedAt, mode, killSwitchActive, releaseSha, reason: `PENGU runner mode=${mode}のためLIVE確認にしません。` };
    return { status: "LIVE", configured: true, capturedAt, updatedAt, mode, killSwitchActive, releaseSha, reason: "PENGU runner stateの更新時刻と保護状態を確認しました。" };
  } catch (error) {
    return unavailable(capturedAt, true, error instanceof Error ? error.message : "PENGU runner stateを読み取れません。");
  }
}
