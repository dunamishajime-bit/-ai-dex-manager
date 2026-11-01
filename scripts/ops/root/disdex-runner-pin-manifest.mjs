import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RUNNER_PIN_MANIFEST_SCHEMA = "disdex-runner-pin-manifest/v2";

export const RUNNER_PIN_IDS = Object.freeze([
  "V12_V4",
  "PENGU_V8",
  "QUALITY102_CAUSAL_V1",
  "V52",
  "FET_BRK48_RESIDUAL",
  "HYPE_TREND_LONG",
  "IDLE_PRIORITY_SHORT",
  "SHARED_CRYPTO_RISK",
  "MARGIN_GUARD",
]);

const SERVICE_PREFIXES = Object.freeze({
  V12_V4: "disdex-v12-v4",
  PENGU_V8: "disdex-pengu-dual-ls-v2",
  QUALITY102_CAUSAL_V1: "disdex-quality102-causal-v1",
  V52: "disdex-v52-aster-only",
  FET_BRK48_RESIDUAL: "disdex-fet-brk48",
  HYPE_TREND_LONG: "disdex-hype-long",
  IDLE_PRIORITY_SHORT: "disdex-idle-priority-short",
  SHARED_CRYPTO_RISK: "disdex-shared-crypto-risk",
  MARGIN_GUARD: "disdex-v12-v52-margin-guard",
});

const STOP_OWNERS = new Set([
  "V4_PRIMARY",
  "Q102_PRIMARY",
  "PENGU_V8",
  "V52",
  "FET_BRK48_RESIDUAL",
  "HYPE_TREND_LONG",
  "IDLE_PRIORITY_SHORT",
  "SHARED_RISK",
  "MARGIN_GUARD",
]);

const EVIDENCE_MODES = new Set(["legacy", "tick-v1"]);
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const HEALTH_ROOT = "/var/lib/disdex/runner-health/heartbeats/";
const TICK_ROOT = "/var/lib/disdex/runner-health/ticks/";

function canonicalEvidencePath(value, root) {
  if (typeof value !== "string" || !value.startsWith(root) || value.includes("..") || value.includes("//")) return false;
  return value.length > root.length && value.endsWith(".json");
}

export function serviceUnitForPin(runnerId, sha) {
  if (!Object.hasOwn(SERVICE_PREFIXES, runnerId)) throw new Error("RUNNER_PIN_UNKNOWN");
  if (!SHA_PATTERN.test(String(sha || ""))) throw new Error("RUNNER_PIN_SHA_INVALID");
  return `${SERVICE_PREFIXES[runnerId]}@${String(sha).toLowerCase()}.service`;
}

function validationError(errors, runnerId, suffix) {
  errors.push(`${runnerId}_${suffix}`);
}

