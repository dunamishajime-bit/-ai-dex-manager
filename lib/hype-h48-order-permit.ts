import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

export const HYPE_H48_ORDER_PERMIT_SCHEMA = "disdex-stable4-h48-hype-order-permit/v1" as const;
export const HYPE_H48_ORDER_PERMIT_OPERATION = "HYPE_STABLE4_H48_TIME_ONLY_LIVE" as const;
export const HYPE_H48_ORDER_PERMIT_SCOPE = "HYPE_TREND_LONG" as const;
export const HYPE_H48_ORDER_PERMIT_POLICY = "H48_TIME_ONLY" as const;
export const HYPE_H48_ORDER_PERMIT_OPERATOR = "disdex-stable4-h48-order-enable" as const;
export const HYPE_H48_GLOBAL_HOLD_OPERATOR = "disdex-stable4-formal-owner-hold" as const;
export const HYPE_H48_GLOBAL_HOLD_STRATEGY = "STABLE4_H48_CUTOVER" as const;
export const HYPE_H48_GLOBAL_HOLD_REASON =
  "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f" as const;
export const HYPE_H48_ORDER_PERMIT_DEFAULT_ROOT = "/etc/disdex/stable4/h48-time-only" as const;
export const HYPE_H48_GLOBAL_KILL_PATH = "/var/lib/disdex/shared/kill-switch.json" as const;

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PERMIT_LIFETIME_MS = 30 * 86_400_000;

export type HypeH48OrderPermit = {
  schema: typeof HYPE_H48_ORDER_PERMIT_SCHEMA;
  approvedSha: string;
  planSha256: string;
  deploymentTarget: "professional-dismanager.net";
  operation: typeof HYPE_H48_ORDER_PERMIT_OPERATION;
  scope: typeof HYPE_H48_ORDER_PERMIT_SCOPE;
  runner: typeof HYPE_H48_ORDER_PERMIT_SCOPE;
  policy: typeof HYPE_H48_ORDER_PERMIT_POLICY;
  ordersEnabled: true;
  killSwitchPath: string;
  killSwitchSha256: string;
  certificateSha256: string;
  approvalId: string;
  approvalNonceSha256: string;
  issuedAt: number;
  expiresAt: number;
  operator: typeof HYPE_H48_ORDER_PERMIT_OPERATOR;
  ordersSent: 0;
  cancelsSent: 0;
  positionChangesSent: 0;
};

export type HypeH48GlobalHold = {
  active: boolean;
  action?: "HOLD_PROTECTED" | "FLATTEN_MANAGED";
  scope?: "GLOBAL" | "V52_REFERENCE_ONLY";
  operator?: string;
  strategyId?: string;
  reason?: string;
};

export type HypeH48OrderPermitValidationInput = {
  sourceSha: string;
  planSha256: string;
  certificateSha256: string;
  killSwitchSha256: string;
  approvalId: string;
  now: number;
  killSwitch: HypeH48GlobalHold;
};

function fail(reason: string): never {
  throw new Error(`HYPE_H48_ORDER_PERMIT_INVALID:${reason}`);
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

const PERMIT_KEYS = [
  "schema", "approvedSha", "planSha256", "deploymentTarget", "operation", "scope", "runner", "policy",
  "ordersEnabled", "killSwitchPath", "killSwitchSha256", "certificateSha256", "approvalId",
  "approvalNonceSha256", "issuedAt", "expiresAt", "operator", "ordersSent", "cancelsSent",
  "positionChangesSent",
] as const;

export function validateHypeH48OrderPermit(
  value: unknown,
  input: HypeH48OrderPermitValidationInput,
): HypeH48OrderPermit {
  if (!isRecord(value) || !exactKeys(value, PERMIT_KEYS)) fail("FIELDS");
  if (!SHA.test(input.sourceSha) || !SHA.test(value.approvedSha as string) || value.approvedSha !== input.sourceSha) fail("SOURCE_SHA");
  if (!SHA256.test(input.planSha256) || value.planSha256 !== input.planSha256) fail("PLAN_SHA256");
  if (value.schema !== HYPE_H48_ORDER_PERMIT_SCHEMA
      || value.deploymentTarget !== "professional-dismanager.net"
      || value.operation !== HYPE_H48_ORDER_PERMIT_OPERATION
      || value.scope !== HYPE_H48_ORDER_PERMIT_SCOPE
      || value.runner !== HYPE_H48_ORDER_PERMIT_SCOPE
      || value.policy !== HYPE_H48_ORDER_PERMIT_POLICY
      || value.ordersEnabled !== true
      || value.operator !== HYPE_H48_ORDER_PERMIT_OPERATOR) fail("IDENTITY");
  if (typeof value.killSwitchPath !== "string" || value.killSwitchPath !== HYPE_H48_GLOBAL_KILL_PATH
      || value.killSwitchSha256 !== input.killSwitchSha256
      || !SHA256.test(String(value.killSwitchSha256))) fail("KILL_SWITCH_BINDING");
  if (value.certificateSha256 !== input.certificateSha256 || !SHA256.test(String(value.certificateSha256))) fail("CERTIFICATE_BINDING");
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
      || hold.operator !== HYPE_H48_GLOBAL_HOLD_OPERATOR || hold.strategyId !== HYPE_H48_GLOBAL_HOLD_STRATEGY
      || hold.reason !== HYPE_H48_GLOBAL_HOLD_REASON) fail("GLOBAL_HOLD");
  return Object.freeze({ ...value }) as HypeH48OrderPermit;
}

