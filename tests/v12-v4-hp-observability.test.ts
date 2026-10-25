import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadV12V4HpObservability } from "../lib/server/v12-v4-hp-observability";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const NOW = Date.UTC(2026, 9, 12, 3, 0, 0);

async function fixture(options: {
  currentSha?: string;
  heartbeatSha?: string;
  updatedAt?: number;
  operationMode?: "CANARY" | "CERTIFIED" | "SHADOW";
  orderEnabled?: boolean;
  activeService?: "canary" | "production" | "none";
  primaryMode?: "V4" | "LEGACY";
  primarySha?: string;
  peerSha?: string;
  legacyRunnerActive?: boolean | null;
  primaryModePermissionDenied?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "v12-v4-hp-"));
  const releases = join(root, "releases");
  const release = join(releases, options.currentSha ?? SHA);
  const heartbeatRelease = join(releases, options.heartbeatSha ?? SHA);
  const stateRoot = join(root, "state");
  await mkdir(release, { recursive: true });
  await mkdir(heartbeatRelease, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  await writeFile(join(release, ".disdex-release-sha"), `${options.currentSha ?? SHA}\n`);
  await writeFile(join(heartbeatRelease, ".disdex-release-sha"), `${options.heartbeatSha ?? SHA}\n`);
  const primaryModePath = join(root, `${options.currentSha ?? SHA}.v12-primary.env`);
  if (options.primaryMode) await writeFile(primaryModePath, [
    "DISDEX_PRIMARY_V12_RUNNER=" + options.primaryMode,
    "DISDEX_V12_V4_PRIMARY_SHA=" + (options.primarySha ?? options.currentSha ?? SHA),
    "DISDEX_V12_V4_PEER_SHA=" + (options.peerSha ?? options.currentSha ?? SHA),
    "DISDEX_V12_V4_OPERATION_MODE=" + (options.operationMode ?? "CANARY"),
    "",
  ].join("\n"));
  await writeFile(join(stateRoot, "heartbeat.json"), JSON.stringify({
    schema: "disdex-v12-v4-runner-heartbeat/v1",
    strategyId: "V12_V4",
    releaseSha: options.heartbeatSha ?? SHA,
    runtimeSha: options.heartbeatSha ?? SHA,
    operationMode: options.operationMode ?? "CANARY",
    mode: "LIVE",
    status: "observing",
    reason: "NO_NATIVE_ENTRY_CANDIDATES",
    candidateCount: 1,
    orderEnabled: options.orderEnabled ?? false,
    updatedAt: options.updatedAt ?? NOW,
  }));
  const decision = {
    schema: "v12-v4-live-decision/v1",
    policyId: "V2_M150_D05_CORE_NATIVE",
    decisionTs: NOW - 60_000,
    capturedAtMs: NOW,
    sourceFingerprint: "c".repeat(64),
    candidateCount: 1,
    filteredCount: 1,
    sourceCount: 1,
    nativeCoreEvents: [],
    entryAtrByCandidate: {},
    errors: [],
    orderEnabled: false,
    realOrderEnabledV4: 0,
    tradingMutation: 0,
    candidates: [{ route: "CONT_SHORT_MID_AGE24_48", family: "CONTINUATION", symbol: "BTCUSDT", effectiveSide: "SHORT", rank: 8, eligibleEntryTs: NOW, features: { rel24: 0.02 } }],
    filtered: [{ route: "FAILED_BREAK_REV_SHORT_6H", symbol: "ETHUSDT", effectiveSide: "SHORT", eligibleEntryTs: NOW, reason: "FIRST_PASS_REPAIR_FILTER" }],
  };
  await writeFile(join(stateRoot, "decision.json"), JSON.stringify(decision));
  await writeFile(join(stateRoot, "realtime-decision.json"), JSON.stringify(decision));
  const systemd = async (unit: string) => {
    const active = options.activeService === "none" ? false : options.activeService === "production"
      ? unit.includes("disdex-v12-v4@") && !unit.includes("canary@")
      : unit.includes("canary@");
    const sha = active ? (options.heartbeatSha ?? SHA) : (options.heartbeatSha ?? SHA);
    return [
      `Id=${unit}`,
      `ActiveState=${active ? "active" : "inactive"}`,
      `SubState=${active ? "running" : "dead"}`,
      `MainPID=${active ? "1234" : "0"}`,
      `WorkingDirectory=${join(releases, sha)}`,
      `ExecStart=${join(releases, sha, "node_modules", ".bin", "tsx")} scripts/v12-v4-production-runner.ts --daemon`,
    ].join("\n");
  };
  return {
    root,
    options: {
      now: NOW,
      paths: {
        currentReleasePath: release,
        releasesRoot: releases,
        stateRoot,
        primaryModeRoot: root,
        heartbeatPath: join(stateRoot, "heartbeat.json"),
        decisionPath: join(stateRoot, "decision.json"),
        primaryModePath,
      },
      readSystemd: systemd,
      readLegacyV12Active: async () => options.legacyRunnerActive ?? false,
      readPrimaryMode: options.primaryModePermissionDenied
        ? async () => { throw new Error("V12_PRIMARY_MODE_SOURCE_PERMISSION_DENIED"); }
        : undefined,
    },
  };
}