export function validateRunnerPinManifest(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["MANIFEST_NOT_OBJECT"] };
  }
  if (input.schema !== RUNNER_PIN_MANIFEST_SCHEMA) errors.push("SCHEMA_INVALID");
  if (typeof input.target !== "string" || !input.target.trim()) errors.push("TARGET_INVALID");
  if (!input.runners || typeof input.runners !== "object" || Array.isArray(input.runners)) {
    return { ok: false, errors: [...errors, "RUNNERS_INVALID"] };
  }

  for (const runnerId of RUNNER_PIN_IDS) {
    const record = input.runners[runnerId];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      validationError(errors, runnerId, "MISSING");
      continue;
    }
    const sha = String(record.sha || "").trim().toLowerCase();
    if (!SHA_PATTERN.test(sha)) validationError(errors, runnerId, "SHA_INVALID");
    if (typeof record.releaseRoot !== "string" || !record.releaseRoot.trim()) {
      validationError(errors, runnerId, "RELEASE_ROOT_INVALID");
    } else if (SHA_PATTERN.test(sha) && !record.releaseRoot.replaceAll("\\", "/").endsWith(`/${sha}`)) {
      validationError(errors, runnerId, "RELEASE_ROOT_SHA_MISMATCH");
    }
    if (!EVIDENCE_MODES.has(record.evidenceMode)) validationError(errors, runnerId, "EVIDENCE_MODE_INVALID");
    if (record.releaseRootSymlink === true) validationError(errors, runnerId, "RELEASE_ROOT_SYMLINK");
    if (!STOP_OWNERS.has(record.stopOwner)) validationError(errors, runnerId, "STOP_OWNER_INVALID");
    if (!canonicalEvidencePath(record.healthPath, HEALTH_ROOT)) validationError(errors, runnerId, "HEALTH_PATH_INVALID");
    if (!canonicalEvidencePath(record.tickPath, TICK_ROOT)) validationError(errors, runnerId, "TICK_PATH_INVALID");
    if (SHA_PATTERN.test(sha)) {
      const expectedUnit = serviceUnitForPin(runnerId, sha);
      if (record.serviceUnit !== expectedUnit) validationError(errors, runnerId, "SERVICE_UNIT_SHA_MISMATCH");
    }
  }

  for (const runnerId of Object.keys(input.runners)) {
    if (!RUNNER_PIN_IDS.includes(runnerId)) validationError(errors, runnerId, "UNKNOWN");
  }

  const healthOwners = new Map();
  const tickOwners = new Map();
  for (const runnerId of RUNNER_PIN_IDS) {
    const record = input.runners[runnerId];
    if (!record || typeof record !== "object") continue;
    if (typeof record.healthPath === "string") {
      const prior = healthOwners.get(record.healthPath);
      if (prior) {
        validationError(errors, runnerId, "HEALTH_PATH_DUPLICATE");
        validationError(errors, prior, "HEALTH_PATH_DUPLICATE");
      } else healthOwners.set(record.healthPath, runnerId);
    }
    if (typeof record.tickPath === "string") {
      const prior = tickOwners.get(record.tickPath);
      if (prior) {
        validationError(errors, runnerId, "TICK_PATH_DUPLICATE");
        validationError(errors, prior, "TICK_PATH_DUPLICATE");
      } else tickOwners.set(record.tickPath, runnerId);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const runners = Object.fromEntries(RUNNER_PIN_IDS.map((runnerId) => {
    const record = input.runners[runnerId];
    return [runnerId, { ...record, sha: record.sha.toLowerCase() }];
  }));
  return {
    ok: true,
    errors: [],
    manifest: {
      schema: RUNNER_PIN_MANIFEST_SCHEMA,
      target: input.target.trim(),
      runners,
      runnerIds: [...RUNNER_PIN_IDS],
    },
  };
}

export function getRunnerPin(manifest, runnerId) {
  if (!manifest || !RUNNER_PIN_IDS.includes(runnerId) || !manifest.runners?.[runnerId]) {
    throw new Error("RUNNER_PIN_UNKNOWN");
  }
  return manifest.runners[runnerId];
}

export async function loadRunnerPinManifestFromFile(path) {
  if (typeof path !== "string" || !path.trim()) throw new Error("RUNNER_PIN_MANIFEST_PATH_INVALID");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`RUNNER_PIN_MANIFEST_READ_FAILED:${error?.code || error?.name || "UNKNOWN"}`);
  }
  const result = validateRunnerPinManifest(parsed);
  if (!result.ok) throw new Error(`RUNNER_PIN_MANIFEST_INVALID:${result.errors.join(",")}`);
  return result.manifest;
}

export function loadRunnerPinManifestSyncFromFile(path) {
  if (typeof path !== "string" || !path.trim()) throw new Error("RUNNER_PIN_MANIFEST_PATH_INVALID");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`RUNNER_PIN_MANIFEST_READ_FAILED:${error?.code || error?.name || "UNKNOWN"}`);
  }
  const result = validateRunnerPinManifest(parsed);
  if (!result.ok) throw new Error(`RUNNER_PIN_MANIFEST_INVALID:${result.errors.join(",")}`);
  return result.manifest;
}

async function cliMain() {
  const mode = process.argv[2];
  const path = process.argv[3];
  if (mode !== "--validate" || !path) {
    console.error("usage: runner-pin-manifest --validate /absolute/path/runner-pins.json");
    process.exitCode = 2;
    return;
  }
  try {
    const manifest = await loadRunnerPinManifestFromFile(path);
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const mainUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (mainUrl === import.meta.url) {
  void cliMain();
}