export function hypeH48OrderPermitPath(runtimeSha: string) {
  if (!SHA.test(runtimeSha)) fail("RUNTIME_SHA");
  return `${HYPE_H48_ORDER_PERMIT_DEFAULT_ROOT}/${runtimeSha}.order-enable.json`;
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertImmutableMetadata(stats: { isFile(): boolean; isSymbolicLink(): boolean; uid?: number; gid?: number; mode?: number }) {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.uid !== 0 || stats.gid !== 0 || (Number(stats.mode) & 0o222) !== 0) {
    fail("PERMIT_METADATA");
  }
}

/**
 * Read the Root-owned HYPE permit and bind it to the current canonical
 * GLOBAL HOLD. Invalid or missing permits throw so callers can fail closed.
 */
export async function readHypeH48OrderPermit(input: {
  runtimeSha: string;
  planSha256: string;
  approvalId: string;
  certificateSha256: string;
  permitPath?: string;
  killSwitchPath?: string;
  now?: number;
}): Promise<HypeH48OrderPermit> {
  const now = input.now ?? Date.now();
  const permitPath = input.permitPath ?? hypeH48OrderPermitPath(input.runtimeSha);
  const killPath = input.killSwitchPath ?? HYPE_H48_GLOBAL_KILL_PATH;
  const before = await lstat(permitPath);
  assertImmutableMetadata(before);
  const permitBytes = await readFile(permitPath);
  const killBytes = await readFile(killPath);
  const kill = JSON.parse(killBytes.toString("utf8")) as HypeH48GlobalHold;
  const permit = validateHypeH48OrderPermit(JSON.parse(permitBytes.toString("utf8")), {
    sourceSha: input.runtimeSha,
    planSha256: input.planSha256,
    certificateSha256: input.certificateSha256,
    killSwitchSha256: sha256Hex(killBytes),
    approvalId: input.approvalId,
    now,
    killSwitch: kill,
  });
  const after = await lstat(permitPath);
  assertImmutableMetadata(after);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || !(await readFile(permitPath)).equals(permitBytes)) fail("PERMIT_CHANGED");
  return permit;
}

/** Small helper used by the HYPE entry gate; it never throws into trading. */
export async function hasValidHypeH48OrderPermit(input: {
  runtimeSha: string;
  planSha256: string;
  certificateSha256: string;
  approvalId: string;
  permitPath?: string;
  killSwitchPath?: string;
  now?: number;
}) {
  try {
    const now = input.now ?? Date.now();
    const permitPath = input.permitPath ?? hypeH48OrderPermitPath(input.runtimeSha);
    const killPath = input.killSwitchPath ?? HYPE_H48_GLOBAL_KILL_PATH;
    const before = await lstat(permitPath);
    assertImmutableMetadata(before);
    const permitBytes = await readFile(permitPath);
    const killBytes = await readFile(killPath);
    const kill = JSON.parse(killBytes.toString("utf8")) as HypeH48GlobalHold;
    const value = JSON.parse(permitBytes.toString("utf8"));
    validateHypeH48OrderPermit(value, {
      sourceSha: input.runtimeSha,
      planSha256: input.planSha256,
      certificateSha256: input.certificateSha256,
      killSwitchSha256: sha256Hex(killBytes),
      approvalId: input.approvalId,
      now,
      killSwitch: kill,
    });
    const after = await lstat(permitPath);
    assertImmutableMetadata(after);
    return before.dev === after.dev && before.ino === after.ino && before.size === after.size
      && before.mtimeMs === after.mtimeMs && (await readFile(permitPath)).equals(permitBytes);
  } catch {
    return false;
  }
}