test("V4 HP snapshot validates the separate heartbeat and decision schemas and remains read-only", async () => {
  const f = await fixture();
  try {
    const result = await loadV12V4HpObservability(f.options);
    assert.equal(result.schema, "v12-v4-hp-status/v1");
    assert.equal(result.target.policyId, "V2_M150_D05_CORE_NATIVE");
    assert.equal(result.target.expectedRouteCount, 41);
    assert.equal(result.displayStatus, "STAGED_NOT_LIVE");
    assert.equal(result.actual.v4RunnerMode, "CANARY");
    assert.equal(result.actual.orderEnabled, false);
    assert.equal(result.actual.activeRunnerState, "active/running");
    assert.equal(result.readOnly, true);
    assert.equal(result.tradingMutation, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("route coverage reports only emitted route presence and never invents NO_SIGNAL", async () => {
  const f = await fixture();
  try {
    const result = await loadV12V4HpObservability(f.options);
    assert.equal(result.routeCoverage.expected, 41);
    assert.equal(result.routeCoverage.observed, 2);
    assert.equal(result.routeCoverage.unobserved.length, 39);
    assert.equal(result.routeCoverage.completeness, false);
    assert.equal(result.candidates[0]?.route, "CONT_SHORT_MID_AGE24_48");
    assert.equal(result.filtered[0]?.reason, "FIRST_PASS_REPAIR_FILTER");
    assert.equal(result.candidates[0]?.score, null);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("release SHA mismatch is not LIVE and does not fall back to legacy V12 data", async () => {
  const f = await fixture({ heartbeatSha: OTHER_SHA });
  try {
    const result = await loadV12V4HpObservability(f.options);
    assert.equal(result.displayStatus, "SHA_MISMATCH");
    assert.equal(result.actual.currentReleaseSha, SHA);
    assert.equal(result.actual.v4ReleaseSha, OTHER_SHA);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.readOnly, true);
    assert.equal(result.tradingMutation, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("LIVE_VERIFIED requires exact primary V4 mode, certified active unit, and no legacy V12 authority", async () => {
  const f = await fixture({ operationMode: "CERTIFIED", orderEnabled: false, activeService: "production", primaryMode: "V4", legacyRunnerActive: false });
  const legacy = await fixture({ operationMode: "CERTIFIED", orderEnabled: false, activeService: "production", primaryMode: "V4", legacyRunnerActive: true });
  const unknownMode = await fixture({ operationMode: "CERTIFIED", orderEnabled: false, activeService: "production", legacyRunnerActive: false });
  try {
    const verified = await loadV12V4HpObservability(f.options);
    assert.equal(verified.displayStatus, "LIVE_VERIFIED");
    assert.equal(verified.actual.v12PrimaryMode, "V4");
    assert.equal(verified.actual.orderEnabled, false);
    const duplicateAuthority = await loadV12V4HpObservability(legacy.options);
    assert.notEqual(duplicateAuthority.displayStatus, "LIVE_VERIFIED");
    assert.equal(duplicateAuthority.actual.legacyV12RunnerActive, true);
    const unprovenPrimary = await loadV12V4HpObservability(unknownMode.options);
    assert.notEqual(unprovenPrimary.displayStatus, "LIVE_VERIFIED");
    assert.equal(unprovenPrimary.actual.v12PrimaryMode, "UNKNOWN");
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(legacy.root, { recursive: true, force: true });
    await rm(unknownMode.root, { recursive: true, force: true });
  }
});

test("independent V4 primary SHA is accepted when the peer SHA remains bound to current production", async () => {
  const f = await fixture({
    operationMode: "CERTIFIED",
    orderEnabled: false,
    activeService: "production",
    primaryMode: "V4",
    primarySha: OTHER_SHA,
    peerSha: SHA,
    heartbeatSha: OTHER_SHA,
    legacyRunnerActive: false,
  });
  try {
    const result = await loadV12V4HpObservability(f.options);
    assert.equal(result.displayStatus, "LIVE_VERIFIED");
    assert.equal(result.actual.currentReleaseSha, SHA);
    assert.equal(result.actual.v4ReleaseSha, OTHER_SHA);
    assert.equal(result.actual.v12PrimaryMode, "V4");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("decision telemetry defaults to the V4 state root when no environment override is supplied", async () => {
  const f = await fixture({
    operationMode: "CERTIFIED",
    orderEnabled: false,
    activeService: "production",
    primaryMode: "V4",
    legacyRunnerActive: false,
  });
  try {
    const result = await loadV12V4HpObservability({
      ...f.options,
      paths: { ...f.options.paths, decisionPath: undefined },
    });
    assert.equal(result.freshness.decision, true);
    assert.equal(result.candidates.length, 1);
    assert.doesNotMatch(result.errors.join(" "), /V4_DECISION_PATH_UNCONFIGURED/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("root-only primary contract can be inferred only from exact certified production V4 authority", async () => {
  const f = await fixture({
    operationMode: "CERTIFIED",
    orderEnabled: false,
    activeService: "production",
    legacyRunnerActive: false,
    primaryModePermissionDenied: true,
  });
  try {
    const result = await loadV12V4HpObservability(f.options);
    assert.equal(result.displayStatus, "LIVE_VERIFIED");
    assert.equal(result.actual.v12PrimaryMode, "V4");
    assert.equal(result.actual.activeRunnerId, `disdex-v12-v4@${SHA}.service`);
    assert.doesNotMatch(result.errors.join(" "), /PRIMARY_MODE_SOURCE_PERMISSION_DENIED/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("primary mode evidence is bound to the current release SHA filename", async () => {
  const f = await fixture({ operationMode: "CERTIFIED", orderEnabled: true, activeService: "production", primaryMode: "V4", legacyRunnerActive: false });
  try {
    const stalePath = join(f.root, `${OTHER_SHA}.v12-primary.env`);
    await writeFile(stalePath, "DISDEX_PRIMARY_V12_RUNNER=V4\n");
    f.options.paths.primaryModePath = stalePath;
    const result = await loadV12V4HpObservability(f.options);
    assert.notEqual(result.displayStatus, "LIVE_VERIFIED");
    assert.match(result.errors.join(" "), /PRIMARY_MODE_SOURCE_INVALID/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("incomplete decision batches stay telemetry errors and cannot leak partial candidates", async () => {
  const f = await fixture();
  try {
    const decisionPath = f.options.paths.decisionPath!;
    const decision = JSON.parse(await (await import("node:fs/promises")).readFile(decisionPath, "utf8"));
    decision.candidateCount = 2;
    await writeFile(decisionPath, JSON.stringify(decision));
    const result = await loadV12V4HpObservability(f.options);
    assert.equal(result.displayStatus, "STAGED_NOT_LIVE");
    assert.match(result.errors.join(" "), /BATCH_INCOMPLETE/);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.filtered.length, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("stale V4 heartbeat is visibly stale while missing optional decision telemetry does not override runtime authority", async () => {
  const f = await fixture({ updatedAt: NOW - 4 * 60 * 60_000 });
  const missingFixture = await fixture();
  try {
    const stale = await loadV12V4HpObservability(f.options);
    assert.equal(stale.displayStatus, "STALE");
    assert.equal(stale.freshness.heartbeat, false);
    await rm(missingFixture.options.paths.decisionPath, { force: true });
    const missing = await loadV12V4HpObservability(missingFixture.options);
    assert.equal(missing.displayStatus, "STAGED_NOT_LIVE");
    assert.match(missing.errors.join(" "), /DECISION/);
    assert.equal(missing.candidates.length, 0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(missingFixture.root, { recursive: true, force: true });
  }
});
