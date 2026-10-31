import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  V12_V4_HP_ROUTE_IDS,
  V12_V4_HP_TARGET,
  type V12V4HpCandidate,
  type V12V4HpDisplayStatus,
  type V12V4HpFilteredCandidate,
  type V12V4HpSnapshot,
} from "@/lib/v12-v4-hp-contract";

const execFileAsync = promisify(execFile);
const SHA_RE = /^[a-f0-9]{40}$/i;
const FINGERPRINT_RE = /^[a-f0-9]{64}$/i;
const HEARTBEAT_SCHEMA = "disdex-v12-v4-runner-heartbeat/v1";
const DECISION_SCHEMA = "v12-v4-live-decision/v1";
const POLICY_ID = "V2_M150_D05_CORE_NATIVE";
const MAX_HEARTBEAT_BYTES = 64 * 1024;
const MAX_DECISION_BYTES = 2 * 1024 * 1024;
const SOURCE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 60_000;

type Obj = Record<string, unknown>;
type SourcePaths = {
  currentReleasePath: string;
  releasesRoot: string;
  stateRoot: string;
  heartbeatPath: string;
  decisionPath?: string;
  primaryModeRoot: string;
  primaryModePath?: string;
};
type PrimaryModeEvidence = {
  mode: "V4" | "LEGACY";
  primarySha: string | null;
  peerSha: string | null;
  operationMode: "CERTIFIED" | "CANARY" | "SHADOW" | null;
};
export type V12V4HpObservabilityOptions = {
  now?: number;
  /** Dependency/path seams for deterministic tests. Production callers use fixed VPS defaults. */
  paths?: Partial<SourcePaths>;
  readSystemd?: (unit: string) => Promise<string>;
  readLegacyV12Active?: () => Promise<boolean>;
  readPrimaryMode?: (currentSha: string) => Promise<PrimaryModeEvidence>;
};

const isObj = (value: unknown): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const asText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalizeSha = (value: unknown) => {
  const text = asText(value).toLowerCase();
  return SHA_RE.test(text) ? text : null;
};
const isInside = (root: string, target: string) => {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== "..");
};

function pathsFor(options: V12V4HpObservabilityOptions): SourcePaths {
  const stateRoot = options.paths?.stateRoot ?? process.env.V12_V4_HP_STATE_ROOT ?? "/var/lib/disdex/v12-v4";
  return {
    currentReleasePath: options.paths?.currentReleasePath ?? process.env.DISDEX_CURRENT_RELEASE_PATH ?? "/home/deploy/disdex-trading/current",
    releasesRoot: options.paths?.releasesRoot ?? process.env.DISDEX_RELEASES_ROOT ?? "/home/deploy/disdex-trading/releases",
    stateRoot,
    heartbeatPath: options.paths?.heartbeatPath ?? process.env.V12_V4_HEALTH_STATE_PATH ?? join(stateRoot, "heartbeat.json"),
    decisionPath: options.paths?.decisionPath ?? process.env.V12_V4_REALTIME_DECISION_PATH ?? join(stateRoot, "realtime-decision.json"),
    primaryModeRoot: options.paths?.primaryModeRoot ?? process.env.DISDEX_RUNTIME_CONTRACT_ENV_DIR ?? "/etc/disdex/current-runtime",
    primaryModePath: options.paths?.primaryModePath,
  };
}

async function readBoundedFile(path: string, trustedRoot: string, maxBytes: number): Promise<string> {
  if (!path || !trustedRoot || !isAbsolute(path) || !isAbsolute(trustedRoot) || !isInside(trustedRoot, path)) {
    throw new Error("V4_SOURCE_PATH_OUTSIDE_ALLOWLIST");
  }
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error("V4_SOURCE_FILE_UNSAFE_OR_TOO_LARGE");
  const actual = await realpath(path);
  if (resolve(actual) !== resolve(path)) throw new Error("V4_SOURCE_SYMLINK_NOT_ALLOWED");
  // O_NOFOLLOW closes the final-component race on Linux; Windows test runs
  // still get lstat + realpath checks and use the normal read-only flag.
  const flags = process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(path, flags);
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.size > maxBytes) throw new Error("V4_SOURCE_FILE_UNSAFE_OR_TOO_LARGE");
    const text = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("V4_SOURCE_FILE_UNSAFE_OR_TOO_LARGE");
    return text;
  } finally {
    await handle.close();
  }
}

