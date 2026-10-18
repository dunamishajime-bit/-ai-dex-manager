import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const EVIDENCE_KEYS = [
  "routeSourceParity",
  "establishedAsterOrders",
  "signedAsterAccount",
  "v4ExecutionTests",
  "sharedRiskAndPeers",
];
const SHA = /^[a-f0-9]{40}$/;
const EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function asRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`V4_EVIDENCE_CONTENT_INVALID:${label}`);
  return value;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`V4_EVIDENCE_FIELD_INVALID:${label}`);
  return number;
}

function assertMetadata(payload, key, sha, now) {
  if (payload.status !== "PASS") throw new Error(`V4_EVIDENCE_STATUS_NOT_PASS:${key}`);
  if (payload.candidateSha !== sha) throw new Error(`V4_EVIDENCE_CANDIDATE_SHA_MISMATCH:${key}`);
  const captured = Date.parse(String(payload.capturedAt || ""));
  if (!Number.isFinite(captured) || captured > now + 5 * 60_000 || now - captured > EVIDENCE_MAX_AGE_MS) {
    throw new Error(`V4_EVIDENCE_STALE:${key}`);
  }
}

export function validateEvidenceBundle({ sha, releaseMarker, payloads, now = Date.now() }) {
  if (!SHA.test(String(sha || ""))) throw new Error("V4_EVIDENCE_SHA_INVALID");
  if (String(releaseMarker || "").toLowerCase() !== sha) throw new Error("V4_EVIDENCE_RELEASE_MARKER_MISMATCH");
  for (const key of EVIDENCE_KEYS) assertMetadata(asRecord(payloads?.[key], key), key, sha, now);
  const route = asRecord(payloads.routeSourceParity, "routeSourceParity");
  if (finiteNumber(route.routeCount, "routeCount") !== 41 || route.sourceParity !== true) throw new Error("V4_EVIDENCE_ROUTE_PARITY_INVALID");
  const orders = asRecord(payloads.establishedAsterOrders, "establishedAsterOrders");
  if (orders.readOnly !== true || finiteNumber(orders.mutationCalls, "mutationCalls") !== 0) throw new Error("V4_EVIDENCE_MUTATION_OR_READONLY_INVALID:establishedAsterOrders");
  const account = asRecord(payloads.signedAsterAccount, "signedAsterAccount");
  if (account.readOnly !== true || account.signedGet !== true || finiteNumber(account.mutationCalls, "mutationCalls") !== 0) throw new Error("V4_EVIDENCE_MUTATION_OR_READONLY_INVALID:signedAsterAccount");
  const tests = asRecord(payloads.v4ExecutionTests, "v4ExecutionTests");
  if (finiteNumber(tests.testPasses, "testPasses") <= 0 || finiteNumber(tests.failCount, "failCount") !== 0 || tests.typecheck !== true) throw new Error("V4_EVIDENCE_TESTS_NOT_PASS");
  const risk = asRecord(payloads.sharedRiskAndPeers, "sharedRiskAndPeers");
  if (risk.sharedRiskHealthy !== true || risk.marginGuardHealthy !== true || risk.killSwitch !== false || finiteNumber(risk.pendingCount, "pendingCount") !== 0) throw new Error("V4_EVIDENCE_HEALTH_NOT_PASS");
  return {
    sha,
    routeCount: 41,
    mutationCalls: 0,
    evidenceCapturedAt: Math.max(...EVIDENCE_KEYS.map((key) => Date.parse(payloads[key].capturedAt))),
  };
}

export function validateRuntimeHealth({ sharedRisk, marginGuard, killSwitch, pendingExposure }) {
  if (sharedRisk?.sourceComplete !== true || sharedRisk?.tripped === true) throw new Error("V4_RUNTIME_SHARED_RISK_NOT_HEALTHY");
  if (marginGuard?.stage !== "HEALTHY" || marginGuard?.ordersAllowed !== true) throw new Error("V4_RUNTIME_MARGIN_GUARD_NOT_HEALTHY");
  if (killSwitch?.active === true) throw new Error("V4_RUNTIME_KILL_SWITCH_ACTIVE");
  if (finiteNumber(pendingExposure?.activeCount, "pendingExposure.activeCount") !== 0) throw new Error("V4_RUNTIME_PENDING_EXPOSURE_NOT_EMPTY");
  return true;
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function secureEvidenceFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) throw new Error(`V4_EVIDENCE_FILE_UNTRUSTED:${path}`);
  const data = await readFile(path);
  return { data, payload: JSON.parse(data.toString("utf8")), sha256: createHash("sha256").update(data).digest("hex") };
}

