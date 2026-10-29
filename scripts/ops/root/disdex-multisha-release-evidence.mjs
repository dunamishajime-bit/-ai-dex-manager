import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const SCHEMA = "disdex-multisha-release-evidence/v1";
const TARGET = "professional-dismanager.net";
const REQUIRED_FILES = [
  "scripts/ops/root/disdex-runner-pin-manifest.mjs",
  "scripts/ops/root/disdex-current-runtime-wiring",
  "scripts/ops/root/disdex-runner-health-snapshot-current.mjs",
  "scripts/ops/root/disdex-runner-watchdog-current.mjs",
  "scripts/ops/root/disdex-runner-health-alert.ts",
  "scripts/ops/root/disdex-live-operator-activation-gate.mjs",
  "scripts/ops/root/disdex-risk-api-final-preflight-20261028.py",
  "lib/disdex-account-order-lock.ts",
  "lib/disdex-pending-exposure-registry.ts",
  "lib/disdex-integrated-gross-governor.ts",
  "lib/disdex-strict-portfolio-planner.ts",
  "docs/production/current-live-target.json",
];

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function gitSha(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "UNKNOWN";
  }
}

async function releaseMarker(root) {
  const path = process.env.DISDEX_RELEASE_MARKER_PATH || join(root, ".disdex-release-sha");
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) return { status: "INVALID", path, value: null };
    const value = (await readFile(path, "utf8")).trim();
    return { status: /^[0-9a-f]{40}$/.test(value) ? "PRESENT" : "INVALID", path, value: /^[0-9a-f]{40}$/.test(value) ? value : null };
  } catch (error) {
    return { status: error?.code === "ENOENT" ? "MISSING" : "UNAVAILABLE", path, value: null };
  }
}

export async function collectReleaseEvidence(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  const files = {};
  const missingFiles = [];
  for (const relativePath of REQUIRED_FILES) {
    const path = join(absoluteRoot, relativePath);
    try {
      files[relativePath] = await sha256(path);
    } catch {
      missingFiles.push(relativePath);
    }
  }
  const marker = await releaseMarker(absoluteRoot);
  const blockers = [
    "OPERATOR_LIVE_ACTIVATION_REQUIRED",
    "BLOCKED_NATIVE_HISTORY",
    "BLOCKED_VENUE_EVIDENCE",
  ];
  if (missingFiles.length > 0) blockers.push("RELEASE_SOURCE_FILES_MISSING");
  if (marker.status !== "PRESENT") blockers.push("RELEASE_MARKER_NOT_PRESENT_IN_SOURCE_CHECKOUT");
  return {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    target: TARGET,
    source: {
      root: absoluteRoot,
      gitSha: gitSha(absoluteRoot),
      files,
      missingFiles,
      releaseMarker: marker,
    },
    runnerPins: {
      status: "SOURCE_VALIDATED_NOT_LIVE",
      approvalScope: "runner-specific SHA map required; no common SHA fallback",
    },
    safety: {
      readOnly: true,
      ordersSent: 0,
      cancelSent: 0,
      positionChangesSent: 0,
      dynamicGrossAllocationEnabled: false,
      dailyLossLimitPct: 7.5,
      liveActivationGranted: false,
    },
    externalEvidence: {
      operator: { status: "BLOCKED_OPERATOR_AUTH", approvedSha: null, approvedRunners: [], approvedAt: null },
      nativeHistory: { status: "BLOCKED_NATIVE_HISTORY", venue: "Aster", requestedPeriod: "2025-08-10..2026-08-10", substituteDataUsed: false },
      venue: { status: "BLOCKED_VENUE_EVIDENCE", signedReadOnlyGetVerified: false, positionOrderStopReconciliation: false },
      postCutoverAudits: { requiredCycles: 3, completedCycles: 0 },
    },
    classification: "SOURCE_READY_NOT_LIVE",
    blockers,
  };
}

async function main() {
  const evidence = await collectReleaseEvidence(process.env.DISDEX_RELEASE_ROOT || process.cwd());
  if (process.argv.includes("--self-test")) {
    if (evidence.schema !== SCHEMA || evidence.safety.ordersSent !== 0 || evidence.safety.liveActivationGranted !== false) throw new Error("DISDEX_MULTISHA_RELEASE_EVIDENCE_SELFTEST_FAILED");
    if (!evidence.blockers.includes("OPERATOR_LIVE_ACTIVATION_REQUIRED") || !evidence.blockers.includes("BLOCKED_NATIVE_HISTORY") || !evidence.blockers.includes("BLOCKED_VENUE_EVIDENCE")) throw new Error("DISDEX_MULTISHA_RELEASE_EVIDENCE_BLOCKERS_MISSING");
    console.log("DISDEX_MULTISHA_RELEASE_EVIDENCE_SELFTEST_PASS");
    return;
  }
  console.log(JSON.stringify(evidence));
}

if (process.argv[1]?.endsWith("disdex-multisha-release-evidence.mjs")) {
  main().catch((error) => {
    console.error(JSON.stringify({ schema: SCHEMA, classification: "SOURCE_READY_NOT_LIVE", reason: String(error?.message || error), ordersSent: 0 }));
    process.exitCode = 1;
  });
}