async function readJson(path: string, root: string, limit: number): Promise<Obj> {
  let value: unknown;
  try { value = JSON.parse(await readBoundedFile(path, root, limit)); }
  catch (error) {
    const code = isObj(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT" || code === "ENOTDIR") throw new Error("V4_JSON_SOURCE_UNAVAILABLE");
    throw new Error(`V4_JSON_SOURCE_INVALID:${error instanceof Error ? error.message : "READ_FAILED"}`);
  }
  if (!isObj(value)) throw new Error("V4_JSON_SOURCE_NOT_OBJECT");
  return value;
}

async function readCurrentRelease(paths: SourcePaths): Promise<{ sha: string; releaseDir: string }> {
  if (!isAbsolute(paths.currentReleasePath) || !isAbsolute(paths.releasesRoot)) {
    throw new Error("V4_CURRENT_RELEASE_PATH_NOT_ABSOLUTE");
  }
  const releaseDir = await realpath(paths.currentReleasePath);
  if (!isInside(paths.releasesRoot, releaseDir) || resolve(releaseDir) === resolve(paths.releasesRoot)) {
    throw new Error("V4_CURRENT_RELEASE_OUTSIDE_RELEASE_ROOT");
  }
  const markerPath = join(releaseDir, ".disdex-release-sha");
  const marker = (await readBoundedFile(markerPath, releaseDir, 256)).trim().toLowerCase();
  const dirSha = releaseDir.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase();
  if (!SHA_RE.test(marker) || marker !== dirSha) throw new Error("V4_CURRENT_RELEASE_MARKER_MISMATCH");
  return { sha: marker, releaseDir };
}

function parseProperties(text: string): Record<string, string> {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line.includes("="))
    .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}

async function readSystemd(unit: string): Promise<string> {
  const { stdout } = await execFileAsync("systemctl", ["show", unit, "--no-pager",
    "--property=Id,ActiveState,SubState,MainPID,WorkingDirectory,ExecStart"], { timeout: 3000, maxBuffer: 32 * 1024 });
  return stdout;
}

