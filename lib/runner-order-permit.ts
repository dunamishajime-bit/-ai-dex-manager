import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

export const RUNNER_ORDER_PERMIT_SCHEMA = "disdex-runner-scoped-order-permit/v1" as const;
export const RUNNER_ORDER_PERMIT_POLICY = "STABLE4_SCOPED_HOLD_BYPASS" as const;
export const RUNNER_ORDER_PERMIT_OPERATOR = "disdex-runner-scoped-order-enable" as const;
export const RUNNER_ORDER_PERMIT_KILL_SWITCH_PATH = "/var/lib/disdex/shared/kill-switch.json" as const;
export const RUNNER_ORDER_PERMIT_ROOT = "/etc/disdex/runner-order-enable" as const;
export const RUNNER_ORDER_PERMIT_HOLD_OPERATOR = "disdex-stable4-formal-owner-hold" as const;
export const RUNNER_ORDER_PERMIT_HOLD_STRATEGY = "STABLE4_H48_CUTOVER" as const;
// The canonical GLOBAL HOLD is created for the reviewed STABLE4/H48 cutover
// source.  Runner permits bind to the HOLD bytes/digest below; they do not
// silently manufacture a per-Runner HOLD reason from their own source SHA.
export const RUNNER_ORDER_PERMIT_HOLD_REASON =
  "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f" as const;

export const RUNNER_ORDER_PERMIT_RUNNERS = [
  "V12_V4",
  "PENGU_V8",
  "QUALITY102_CAUSAL_V1",
  "V52",
  "FET_BRK48_RESIDUAL",
  "IDLE_PRIORITY_SHORT",
] as const;
export type RunnerOrderPermitRunner = (typeof RUNNER_ORDER_PERMIT_RUNNERS)[number];

export const RUNNER_ORDER_PERMIT_OPERATIONS = [
  "V12_V4_SCOPED_ORDER_ENABLE",
  "PENGU_V8_SCOPED_ORDER_ENABLE",
  "QUALITY102_CAUSAL_V1_SCOPED_ORDER_ENABLE",
  "V52_SCOPED_ORDER_ENABLE",
  "FET_BRK48_RESIDUAL_SCOPED_ORDER_ENABLE",
  "IDLE_PRIORITY_SHORT_SCOPED_ORDER_ENABLE",
] as const;
export type RunnerOrderPermitOperation = (typeof RUNNER_ORDER_PERMIT_OPERATIONS)[number];

export type RunnerOrderPermitScope = RunnerOrderPermitRunner;

export type RunnerOrderPermit = {
  // Runtime validation is deliberately stricter than this structural type.
  // Keeping mutable fields broad lets negative tests construct malformed
  // permits without relying on unsafe casts; validateRunnerOrderPermit is the
  // authority that narrows an unknown value to a trusted permit.
  schema: string;
  approvedSha: string;
  planSha256: string;
  deploymentTarget: string;
  operation: string;
  scope: string;
  runner: string;
  policy: string;
  ordersEnabled: boolean;
  killSwitchPath: string;
  killSwitchSha256: string;
  approvalId: string;
  approvalNonceSha256: string;
  issuedAt: number;
  expiresAt: number;
  operator: string;
  ordersSent: number;
  cancelsSent: number;
  positionChangesSent: number;
};

export type RunnerOrderPermitHold = {
  active: boolean;
  action?: "HOLD_PROTECTED" | "FLATTEN_MANAGED";
  scope?: "GLOBAL" | "V52_REFERENCE_ONLY";
  operator?: string;
  strategyId?: string;
  reason?: string;
};

export type RunnerOrderPermitValidationInput = {
  sourceSha: string;
  planSha256: string;
  runner: RunnerOrderPermitRunner;
  scope: RunnerOrderPermitScope;
  operation: RunnerOrderPermitOperation;
  approvalId: string;
  killSwitchSha256: string;
  now: number;
  killSwitch: RunnerOrderPermitHold;
};

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PERMIT_LIFETIME_MS = 30 * 86_400_000;

const PERMIT_KEYS = [
  "schema", "approvedSha", "planSha256", "deploymentTarget", "operation", "scope", "runner", "policy",
  "ordersEnabled", "killSwitchPath", "killSwitchSha256", "approvalId", "approvalNonceSha256", "issuedAt",
  "expiresAt", "operator", "ordersSent", "cancelsSent", "positionChangesSent",
] as const;

