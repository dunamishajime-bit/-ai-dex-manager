import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

type JsonObject = Record<string, unknown>;

const MAX_JSON_BYTES = 256 * 1024;
const DEFAULT_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type RunnerHeartbeatObservability = {
  status: "LIVE" | "STALE" | "UNAVAILABLE";
  runnerId?: string;
  runtimeSha?: string;
  expectedSha?: string;
  releaseShaVerified?: boolean;
  mode?: string;
  safetyState?: string;
  liveEnabled?: boolean;
  updatedAt?: number;
  runnerStatus?: string;
  reason: string;
};

export async function loadRunnerHeartbeatObservability(
  pathValue: string,
  expectedRunnerId: string,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
): Promise<RunnerHeartbeatObservability> {
  if (!pathValue || !isAbsolute(pathValue)) {
    return { status: "UNAVAILABLE", reason: "runner heartbeatの絶対パスが設定されていません。" };
  }

  try {
    const content = await readFile(pathValue, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) {
      return { status: "UNAVAILABLE", reason: "runner heartbeatが読み取り上限を超えています。" };
    }
    const heartbeat = object(JSON.parse(content));
    if (!heartbeat) return { status: "UNAVAILABLE", reason: "runner heartbeatの形式が不正です。" };

    const runnerId = text(heartbeat.runnerId);
    const runtimeSha = text(heartbeat.runtimeSha);
    const expectedSha = text(heartbeat.expectedSha);
    const releaseShaVerified = runtimeSha && expectedSha ? runtimeSha === expectedSha : undefined;
    const mode = text(heartbeat.mode);
    const safetyState = text(heartbeat.safetyState);
    const liveEnabled = typeof heartbeat.liveEnabled === "boolean" ? heartbeat.liveEnabled : undefined;
    const updatedAt = finite(heartbeat.updatedAt ?? heartbeat.heartbeatAt ?? heartbeat.lastTickAt);
    const runnerStatus = text(heartbeat.status ?? heartbeat.lastDecision);

    const staleReason = runnerId !== expectedRunnerId
      ? `runnerIdが不一致です（expected=${expectedRunnerId}, actual=${runnerId || "unknown"}）。`
      : updatedAt === undefined
        ? "runner heartbeatに更新時刻がありません。"
        : Math.max(0, now - updatedAt) > staleAfterMs
          ? "runner heartbeatが古いためLIVE確認にしません。"
          : mode?.toUpperCase() !== "LIVE" || liveEnabled !== true
            ? `runner mode=${mode || "unknown"} / liveEnabled=${String(liveEnabled)} のためLIVE確認にしません。`
            : safetyState?.toUpperCase() !== "HEALTHY"
              ? `runner safetyState=${safetyState || "unknown"} のためLIVE確認にしません。`
              : releaseShaVerified === false
                ? `runtime SHAとexpected SHAが不一致です（${runtimeSha} != ${expectedSha}）。`
                : undefined;

    return {
      status: staleReason ? "STALE" : "LIVE",
      runnerId,
      runtimeSha,
      expectedSha,
      releaseShaVerified,
      mode,
      safetyState,
      liveEnabled,
      updatedAt,
      runnerStatus,
      reason: staleReason || `runner heartbeatを確認しました（${runnerStatus || "正常"}）。`,
    };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      reason: error instanceof Error ? error.message : "runner heartbeatを読み取れません。",
    };
  }
}