async function readPrimaryMode(paths: SourcePaths, currentSha: string): Promise<PrimaryModeEvidence> {
  const expectedPath = join(paths.primaryModeRoot, `${currentSha}.v12-primary.env`);
  const path = paths.primaryModePath ?? expectedPath;
  if (resolve(path) !== resolve(expectedPath)) throw new Error("V12_PRIMARY_MODE_SOURCE_INVALID");
  if (!isAbsolute(paths.primaryModeRoot) || !isAbsolute(path) || !isInside(paths.primaryModeRoot, path)) {
    throw new Error("V12_PRIMARY_MODE_SOURCE_OUTSIDE_ALLOWLIST");
  }
  let contents: string;
  try {
    contents = await readBoundedFile(path, paths.primaryModeRoot, 4096);
  } catch (error) {
    const code = isObj(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT" || code === "ENOTDIR") throw new Error("V12_PRIMARY_MODE_SOURCE_UNAVAILABLE");
    if (code === "EACCES" || code === "EPERM") throw new Error("V12_PRIMARY_MODE_SOURCE_PERMISSION_DENIED");
    throw new Error("V12_PRIMARY_MODE_SOURCE_INVALID");
  }
  const lines = contents.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
  const allowed = new Set([
    "DISDEX_PRIMARY_V12_RUNNER",
    "DISDEX_V12_V4_PRIMARY_SHA",
    "DISDEX_V12_V4_PEER_SHA",
    "DISDEX_V12_V4_OPERATION_MODE",
  ]);
  const entries = new Map<string, string>();
  for (const line of lines) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || !allowed.has(match[1]) || entries.has(match[1])) throw new Error("V12_PRIMARY_MODE_SOURCE_INVALID");
    entries.set(match[1], match[2].trim());
  }
  const mode = entries.get("DISDEX_PRIMARY_V12_RUNNER");
  if (mode !== "V4" && mode !== "LEGACY") throw new Error("V12_PRIMARY_MODE_SOURCE_INVALID");
  const primarySha = normalizeSha(entries.get("DISDEX_V12_V4_PRIMARY_SHA"));
  const peerSha = normalizeSha(entries.get("DISDEX_V12_V4_PEER_SHA"));
  const operationModeText = entries.get("DISDEX_V12_V4_OPERATION_MODE");
  const operationMode = operationModeText === undefined ? null :
    operationModeText === "CERTIFIED" || operationModeText === "CANARY" || operationModeText === "SHADOW"
      ? operationModeText
      : null;
  if (operationModeText !== undefined && operationMode === null) throw new Error("V12_PRIMARY_MODE_SOURCE_INVALID");
  if (mode === "V4") {
    // The V4 runner is an independently versioned primary. The current
    // production release remains the peer lineage, so only the peer SHA is
    // required to match the SHA-bound contract filename/current symlink.
    if (!primarySha || peerSha !== currentSha) throw new Error("V12_PRIMARY_MODE_SOURCE_INVALID");
  } else {
    for (const value of [primarySha, peerSha]) {
      if (value !== null && value !== currentSha) throw new Error("V12_PRIMARY_MODE_SOURCE_INVALID");
    }
  }
  return { mode, primarySha, peerSha, operationMode };
}

async function readLegacyV12Active(): Promise<boolean> {
  const { stdout } = await execFileAsync("systemctl", ["list-units", "--no-pager", "--plain",
    "--type=service", "--state=running", "disdex-v12-x1-all@*.service"], { timeout: 3000, maxBuffer: 32 * 1024 });
  const lines = stdout.split(/\r?\n/).filter(line => line.includes("disdex-v12-x1-all@"));
  if (lines.length === 0) return false;
  if (lines.some(line => /^\s*disdex-v12-x1-all@[a-f0-9]{40}\.service\s+loaded\s+active\s+running\b/i.test(line))) return true;
  throw new Error("V12_LEGACY_SERVICE_STATUS_UNKNOWN");
}

function finiteCount(value: unknown): number | null {
  return finite(value) && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function featuresFrom(value: unknown): Record<string, number | boolean> {
  if (!isObj(value)) return {};
  const out: Record<string, number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if ((finite(item) || typeof item === "boolean") && key.length <= 64) out[key] = item;
  }
  return out;
}

function parseCandidate(value: unknown): V12V4HpCandidate {
  if (!isObj(value)) throw new Error("V4_CANDIDATE_ROW_INVALID");
  const route = asText(value.route);
  const symbol = asText(value.symbol).toUpperCase();
  if (!V12_V4_HP_ROUTE_IDS.includes(route as typeof V12_V4_HP_ROUTE_IDS[number]) || !/^[A-Z0-9]{2,20}USDT$/.test(symbol)) {
    throw new Error("V4_CANDIDATE_IDENTITY_INVALID");
  }
  const side = asText(value.effectiveSide).toUpperCase();
  const entryTs = finite(value.eligibleEntryTs) ? value.eligibleEntryTs : null;
  const rank = finite(value.rank) ? value.rank : null;
  return {
    symbol,
    route,
    family: asText(value.family) || null,
    side: side === "LONG" || side === "SHORT" ? side : null,
    eligibleEntryTs: entryTs,
    sourceRank: rank,
    rankingEligible: false,
    rankingExclusion: "RESEARCH_PRIORITY_NOT_LIVE_RANK",
    score: null,
    scoreKind: "UNAVAILABLE",
    scoreLabel: "V4 decision source has no verified native score",
    features: featuresFrom(value.features),
  };
}