function fail(reason: string): never {
  throw new Error(`RUNNER_ORDER_PERMIT_INVALID:${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isRunner(value: unknown): value is RunnerOrderPermitRunner {
  return typeof value === "string" && (RUNNER_ORDER_PERMIT_RUNNERS as readonly string[]).includes(value);
}

function isOperation(value: unknown): value is RunnerOrderPermitOperation {
  return typeof value === "string" && (RUNNER_ORDER_PERMIT_OPERATIONS as readonly string[]).includes(value);
}

export function validateRunnerOrderPermit(
  value: unknown,
  input: RunnerOrderPermitValidationInput,
): RunnerOrderPermit {
  if (!isRecord(value) || !exactKeys(value, PERMIT_KEYS)) fail("FIELDS");
  if (!SHA.test(input.sourceSha) || !SHA.test(String(value.approvedSha)) || value.approvedSha !== input.sourceSha) fail("SOURCE_SHA");
  if (!SHA256.test(input.planSha256) || value.planSha256 !== input.planSha256) fail("PLAN_SHA256");
  if (!isRunner(input.runner) || !isRunner(value.runner) || value.runner !== input.runner) fail("RUNNER");
  if (!isRunner(input.scope) || value.scope !== input.scope || value.scope !== value.runner) fail("SCOPE");
  if (!isOperation(input.operation) || value.operation !== input.operation) fail("OPERATION");
  if (value.operation === "HYPE_STABLE4_H48_TIME_ONLY_LIVE" || value.scope === "FULL_PROJECT") fail("BROAD_SCOPE");
  const expectedOperation = `${input.runner}_SCOPED_ORDER_ENABLE`;
  if (value.operation !== expectedOperation) fail("RUNNER_OPERATION_BINDING");
  if (value.schema !== RUNNER_ORDER_PERMIT_SCHEMA
      || value.deploymentTarget !== "professional-dismanager.net"
      || value.policy !== RUNNER_ORDER_PERMIT_POLICY
      || value.ordersEnabled !== true
      || value.operator !== RUNNER_ORDER_PERMIT_OPERATOR) fail("IDENTITY");
  if (value.killSwitchPath !== RUNNER_ORDER_PERMIT_KILL_SWITCH_PATH
      || value.killSwitchSha256 !== input.killSwitchSha256
      || !SHA256.test(String(value.killSwitchSha256))) fail("KILL_SWITCH_BINDING");
  if (value.approvalId !== input.approvalId || !UUID.test(String(value.approvalId))) fail("APPROVAL_BINDING");
  if (!SHA256.test(String(value.approvalNonceSha256))) fail("NONCE_BINDING");
  const issuedAt = value.issuedAt;
  const expiresAt = value.expiresAt;
  if (!safeInteger(input.now) || input.now <= 0 || !safeInteger(issuedAt) || !safeInteger(expiresAt)) fail("TIME");
  if (issuedAt <= 0 || issuedAt > input.now || expiresAt <= input.now
      || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_PERMIT_LIFETIME_MS) fail("TIME");
  if (value.ordersSent !== 0 || value.cancelsSent !== 0 || value.positionChangesSent !== 0) fail("MUTATION_COUNTER");
  const hold = input.killSwitch;
  if (hold.active !== true || hold.action !== "HOLD_PROTECTED" || hold.scope !== "GLOBAL"
      || hold.operator !== RUNNER_ORDER_PERMIT_HOLD_OPERATOR
      || hold.strategyId !== RUNNER_ORDER_PERMIT_HOLD_STRATEGY
      || hold.reason !== RUNNER_ORDER_PERMIT_HOLD_REASON) fail("GLOBAL_HOLD");
  return Object.freeze({ ...value }) as RunnerOrderPermit;
}

export function runnerOrderPermitPath(runtimeSha: string, runner: RunnerOrderPermitRunner, root = RUNNER_ORDER_PERMIT_ROOT) {
  if (!SHA.test(runtimeSha) || !isRunner(runner)) fail("RUNTIME_IDENTITY");
  return `${root}/${runner}/${runtimeSha}.order-enable.json`;
}

export function runnerOrderPermitSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertImmutableMetadata(stats: { isFile(): boolean; isSymbolicLink(): boolean; uid?: number; gid?: number; mode?: number }) {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.uid !== 0 || stats.gid !== 0 || (Number(stats.mode) & 0o222) !== 0) {
    fail("PERMIT_METADATA");
  }
}

export async function readRunnerOrderPermit(input: {
  runtimeSha: string;
  runner: RunnerOrderPermitRunner;
  scope: RunnerOrderPermitScope;
  operation: RunnerOrderPermitOperation;
  planSha256: string;
  approvalId: string;
  permitPath?: string;
  killSwitchPath?: string;
  now?: number;
}): Promise<RunnerOrderPermit> {
  const now = input.now ?? Date.now();
  const permitPath = input.permitPath ?? runnerOrderPermitPath(input.runtimeSha, input.runner);
  const killPath = input.killSwitchPath ?? RUNNER_ORDER_PERMIT_KILL_SWITCH_PATH;
  const before = await lstat(permitPath);
  assertImmutableMetadata(before);
  const permitBytes = await readFile(permitPath);
  const killBytes = await readFile(killPath);
  const kill = JSON.parse(killBytes.toString("utf8")) as RunnerOrderPermitHold;
  const permit = validateRunnerOrderPermit(JSON.parse(permitBytes.toString("utf8")), {
    sourceSha: input.runtimeSha,
    planSha256: input.planSha256,
    runner: input.runner,
    scope: input.scope,
    operation: input.operation,
    approvalId: input.approvalId,
    killSwitchSha256: runnerOrderPermitSha256(killBytes),
    now,
    killSwitch: kill,
  });
  const after = await lstat(permitPath);
  assertImmutableMetadata(after);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || !(await readFile(permitPath)).equals(permitBytes)) fail("PERMIT_CHANGED");
  return permit;
}

export async function hasValidRunnerOrderPermit(input: {
  runtimeSha: string;
  runner: RunnerOrderPermitRunner;
  scope: RunnerOrderPermitScope;
  operation: RunnerOrderPermitOperation;
  planSha256: string;
  approvalId: string;
  permitPath?: string;
  killSwitchPath?: string;
  now?: number;
}) {
  try {
    await readRunnerOrderPermit(input);
    return true;
  } catch {
    return false;
  }
}
