import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

const DEFAULT_STATE_PATH = "/var/lib/disdex/fet-brk48-residual/state.json";
const MAX_JSON_BYTES = 256 * 1024;
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;

export type FetRuntimeStatus = {
  status: "LIVE" | "STALE" | "UNAVAILABLE";
  configured: boolean;
  capturedAt: string;
  updatedAt?: number;
  runtimeSha?: string;
  expectedReleaseSha: string;
  releaseShaVerified?: boolean;
  stateFresh?: boolean;
  strategyOk?: boolean;
  strategyId?: string;
  reason: string;
  errors: string[];
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timestamp(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function statePath() {
  return String(
    process.env.FET_BRK48_RESIDUAL_STATE_PATH
      || process.env.FET_BRK48_STATE_PATH
      || process.env.DISDEX_FET_BRK48_STATE_PATH
      || DEFAULT_STATE_PATH,
  ).trim();
}

function configuredExpectedReleaseSha(value?: string) {
  const configured = String(
    value
      || process.env.FET_BRK48_EXPECTED_RELEASE_SHA
      || process.env.DISDEX_FET_BRK48_EXPECTED_RELEASE_SHA
      || process.env.DISDEX_RUNTIME_RELEASE_SHA
      || process.env.DISDEX_RELEASE_SHA
      || "",
  ).trim().toLowerCase();
  return SHA_PATTERN.test(configured) ? configured : "";
}

function unavailable(capturedAt: string, expectedSha: string, reason: string, errors: string[] = []): FetRuntimeStatus {
  return {
    status: "UNAVAILABLE",
    configured: false,
    capturedAt,
    expectedReleaseSha: expectedSha,
    reason,
    errors,
  };
}

export async function loadFetRuntimeObservability(options: { now?: number; expectedReleaseSha?: string } = {}): Promise<FetRuntimeStatus> {
  const now = options.now ?? Date.now();
  const capturedAt = new Date(now).toISOString();
  const pathValue = statePath();
  const expectedSha = configuredExpectedReleaseSha(options.expectedReleaseSha);
  if (!pathValue || !isAbsolute(pathValue)) {
    return unavailable(capturedAt, expectedSha, "FET state pathが絶対パスで設定されていません。", ["FET_STATE_PATH_INVALID"]);
  }
  if (!expectedSha) {
    return unavailable(capturedAt, expectedSha, "FET runtime SHAを検証するProduction release SHAをUIへ渡せません。", ["FET_EXPECTED_RELEASE_SHA_UNCONFIGURED"]);
  }

  let state: JsonObject;
  try {
    const content = await readFile(pathValue, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_JSON_BYTES) throw new Error("FET stateが読み取り上限を超えています。");
    const parsed = object(JSON.parse(content));
    if (!parsed) throw new Error("FET stateの形式が不正です。");
    state = parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "FET stateを読み取れません。";
    return unavailable(capturedAt, expectedSha, message, [message]);
  }

  const updatedAt = timestamp(state.updatedAt);
  const runtimeSha = text(state.runtimeCommitSha)?.toLowerCase();
  const strategyId = text(state.strategyId);
  const failures = Array.isArray(state.failures) ? state.failures : [];
  const stateFresh = updatedAt !== undefined && updatedAt <= now + 60_000 && now - updatedAt <= STALE_AFTER_MS;
  const strategyOk = strategyId === "FET_BRK48_RESIDUAL" && failures.length === 0;
  const releaseShaVerified = Boolean(runtimeSha && SHA_PATTERN.test(runtimeSha) && runtimeSha === expectedSha);
  const errors: string[] = [];
  if (!stateFresh) errors.push("FET_STATE_STALE");
  if (!strategyOk) errors.push(failures.length ? "FET_STATE_FAILURES_PRESENT" : "FET_STRATEGY_ID_MISMATCH");
  if (!releaseShaVerified) errors.push("FET_RUNTIME_SHA_MISMATCH");

  const status: FetRuntimeStatus["status"] = stateFresh && strategyOk && releaseShaVerified ? "LIVE" : !stateFresh ? "STALE" : "UNAVAILABLE";
  const reason = status === "LIVE"
    ? "FET BRK48 runner state heartbeat更新済み、strategyId・runtime SHA・failureなしを確認しました。"
    : `FET runnerはLIVE確認条件未達です。${errors.join(" / ")}`;
  return {
    status,
    configured: true,
    capturedAt,
    updatedAt,
    runtimeSha,
    expectedReleaseSha: expectedSha,
    releaseShaVerified,
    stateFresh,
    strategyOk,
    strategyId,
    reason,
    errors,
  };
}