function parseFiltered(value: unknown): V12V4HpFilteredCandidate {
  if (!isObj(value)) throw new Error("V4_FILTERED_ROW_INVALID");
  const route = asText(value.route);
  const symbol = asText(value.symbol).toUpperCase();
  if (!V12_V4_HP_ROUTE_IDS.includes(route as typeof V12_V4_HP_ROUTE_IDS[number]) || !/^[A-Z0-9]{2,20}USDT$/.test(symbol)) {
    throw new Error("V4_FILTERED_IDENTITY_INVALID");
  }
  const side = asText(value.effectiveSide).toUpperCase();
  return {
    symbol,
    route,
    side: side === "LONG" || side === "SHORT" ? side : null,
    eligibleEntryTs: finite(value.eligibleEntryTs) ? value.eligibleEntryTs : null,
    reason: asText(value.reason) || "SOURCE_REASON_UNAVAILABLE",
  };
}

function fresh(at: number | null, now: number): boolean {
  return at !== null && now - at >= -FUTURE_SKEW_MS && now - at <= SOURCE_MAX_AGE_MS;
}

function defaultSnapshot(now: number, errors: string[], displayStatus: V12V4HpDisplayStatus = "UNAVAILABLE"): V12V4HpSnapshot {
  return {
    schema: "v12-v4-hp-status/v1",
    target: V12_V4_HP_TARGET,
    displayStatus,
    actual: {
      currentReleaseSha: null,
      activeRunnerId: null,
      activeRunnerState: "unavailable",
      activeRunnerSha: null,
      v4RunnerMode: "UNKNOWN",
      v12PrimaryMode: "UNKNOWN",
      legacyV12RunnerActive: null,
      v4ReleaseSha: null,
      heartbeatSha: null,
      orderEnabled: null,
    },
    timestamps: { checkedAt: now, heartbeatUpdatedAt: null, decisionTs: null, capturedAtMs: null },
    freshness: { heartbeat: false, decision: false },
    candidates: [],
    filtered: [],
    routeCoverage: {
      expected: V12_V4_HP_TARGET.expectedRouteCount,
      observed: 0,
      candidateCount: null,
      filteredCount: null,
      unobserved: [...V12_V4_HP_ROUTE_IDS],
      completeness: false,
      semantics: "EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE",
    },
    errors,
    readOnly: true,
    tradingMutation: 0,
  };
}

