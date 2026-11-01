import { readFile } from "node:fs/promises";

export const RUNNER_PIN_IDS = [
  "V12_V4",
  "PENGU_V8",
  "QUALITY102_CAUSAL_V1",
  "V52",
  "FET_BRK48_RESIDUAL",
  "HYPE_TREND_LONG",
  "IDLE_PRIORITY_SHORT",
  "SHARED_CRYPTO_RISK",
  "MARGIN_GUARD",
] as const;

export type RunnerPinId = typeof RUNNER_PIN_IDS[number];
export type RunnerEvidenceMode = "legacy-state-v1" | "tick-v1";

export type RunnerPin = {
  sha: string;
  releaseRoot: string;
  serviceUnit: string;
  evidenceMode: RunnerEvidenceMode;
  healthPath: string;
  tickPath: string;
  stopOwner: string;
};

export type RunnerPinManifest = {
  schema: "disdex-runner-pin-manifest/v2";
  target: "professional-dismanager.net";
  operatorTarget: "DD1296_FINAL_ALLIN_10BPS";
  runners: Record<RunnerPinId, RunnerPin>;
};

export const RUNNER_PIN_MANIFEST =
  process.env.DISDEX_RUNNER_PIN_MANIFEST_PATH?.trim()
  || "/etc/disdex/runner-pins.json";

const SHA_RE = /^[0-9a-f]{40}$/;
const ABS_VAR_LIB = /^\/var\/lib\/disdex\//;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("RUNNER_PIN_" + label + "_INVALID");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("RUNNER_PIN_" + label + "_INVALID");
  }
  return value.trim();
}

function parsePin(id: RunnerPinId, value: unknown): RunnerPin {
  const row = object(value, id);
  const sha = text(row.sha, id + "_SHA").toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error("RUNNER_PIN_" + id + "_SHA_INVALID");
  const releaseRoot = text(row.releaseRoot, id + "_RELEASE_ROOT");
  if (releaseRoot !== `/home/deploy/disdex-trading/releases/${sha}`) {
    throw new Error("RUNNER_PIN_" + id + "_RELEASE_ROOT_MISMATCH");
  }
  const serviceUnit = text(row.serviceUnit, id + "_SERVICE_UNIT");
  if (!serviceUnit.endsWith(`@${sha}.service`)) {
    throw new Error("RUNNER_PIN_" + id + "_SERVICE_UNIT_MISMATCH");
  }
  const evidenceMode = text(row.evidenceMode, id + "_EVIDENCE_MODE");
  if (evidenceMode !== "legacy-state-v1" && evidenceMode !== "tick-v1") {
    throw new Error("RUNNER_PIN_" + id + "_EVIDENCE_MODE_INVALID");
  }
  const healthPath = text(row.healthPath, id + "_HEALTH_PATH");
  const tickPath = text(row.tickPath, id + "_TICK_PATH");
  if (!ABS_VAR_LIB.test(healthPath) || !ABS_VAR_LIB.test(tickPath)) {
    throw new Error("RUNNER_PIN_" + id + "_EVIDENCE_PATH_INVALID");
  }
  const stopOwner = text(row.stopOwner, id + "_STOP_OWNER");
  const allowed = new Set(["sha","releaseRoot","serviceUnit","evidenceMode","healthPath","tickPath","stopOwner"]);
  for (const key of Object.keys(row)) if (!allowed.has(key)) {
    throw new Error("RUNNER_PIN_" + id + "_UNKNOWN_FIELD:" + key);
  }
  return { sha, releaseRoot, serviceUnit, evidenceMode, healthPath, tickPath, stopOwner };
}

export function parseRunnerPinManifest(value: unknown): RunnerPinManifest {
  const root = object(value, "MANIFEST");
  if (root.schema !== "disdex-runner-pin-manifest/v2") throw new Error("RUNNER_PIN_SCHEMA_INVALID");
  if (root.target !== "professional-dismanager.net") throw new Error("RUNNER_PIN_TARGET_INVALID");
  if (root.operatorTarget !== "DD1296_FINAL_ALLIN_10BPS") throw new Error("RUNNER_PIN_OPERATOR_TARGET_INVALID");

  const rawRunners = object(root.runners, "RUNNERS");
  const ids = Object.keys(rawRunners).sort();
  const expected = [...RUNNER_PIN_IDS].sort();
  if (JSON.stringify(ids) !== JSON.stringify(expected)) throw new Error("RUNNER_PIN_RUNNER_SET_MISMATCH");

  const runners = {} as Record<RunnerPinId, RunnerPin>;
  for (const id of RUNNER_PIN_IDS) runners[id] = parsePin(id, rawRunners[id]);

  const allowed = new Set(["schema","target","operatorTarget","runners"]);
  for (const key of Object.keys(root)) if (!allowed.has(key)) throw new Error("RUNNER_PIN_UNKNOWN_FIELD:" + key);

  return {
    schema: "disdex-runner-pin-manifest/v2",
    target: "professional-dismanager.net",
    operatorTarget: "DD1296_FINAL_ALLIN_10BPS",
    runners,
  };
}

export async function loadRunnerPinManifest(path = RUNNER_PIN_MANIFEST): Promise<RunnerPinManifest> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  return parseRunnerPinManifest(parsed);
}
