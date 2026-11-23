import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const RUNNER_TICK_HEARTBEAT_SCHEMA = "disdex-runner-tick/v1" as const;
export const DEFAULT_RUNNER_TICK_HEARTBEAT_ROOT = "/var/lib/disdex/runner-health";

const TICK_FILES: Readonly<Record<string, string>> = Object.freeze({
  V12_V4: "v12-v4.json", V12_V4_MONITOR: "v12-v4-monitor.json",
  V12_X1_ALL: "v12-x1-all.json", PENGU_V8: "pengu-v8.json",
  QUALITY102_CAUSAL_V1: "quality102-causal-v1.json", V52: "v52.json",
  FET_BRK48_RESIDUAL: "fet-brk48-residual.json", HYPE_TREND_LONG: "hype-trend-long.json",
  IDLE_PRIORITY_SHORT: "idle-priority-short.json", SHARED_CRYPTO_RISK: "shared-crypto-risk.json",
  MARGIN_GUARD: "margin-guard.json",
});

export type RunnerTickHeartbeatInput = {
  root?: string;
  runnerId: string;
  runtimeSha: string;
  serviceUnit: string;
  tickStartedAt: number;
  tickCompletedAt: number;
  status: string;
  reason?: string;
  newOrdersAllowed: boolean;
  expectedSha?: string;
  mainPid?: number;
  workingDirectory?: string;
  ordersSent?: number;
  cancelsSent?: number;
  positionChangesSent?: number;
};

export type RunnerTickHeartbeat = Omit<
  RunnerTickHeartbeatInput,
  "root" | "expectedSha" | "mainPid" | "workingDirectory"
> & {
  schema: typeof RUNNER_TICK_HEARTBEAT_SCHEMA;
  expectedSha: string;
  mainPid: number;
  workingDirectory: string;
  outcome: string;
  reason: string;
};

function assertNonnegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`RUNNER_TICK_HEARTBEAT_${label}_INVALID`);
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`RUNNER_TICK_HEARTBEAT_${label}_INVALID`);
}

function assertSha(value: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value)) throw new Error("RUNNER_TICK_HEARTBEAT_SHA_INVALID");
}

function assertIdentity(input: RunnerTickHeartbeatInput) {
  if (typeof input.runnerId !== "string" || !/^[A-Za-z0-9_]+$/.test(input.runnerId)) throw new Error("RUNNER_TICK_HEARTBEAT_RUNNER_ID_INVALID");
  assertSha(input.runtimeSha);
  if (typeof input.serviceUnit !== "string" || input.serviceUnit !== input.serviceUnit.trim() || !input.serviceUnit.endsWith(`@${input.runtimeSha.toLowerCase()}.service`)) {
    throw new Error("RUNNER_TICK_HEARTBEAT_SERVICE_UNIT_INVALID");
  }
  if (typeof input.status !== "string" || !input.status.trim()) throw new Error("RUNNER_TICK_HEARTBEAT_STATUS_INVALID");
  if (typeof input.reason !== "undefined" && typeof input.reason !== "string") throw new Error("RUNNER_TICK_HEARTBEAT_REASON_INVALID");
  if (typeof input.newOrdersAllowed !== "boolean") throw new Error("RUNNER_TICK_HEARTBEAT_PERMISSION_INVALID");
  if (input.expectedSha !== undefined && input.expectedSha.toLowerCase() !== input.runtimeSha.toLowerCase()) {
    throw new Error("RUNNER_TICK_HEARTBEAT_EXPECTED_SHA_MISMATCH");
  }
  if (input.mainPid !== undefined) assertPositiveInteger(input.mainPid, "MAIN_PID");
  if (input.workingDirectory !== undefined && (typeof input.workingDirectory !== "string" || !input.workingDirectory.trim())) {
    throw new Error("RUNNER_TICK_HEARTBEAT_WORKING_DIRECTORY_INVALID");
  }
}

export function runnerTickHeartbeatPath(root: string, runnerId: string): string {
  if (!Object.prototype.hasOwnProperty.call(TICK_FILES, runnerId)) throw new Error("RUNNER_TICK_HEARTBEAT_RUNNER_ID_INVALID");
  return join(root, "ticks", TICK_FILES[runnerId]);
}

export function runnerTickHeartbeatTemporaryPath(path: string): string {
  return join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
}

async function renameMarkerWithRetry(temporary: string, path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, path);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (attempt >= 39 || !["EPERM", "EACCES", "EBUSY"].includes(code)) throw error;
      const delayMs = Math.min(100, 5 * (attempt + 1)) + Math.floor(Math.random() * 25);
      await new Promise<void>((done) => setTimeout(done, delayMs));
    }
  }
}

export async function writeRunnerTickHeartbeat(input: RunnerTickHeartbeatInput): Promise<RunnerTickHeartbeat> {
  assertIdentity(input);
  assertPositiveInteger(input.tickStartedAt, "STARTED_AT");
  assertPositiveInteger(input.tickCompletedAt, "COMPLETED_AT");
  if (input.tickCompletedAt < input.tickStartedAt) throw new Error("RUNNER_TICK_HEARTBEAT_TIME_ORDER_INVALID");
  if (input.ordersSent !== undefined) assertNonnegativeInteger(input.ordersSent, "ORDERS_SENT");
  if (input.cancelsSent !== undefined) assertNonnegativeInteger(input.cancelsSent, "CANCELS_SENT");
  if (input.positionChangesSent !== undefined) assertNonnegativeInteger(input.positionChangesSent, "POSITION_CHANGES_SENT");
  const runtimeSha = input.runtimeSha.toLowerCase();
  const workingDirectory = String(
    input.workingDirectory || process.env.DISDEX_RELEASE_ROOT || process.cwd(),
  ).trim();
  if (!workingDirectory) throw new Error("RUNNER_TICK_HEARTBEAT_WORKING_DIRECTORY_INVALID");
  const marker: RunnerTickHeartbeat = {
    schema: RUNNER_TICK_HEARTBEAT_SCHEMA,
    runnerId: input.runnerId,
    runtimeSha,
    expectedSha: runtimeSha,
    serviceUnit: input.serviceUnit,
    mainPid: input.mainPid ?? process.pid,
    workingDirectory,
    tickStartedAt: input.tickStartedAt,
    tickCompletedAt: input.tickCompletedAt,
    status: input.status.trim(),
    outcome: input.status.trim(),
    reason: input.reason || "",
    newOrdersAllowed: input.newOrdersAllowed,
    ...(input.ordersSent === undefined ? {} : { ordersSent: input.ordersSent }),
    ...(input.cancelsSent === undefined ? {} : { cancelsSent: input.cancelsSent }),
    ...(input.positionChangesSent === undefined ? {} : { positionChangesSent: input.positionChangesSent }),
  };
  const root = String(input.root || process.env.DISDEX_RUNNER_TICK_HEARTBEAT_ROOT || DEFAULT_RUNNER_TICK_HEARTBEAT_ROOT).trim();
  const path = runnerTickHeartbeatPath(root, input.runnerId);
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
  const temporary = runnerTickHeartbeatTemporaryPath(path);
  try {
    await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", mode: 0o640, flag: "wx" });
    await renameMarkerWithRetry(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return marker;
}
