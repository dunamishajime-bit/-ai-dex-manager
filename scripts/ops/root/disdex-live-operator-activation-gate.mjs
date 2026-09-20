import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const SCHEMA = "disdex-live-operator-activation/v1";
const ACK = "I_ACK_REAL_MONEY_LIVE_ACTIVATION";
const DEFAULT_PATH = "/var/lib/disdex/shared/operator-activation/current.json";

export const TRADING_RUNNERS = Object.freeze([
  "V12_X1_ALL",
  "PENGU_V8",
  "QUALITY102_CAUSAL_V1",
  "V52",
  "FET_BRK48_RESIDUAL",
]);

function exactSha(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SHA.test(normalized) ? normalized : undefined;
}

export function validateImplementationReadiness(readiness) {
  if (!readiness || readiness.schema !== "disdex-current-implementation-readiness/v1") {
    return { allowed: false, reason: "OPERATOR_GATE_READINESS_SCHEMA_INVALID" };
  }
  const implementationBlockers = (Array.isArray(readiness.blockers) ? readiness.blockers : [])
    .filter((value) => value !== "OPERATOR_LIVE_ACTIVATION_REQUIRED");
  if (readiness.implementationStatus !== "READY" || implementationBlockers.length > 0) {
    return {
      allowed: false,
      reason: `OPERATOR_GATE_IMPLEMENTATION_NOT_READY:${implementationBlockers.join(",") || readiness.implementationStatus || "UNKNOWN"}`,
    };
  }
  if (typeof readiness.target !== "string" || !readiness.target) {
    return { allowed: false, reason: "OPERATOR_GATE_TARGET_INVALID" };
  }
  return { allowed: true, target: readiness.target };
}

export function validateOperatorActivationArtifact(artifact, input) {
  if (!artifact || artifact.schema !== SCHEMA) {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_MISSING_OR_INVALID" };
  }
  const approvedSha = exactSha(artifact.approvedSha);
  if (!approvedSha || approvedSha !== input.sha) {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:SHA_MISMATCH" };
  }
  if (artifact.target !== input.target) {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:TARGET_MISMATCH" };
  }
  if (artifact.ordersEnabled !== true || artifact.operatorAcknowledgement !== ACK) {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:ACK_MISSING" };
  }
  if (!Array.isArray(artifact.approvedRunners) || !artifact.approvedRunners.includes(input.runner)) {
    return { allowed: false, reason: `OPERATOR_LIVE_ACTIVATION_REQUIRED:RUNNER_NOT_APPROVED:${input.runner}` };
  }
  const approvedAt = Date.parse(String(artifact.approvedAt || ""));
  if (!Number.isFinite(approvedAt) || approvedAt <= 0 || approvedAt > Date.now() + 300_000) {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:APPROVED_AT_INVALID" };
  }
  return { allowed: true, reason: "OPERATOR_LIVE_ACTIVATION_CONFIRMED", approvedAt };
}

export function validateOperatorActivationFileMetadata(stats) {
  if (!stats || typeof stats.isFile !== "function" || !stats.isFile() || stats.isSymbolicLink()) {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_NOT_REGULAR_FILE" };
  }
  if (Number(stats.uid) !== 0 || Number(stats.gid) !== 0) {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_NOT_ROOT_OWNED" };
  }
  if ((Number(stats.mode) & 0o022) !== 0) {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_WRITABLE_BY_NON_ROOT" };
  }
  return { allowed: true };
}

export function applyOperatorActivationGateToRestart(result, gate, runner, decisionFactory) {
  if (result.action !== "RESTART") return result;
  if (gate?.allowed === true) return result;
  if (typeof decisionFactory !== "function") {
    return {
      ...result,
      action: "HOLD_FAIL_CLOSED",
      reason: gate?.reason || "OPERATOR_LIVE_ACTIVATION_REQUIRED",
      operatorActivationBlocked: true,
    };
  }
  return decisionFactory(
    "HOLD_FAIL_CLOSED",
    gate?.reason || "OPERATOR_LIVE_ACTIVATION_REQUIRED",
    runner,
    { operatorActivationBlocked: true },
  );
}

