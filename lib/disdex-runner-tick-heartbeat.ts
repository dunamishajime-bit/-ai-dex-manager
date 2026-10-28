import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const RUNNER_TICK_HEARTBEAT_SCHEMA = "disdex-runner-tick-heartbeat/v1" as const;
export const DEFAULT_RUNNER_TICK_HEARTBEAT_ROOT = "/var/lib/disdex/runner-health";

export type RunnerTickHeartbeatInput = {
  root?: string;
  runnerId: string;
  runtimeSha: string;
  serviceUnit: string;
  tickStartedAt: number;
  tickCompletedAt: number;
  status: string;
  reason?: string;
  ordersSent: number;
  cancelsSent: number;
  positionChangesSent: number;
};

export type RunnerTickHeartbeat = Omit<RunnerTickHeartbeatInput, "root"> & {
  schema: typeof RUNNER_TICK_HEARTBEAT_SCHEMA;
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
}

export function runnerTickHeartbeatPath(root: string, runnerId: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(runnerId)) throw new Error("RUNNER_TICK_HEARTBEAT_RUNNER_ID_INVALID");
  return join(root, "ticks", `${runnerId}.json`);
}

export async function writeRunnerTickHeartbeat(input: RunnerTickHeartbeatInput): Promise<RunnerTickHeartbeat> {
  assertIdentity(input);
  assertPositiveInteger(input.tickStartedAt, "STARTED_AT");
  assertPositiveInteger(input.tickCompletedAt, "COMPLETED_AT");
  if (input.tickCompletedAt < input.tickStartedAt) throw new Error("RUNNER_TICK_HEARTBEAT_TIME_ORDER_INVALID");
  assertNonnegativeInteger(input.ordersSent, "ORDERS_SENT");
  assertNonnegativeInteger(input.cancelsSent, "CANCELS_SENT");
  assertNonnegativeInteger(input.positionChangesSent, "POSITION_CHANGES_SENT");
  const marker: RunnerTickHeartbeat = {
    schema: RUNNER_TICK_HEARTBEAT_SCHEMA,
    runnerId: input.runnerId,
    runtimeSha: input.runtimeSha.toLowerCase(),
    serviceUnit: input.serviceUnit,
    tickStartedAt: input.tickStartedAt,
    tickCompletedAt: input.tickCompletedAt,
    status: input.status,
    reason: input.reason || "",
    ordersSent: input.ordersSent,
    cancelsSent: input.cancelsSent,
    positionChangesSent: input.positionChangesSent,
  };
  const root = String(input.root || process.env.DISDEX_RUNNER_TICK_HEARTBEAT_ROOT || DEFAULT_RUNNER_TICK_HEARTBEAT_ROOT).trim();
  const path = runnerTickHeartbeatPath(root, input.runnerId);
  await mkdir(dirname(path), { recursive: true, mode: 0o750 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return marker;
}