async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : fallback;
}

async function main() {
  const sha = argValue("--sha", "").toLowerCase();
  const releaseRoot = argValue("--release-root", `/home/deploy/disdex-trading/releases/${sha}`);
  const evidenceRoot = argValue("--evidence-root", "/etc/disdex/v12-v4-evidence");
  const output = argValue("--output", "/var/lib/disdex/v12-v4/evidence-preflight.json");
  if (!SHA.test(sha)) throw new Error("V4_EVIDENCE_SHA_INVALID");
  const resolvedRelease = await realpath(releaseRoot);
  if (resolve(resolvedRelease) !== resolve(releaseRoot) || !resolvedRelease.endsWith(`/${sha}`)) throw new Error("V4_EVIDENCE_RELEASE_ROOT_MISMATCH");
  const marker = (await readFile(join(resolvedRelease, ".disdex-release-sha"), "utf8")).trim().toLowerCase();
  const payloads = {};
  const evidenceSha256 = {};
  for (const key of EVIDENCE_KEYS) {
    const file = await secureEvidenceFile(join(evidenceRoot, `${key === "routeSourceParity" ? "route-source-parity" : key === "establishedAsterOrders" ? "established-aster-orders" : key === "signedAsterAccount" ? "signed-aster-account" : key === "v4ExecutionTests" ? "v4-execution-tests" : "shared-risk-and-peers"}.json`));
    payloads[key] = file.payload;
    evidenceSha256[key] = file.sha256;
  }
  const evidence = validateEvidenceBundle({ sha, releaseMarker: marker, payloads });
  const sharedRisk = await json(process.env.DISDEX_V4_PREFLIGHT_SHARED_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json");
  const marginGuard = await json(process.env.DISDEX_V4_PREFLIGHT_MARGIN_PATH || "/var/lib/disdex/shared/margin-risk/guard-live.json");
  const killSwitch = await json(process.env.DISDEX_V4_PREFLIGHT_KILL_SWITCH_PATH || "/var/lib/disdex/shared/kill-switch.json");
  const registry = await json(process.env.DISDEX_V4_PREFLIGHT_PENDING_PATH || "/var/lib/disdex/shared/pending-exposure.json");
  const pendingExposure = { activeCount: Array.isArray(registry?.entries) ? registry.entries.filter((entry) => entry?.status !== "RELEASED").length : NaN };
  validateRuntimeHealth({ sharedRisk, marginGuard, killSwitch, pendingExposure });
  const rateBudget = await json(process.env.DISDEX_V4_PREFLIGHT_RATE_BUDGET_PATH || "/var/lib/disdex/shared/aster-rate-budget.json");
  if (rateBudget?.schema !== "disdex-aster-rate-budget/v1" || !Number.isFinite(Number(rateBudget.nextAllowedAt))) throw new Error("V4_RUNTIME_RATE_BUDGET_INVALID");
  const result = {
    status: "V4_EVIDENCE_PREFLIGHT_PASS",
    checkedAt: Date.now(),
    releaseSha: sha,
    releaseRoot: resolvedRelease,
    evidenceSha256,
    evidence,
    health: { sharedRiskHealthy: true, marginGuardHealthy: true, killSwitch: false, pendingCount: 0 },
    rateBudget: { nextAllowedAt: Number(rateBudget.nextAllowedAt), lastPriority: rateBudget.lastPriority || null, lastRateLimitStatus: rateBudget.lastRateLimitStatus || null },
    readOnly: true,
    tradingEffects: { ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 },
  };
  await atomicJson(output, result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "V4_EVIDENCE_PREFLIGHT_BLOCKED", reason: String(error?.message || error), readOnly: true, tradingEffects: { ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 } }));
    process.exitCode = 1;
  });
}
