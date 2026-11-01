import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export const RUNNER_PIN_MANIFEST_PATH =
  process.env.DISDEX_RUNNER_PIN_MANIFEST_PATH || "/etc/disdex/runner-pins.json";

export const RUNNER_PIN_PREFIX = {
  V12_V4: "disdex-v12-v4",
  PENGU_V8: "disdex-pengu-dual-ls-v2",
  QUALITY102_CAUSAL_V1: "disdex-quality102-causal-v1",
  V52: "disdex-v52-aster-only",
  FET_BRK48_RESIDUAL: "disdex-fet-brk48",
  HYPE_TREND_LONG: "disdex-hype-long",
  IDLE_PRIORITY_SHORT: "disdex-idle-priority-short",
  SHARED_CRYPTO_RISK: "disdex-shared-crypto-risk",
  MARGIN_GUARD: "disdex-v12-v52-margin-guard",
} as const;

export type RunnerPinId = keyof typeof RUNNER_PIN_PREFIX;
export type RunnerEvidenceMode = "legacy" | "heartbeat_v1" | "tick_v1";

export type RunnerPin = {
  sha: string;
  releaseRoot: string;
  serviceUnit: string;
  evidenceMode: RunnerEvidenceMode;
  healthPath: string;
  tickPath: string;
};

export type RunnerPinManifest = {
  schema: "disdex-runner-pin-manifest/v2";
  target: "professional-dismanager.net";
  operatorTarget: "DD1296_FINAL_ALLIN_10BPS";
  sourceObservedAt?: number;
  runners: Record<RunnerPinId, RunnerPin>;
};

const SHA_RE = /^[0-9a-f]{40}$/;
const REQUIRED = Object.keys(RUNNER_PIN_PREFIX) as RunnerPinId[];

function canonicalAbsolute(value: string, root: string) {
  return value.startsWith(root + "/") && path.posix.normalize(value) === value && !value.includes("/../");
}

export function validateRunnerPinManifest(raw: unknown): RunnerPinManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("RUNNER_PIN_MANIFEST_NOT_OBJECT");
  const value = raw as Partial<RunnerPinManifest> & { runners?: Record<string, unknown> };
  if (value.schema !== "disdex-runner-pin-manifest/v2") throw new Error("RUNNER_PIN_MANIFEST_SCHEMA");
  if (value.target !== "professional-dismanager.net") throw new Error("RUNNER_PIN_MANIFEST_TARGET");
  if (value.operatorTarget !== "DD1296_FINAL_ALLIN_10BPS") throw new Error("RUNNER_PIN_MANIFEST_OPERATOR_TARGET");
  if (!value.runners || typeof value.runners !== "object" || Array.isArray(value.runners)) {
    throw new Error("RUNNER_PIN_MANIFEST_RUNNERS");
  }
  const keys = Object.keys(value.runners).sort();
  const required = [...REQUIRED].sort();
  if (JSON.stringify(keys) !== JSON.stringify(required)) throw new Error("RUNNER_PIN_MANIFEST_RUNNER_SET");

  const runners = {} as Record<RunnerPinId, RunnerPin>;
  for (const id of REQUIRED) {
    const pin = value.runners[id] as Partial<RunnerPin> | undefined;
    if (!pin || typeof pin !== "object") throw new Error(`RUNNER_PIN_MISSING:${id}`);
    const sha = String(pin.sha || "").trim().toLowerCase();
    if (!SHA_RE.test(sha)) throw new Error(`RUNNER_PIN_SHA:${id}`);
    const releaseRoot = String(pin.releaseRoot || "").trim();
    if (releaseRoot !== `/home/deploy/disdex-trading/releases/${sha}`) {
      throw new Error(`RUNNER_PIN_RELEASE_ROOT:${id}`);
    }
    const serviceUnit = String(pin.serviceUnit || "").trim();
    if (serviceUnit !== `${RUNNER_PIN_PREFIX[id]}@${sha}.service`) {
      throw new Error(`RUNNER_PIN_SERVICE:${id}`);
    }
    const evidenceMode = String(pin.evidenceMode || "") as RunnerEvidenceMode;
    if (!["legacy", "heartbeat_v1", "tick_v1"].includes(evidenceMode)) {
      throw new Error(`RUNNER_PIN_EVIDENCE_MODE:${id}`);
    }
    const healthPath = String(pin.healthPath || "").trim();
    const tickPath = String(pin.tickPath || "").trim();
    if (!canonicalAbsolute(healthPath, "/var/lib/disdex")) throw new Error(`RUNNER_PIN_HEALTH_PATH:${id}`);
    if (!canonicalAbsolute(tickPath, "/var/lib/disdex/runner-health/ticks")) throw new Error(`RUNNER_PIN_TICK_PATH:${id}`);
    runners[id] = { sha, releaseRoot, serviceUnit, evidenceMode, healthPath, tickPath };
  }
  return {
    schema: "disdex-runner-pin-manifest/v2",
    target: "professional-dismanager.net",
    operatorTarget: "DD1296_FINAL_ALLIN_10BPS",
    sourceObservedAt: Number.isFinite(Number(value.sourceObservedAt)) ? Number(value.sourceObservedAt) : undefined,
    runners,
  };
}

export async function loadRunnerPinManifest(
  filePath = RUNNER_PIN_MANIFEST_PATH,
  options: { requireRootOwned?: boolean } = {},
): Promise<RunnerPinManifest> {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("RUNNER_PIN_MANIFEST_UNSAFE_FILE");
  if (options.requireRootOwned !== false) {
    if (stats.uid !== 0 || (stats.mode & 0o022) !== 0) throw new Error("RUNNER_PIN_MANIFEST_UNTRUSTED_OWNER_MODE");
  }
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  return validateRunnerPinManifest(parsed);
}