export async function evaluateOperatorActivationGate(input) {
  const releaseRoot = resolve(String(input.releaseRoot || ""));
  const sha = exactSha(input.sha);
  const runner = String(input.runner || "");
  const activationPath = resolve(String(input.activationPath || DEFAULT_PATH));
  if (!sha) return { allowed: false, reason: "OPERATOR_GATE_SHA_INVALID" };
  if (!TRADING_RUNNERS.includes(runner)) return { allowed: false, reason: `OPERATOR_GATE_RUNNER_INVALID:${runner}` };

  let readiness;
  try {
    readiness = JSON.parse(await readFile(join(releaseRoot, "docs/production/current-implementation-readiness.json"), "utf8"));
  } catch {
    return { allowed: false, reason: "OPERATOR_GATE_READINESS_UNAVAILABLE" };
  }
  const implementation = validateImplementationReadiness(readiness);
  if (!implementation.allowed) return implementation;

  let stats;
  let artifact;
  try {
    stats = await lstat(activationPath);
    artifact = JSON.parse(await readFile(activationPath, "utf8"));
  } catch {
    return { allowed: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED:ARTIFACT_ABSENT" };
  }
  const metadata = validateOperatorActivationFileMetadata(stats);
  if (!metadata.allowed) return metadata;
  return validateOperatorActivationArtifact(artifact, {
    sha,
    target: implementation.target,
    runner,
  });
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function selfTest() {
  const sha = "a".repeat(40);
  const readiness = {
    schema: "disdex-current-implementation-readiness/v1",
    target: "target",
    implementationStatus: "READY",
    status: "BLOCKED",
    ordersEnabled: false,
    blockers: ["OPERATOR_LIVE_ACTIVATION_REQUIRED"],
  };
  const implementation = validateImplementationReadiness(readiness);
  if (!implementation.allowed) throw new Error("IMPLEMENTATION_READINESS_SELFTEST_FAILED");
  const artifact = {
    schema: SCHEMA,
    target: "target",
    approvedSha: sha,
    approvedRunners: ["V12_X1_ALL"],
    ordersEnabled: true,
    operatorAcknowledgement: ACK,
    approvedAt: new Date().toISOString(),
  };
  if (!validateOperatorActivationArtifact(artifact, { sha, target: "target", runner: "V12_X1_ALL" }).allowed) {
    throw new Error("OPERATOR_ARTIFACT_SELFTEST_FAILED");
  }
  if (validateOperatorActivationArtifact(artifact, { sha, target: "target", runner: "PENGU_V8" }).allowed) {
    throw new Error("RUNNER_SCOPE_SELFTEST_FAILED");
  }
  if (validateOperatorActivationArtifact({ ...artifact, approvedSha: "b".repeat(40) }, { sha, target: "target", runner: "V12_X1_ALL" }).allowed) {
    throw new Error("SHA_SCOPE_SELFTEST_FAILED");
  }
  console.log("DISDEX_LIVE_OPERATOR_ACTIVATION_GATE_SELFTEST_PASS");
}

async function cliMain() {
  const result = await evaluateOperatorActivationGate({
    releaseRoot: arg("--release-root"),
    sha: arg("--sha"),
    runner: arg("--runner"),
    activationPath: arg("--activation-path") || DEFAULT_PATH,
  });
  console.log(JSON.stringify({
    status: result.allowed ? "OPERATOR_ACTIVATION_READY" : "OPERATOR_ACTIVATION_BLOCKED",
    ...result,
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
  }));
  process.exitCode = result.allowed ? 0 : 2;
}

const mainUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === mainUrl) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    void cliMain().catch((error) => {
      console.error(JSON.stringify({
        status: "OPERATOR_ACTIVATION_BLOCKED",
        allowed: false,
        reason: error instanceof Error ? error.message : String(error),
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
      }));
      process.exitCode = 1;
    });
  }
}