export async function loadV12V4HpObservability(options: V12V4HpObservabilityOptions = {}): Promise<V12V4HpSnapshot> {
  const now = options.now ?? Date.now();
  const paths = pathsFor(options);
  const errors: string[] = [];
  let currentSha: string | null = null;
  let releaseDir: string | null = null;
  let heartbeat: Obj | null = null;
  let decision: Obj | null = null;

  try {
    const current = await readCurrentRelease(paths);
    currentSha = current.sha;
    releaseDir = current.releaseDir;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "V4_CURRENT_RELEASE_UNAVAILABLE");
  }

  try {
    heartbeat = await readJson(paths.heartbeatPath, paths.stateRoot, MAX_HEARTBEAT_BYTES);
  } catch (error) {
    errors.push(`V4_HEARTBEAT_SOURCE:${error instanceof Error ? error.message : "UNAVAILABLE"}`);
  }

  if (paths.decisionPath) {
    try { decision = await readJson(paths.decisionPath, paths.stateRoot, MAX_DECISION_BYTES); }
    catch (error) { errors.push(`V4_DECISION_SOURCE:${error instanceof Error ? error.message : "UNAVAILABLE"}`); }
  }

  if (!heartbeat && !decision && !currentSha) return defaultSnapshot(now, errors);

  const heartbeatSchemaOk = heartbeat?.schema === HEARTBEAT_SCHEMA && heartbeat.strategyId === "V12_V4";
  const heartbeatRuntimeSha = normalizeSha(heartbeat?.runtimeSha);
  const heartbeatReleaseSha = normalizeSha(heartbeat?.releaseSha);
  const heartbeatSha = heartbeatRuntimeSha && heartbeatReleaseSha
    ? heartbeatRuntimeSha === heartbeatReleaseSha ? heartbeatRuntimeSha : null
    : heartbeatRuntimeSha ?? heartbeatReleaseSha;
  const heartbeatUpdatedAt = finite(heartbeat?.updatedAt) ? heartbeat.updatedAt : null;
  const heartbeatFresh = heartbeatSchemaOk && fresh(heartbeatUpdatedAt, now);
  const modeText = asText(heartbeat?.operationMode).toUpperCase();
  const v4RunnerMode: V12V4HpSnapshot["actual"]["v4RunnerMode"] = modeText === "CERTIFIED" || modeText === "CANARY" || modeText === "SHADOW" ? modeText : "UNKNOWN";
  const orderEnabled = typeof heartbeat?.orderEnabled === "boolean" ? heartbeat.orderEnabled : null;

  let v12PrimaryMode: V12V4HpSnapshot["actual"]["v12PrimaryMode"] = "UNKNOWN";
  let primaryModeEvidence: PrimaryModeEvidence | null = null;
  if (currentSha) {
    try {
      primaryModeEvidence = await (options.readPrimaryMode ? options.readPrimaryMode(currentSha) : readPrimaryMode(paths, currentSha));
      v12PrimaryMode = primaryModeEvidence.mode;
    }
    catch (error) { errors.push(error instanceof Error ? error.message : "V12_PRIMARY_MODE_SOURCE_UNAVAILABLE"); }
  }
  let legacyV12RunnerActive: boolean | null = null;
  try { legacyV12RunnerActive = await (options.readLegacyV12Active ?? readLegacyV12Active)(); }
  catch { errors.push("V12_LEGACY_RUNNER_STATUS_UNAVAILABLE"); }

  if (heartbeat && !heartbeatSchemaOk) errors.push("V4_HEARTBEAT_SCHEMA_OR_STRATEGY_MISMATCH");
  if (heartbeat && !heartbeatSha) errors.push("V4_HEARTBEAT_SHA_MISSING_OR_CONFLICTED");
  if (heartbeat && !heartbeatFresh) errors.push("V4_HEARTBEAT_STALE_OR_INVALID_TIMESTAMP");

  let decisionTs: number | null = null;
  let capturedAtMs: number | null = null;
  let candidates: V12V4HpCandidate[] = [];
  let filtered: V12V4HpFilteredCandidate[] = [];
  let candidateCount: number | null = null;
  let filteredCount: number | null = null;
  let decisionSchemaOk = false;
  let decisionFresh = false;
  let decisionBatchComplete = false;

  if (decision) {
    decisionTs = finite(decision.decisionTs) ? decision.decisionTs : null;
    capturedAtMs = finite(decision.capturedAtMs) ? decision.capturedAtMs : null;
    decisionSchemaOk = decision.schema === DECISION_SCHEMA && decision.policyId === POLICY_ID &&
      decision.orderEnabled === false && decision.realOrderEnabledV4 === 0 && decision.tradingMutation === 0 &&
      FINGERPRINT_RE.test(asText(decision.sourceFingerprint));
    decisionFresh = decisionSchemaOk && fresh(decisionTs, now) && fresh(capturedAtMs, now);
    const rawCandidates = Array.isArray(decision.candidates) ? decision.candidates : null;
    const rawFiltered = Array.isArray(decision.filtered) ? decision.filtered : null;
    candidateCount = finiteCount(decision.candidateCount);
    filteredCount = finiteCount(decision.filteredCount);
    const sourceCount = finiteCount(decision.sourceCount);
    if (!decisionSchemaOk || !decisionFresh || !rawCandidates || !rawFiltered || candidateCount !== rawCandidates.length ||
      filteredCount !== rawFiltered.length || sourceCount === null || !Array.isArray(decision.errors) || decision.errors.length > 0) {
      errors.push(!decisionSchemaOk ? "V4_DECISION_SCHEMA_POLICY_OR_SAFETY_MISMATCH" :
        !decisionFresh ? "V4_DECISION_STALE_OR_INVALID_TIMESTAMP" : "V4_DECISION_BATCH_INCOMPLETE");
    } else {
      try {
        candidates = rawCandidates.map(parseCandidate);
        filtered = rawFiltered.map(parseFiltered);
        decisionBatchComplete = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "V4_DECISION_ROW_INVALID");
        candidates = [];
        filtered = [];
      }
    }
  }

  const representedRoutes = new Set([...candidates.map(row => row.route), ...filtered.map(row => row.route)]);
  const unobserved = V12_V4_HP_ROUTE_IDS.filter(route => !representedRoutes.has(route));
  const routeCoverage: V12V4HpSnapshot["routeCoverage"] = {
    expected: V12_V4_HP_TARGET.expectedRouteCount,
    observed: representedRoutes.size,
    candidateCount,
    filteredCount,
    unobserved,
    // v1 does not report a completed evaluation count for every route/symbol.
    completeness: false,
    semantics: "EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE",
  };

  const runnerSha = heartbeatSha;
  const units = runnerSha ? [
    `disdex-v12-v4@${runnerSha}.service`,
    `disdex-v12-v4-canary@${runnerSha}.service`,
  ] : [];
  const unitResults = await Promise.all(units.map(async unit => {
    try {
      const properties = parseProperties(await (options.readSystemd ?? readSystemd)(unit));
      if (properties.Id !== unit || properties.ActiveState !== "active" || properties.SubState !== "running" ||
        !/^[1-9][0-9]*$/.test(properties.MainPID ?? "")) return null;
      const expectedDir = resolve(paths.releasesRoot, runnerSha!);
      const workingDirectory = resolve(properties.WorkingDirectory ?? "");
      const executablePrefix = `${expectedDir}${sep}`;
      const execStart = properties.ExecStart ?? "";
      const execPathMatches = execStart.includes(executablePrefix) || execStart.includes(executablePrefix.replaceAll("\\", "/"));
      if (workingDirectory !== expectedDir || !execPathMatches) {
        errors.push("V4_ACTIVE_UNIT_RELEASE_PATH_MISMATCH");
        return { invalid: true as const, unit };
      }
      return { active: true as const, unit, sha: runnerSha, pid: Number(properties.MainPID) };
    } catch {
      return null;
    }
  }));
  const activeUnits = unitResults.filter((item): item is Extract<NonNullable<typeof item>, { active: true }> =>
    !!item && "active" in item);
  const invalidUnits = unitResults.some(item => !!item && "invalid" in item);
  let activeRunnerId: string | null = null;
  let activeRunnerState = "inactive";
  let activeRunnerSha: string | null = null;
  if (activeUnits.length === 1) {
    activeRunnerId = activeUnits[0].unit;
    activeRunnerSha = activeUnits[0].sha;
    activeRunnerState = "active/running";
  } else if (activeUnits.length > 1) {
    activeRunnerState = "duplicate";
    errors.push("V4_DUPLICATE_ACTIVE_UNITS");
  } else if (invalidUnits) {
    activeRunnerState = "release-path-mismatch";
  } else if (!runnerSha) {
    activeRunnerState = "unavailable";
  }

  // The exact-SHA primary-mode contract is intentionally root:root 0600 in Production.
  // If the read-only UI user cannot read only that file, prove V4 authority from stronger
  // runtime evidence: the exact current SHA's production (not canary) V4 service is the
  // sole active V12 authority, is CERTIFIED, and legacy V12 is not running.
  const primaryPermissionIndex = errors.indexOf("V12_PRIMARY_MODE_SOURCE_PERMISSION_DENIED");
  const productionV4Unit = runnerSha ? `disdex-v12-v4@${runnerSha}.service` : null;
  if (v12PrimaryMode === "UNKNOWN" && primaryPermissionIndex >= 0 && currentSha && runnerSha &&
    currentSha === runnerSha && activeRunnerSha === runnerSha && activeRunnerId === productionV4Unit &&
    activeRunnerState === "active/running" && v4RunnerMode === "CERTIFIED" && legacyV12RunnerActive === false) {
    v12PrimaryMode = "V4";
    primaryModeEvidence = { mode: "V4", primarySha: runnerSha, peerSha: currentSha, operationMode: v4RunnerMode };
    errors.splice(primaryPermissionIndex, 1);
  }

  const shaLineageVerified = !!(currentSha && runnerSha && primaryModeEvidence && (
    primaryModeEvidence.mode === "V4"
      ? primaryModeEvidence.primarySha === runnerSha && primaryModeEvidence.peerSha === currentSha
      : primaryModeEvidence.primarySha === currentSha && primaryModeEvidence.peerSha === currentSha
  ));
  const shaMismatch = !!(currentSha && runnerSha && (
    v12PrimaryMode === "V4" ? !shaLineageVerified :
      v12PrimaryMode === "LEGACY" ? !shaLineageVerified : currentSha !== runnerSha
  ));
  const runtimeErrors = errors.filter(error => !/^(V4_DECISION_|V4_CANDIDATE_|V4_FILTERED_)/.test(error));
  const sourceIntegrityError = runtimeErrors.some(error =>
    /SCHEMA|POLICY|SAFETY|CONFLICTED|MISMATCH|INCOMPLETE|UNSAFE|OUTSIDE|ROW_INVALID|IDENTITY_INVALID|JSON_SOURCE_INVALID|DUPLICATE/.test(error));
  const staleEvidence = !!heartbeat && !heartbeatFresh;
  const runtimeEvidenceUnavailable = !currentSha || !heartbeat || !heartbeatFresh ||
    activeRunnerState !== "active/running" || legacyV12RunnerActive === null;

  let displayStatus: V12V4HpDisplayStatus;
  if (shaMismatch) displayStatus = "SHA_MISMATCH";
  else if (sourceIntegrityError) displayStatus = "SOURCE_ERROR";
  else if (staleEvidence) displayStatus = "STALE";
  else if (v4RunnerMode === "SHADOW") displayStatus = "SHADOW";
  else if (activeRunnerState === "duplicate" || activeRunnerState === "release-path-mismatch" || legacyV12RunnerActive === true) displayStatus = "SOURCE_ERROR";
  else if (runtimeEvidenceUnavailable) displayStatus = "UNAVAILABLE";
  else if (v4RunnerMode === "CANARY" || v12PrimaryMode === "LEGACY") displayStatus = "STAGED_NOT_LIVE";
  else if (v4RunnerMode === "UNKNOWN" || v12PrimaryMode === "UNKNOWN") displayStatus = "UNAVAILABLE";
  else if (shaLineageVerified && activeRunnerSha === runnerSha && heartbeatFresh &&
    v4RunnerMode === "CERTIFIED" && v12PrimaryMode === "V4" && legacyV12RunnerActive === false) displayStatus = "LIVE_VERIFIED";
  else displayStatus = "STAGED_NOT_LIVE";

  return {
    schema: "v12-v4-hp-status/v1",
    target: V12_V4_HP_TARGET,
    displayStatus,
    actual: {
      currentReleaseSha: currentSha,
      activeRunnerId,
      activeRunnerState,
      activeRunnerSha,
      v4RunnerMode,
      v12PrimaryMode,
      legacyV12RunnerActive,
      v4ReleaseSha: normalizeSha(heartbeat?.releaseSha),
      heartbeatSha: runnerSha,
      orderEnabled,
    },
    timestamps: { checkedAt: now, heartbeatUpdatedAt, decisionTs, capturedAtMs },
    freshness: { heartbeat: heartbeatFresh, decision: decisionFresh },
    candidates,
    filtered,
    routeCoverage,
    errors,
    readOnly: true,
    tradingMutation: 0,
  };
}
