/**
 * Root-only V4 dynamic evidence refresh.
 *
 * This helper has one deliberately narrow responsibility: revalidate mutable
 * account/risk evidence from the official read-only sources before its
 * 24-hour deadline.  It cannot refresh release-bound proofs, create an
 * approval, enable orders, or call any order mutation endpoint.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  AsterV3Client,
  type AsterBalanceRow,
  type AsterOrderResponse,
  type AsterPositionRiskRow,
} from "../../../lib/aster-v3-client";
import { validateV4SharedExecutionEvidencePayloads } from "../../../lib/v12-v4-certified-gates";
import {
  EVIDENCE_CLASSES,
  EVIDENCE_FILE_NAMES,
  EVIDENCE_KEYS,
} from "./disdex-v12-v4-evidence-preflight.mjs";

const SHA = /^[a-f0-9]{40}$/;
const MAX_JSON_BYTES = 256 * 1024;
const DYNAMIC_KEYS = [...EVIDENCE_CLASSES.DYNAMIC] as const;
const STATIC_KEYS = [...EVIDENCE_CLASSES.STATIC] as const;
const evidenceFileName = (key: string) => (EVIDENCE_FILE_NAMES as Record<string, string>)[key];

type JsonRecord = Record<string, any>;
type EvidenceKey = (typeof EVIDENCE_KEYS)[number];

export type V4DynamicRuntimeSnapshot = {
  sharedRisk: JsonRecord;
  marginGuard: JsonRecord;
  killSwitch: JsonRecord;
  pendingExposure: JsonRecord;
};

export type V4SignedAsterSnapshot = {
  serverTime: number;
  balances: AsterBalanceRow[];
  positions: AsterPositionRiskRow[];
  openOrders: AsterOrderResponse[];
  signedGet: true;
  mutationCalls: 0;
};

function assertSha(sha: string) {
  if (!SHA.test(String(sha || ""))) throw new Error("V4_DYNAMIC_REFRESH_SHA_INVALID");
  return sha.toLowerCase();
}

function assertFinite(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`V4_DYNAMIC_REFRESH_NUMBER_INVALID:${label}`);
  return number;
}

function assertRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`V4_DYNAMIC_REFRESH_RECORD_INVALID:${label}`);
  return value as JsonRecord;
}

function capturedAtFor(now: number) {
  if (!Number.isFinite(now) || now <= 0) throw new Error("V4_DYNAMIC_REFRESH_TIME_INVALID");
  const capturedAt = new Date(now).toISOString();
  if (Date.parse(capturedAt) !== now) throw new Error("V4_DYNAMIC_REFRESH_TIME_NORMALIZATION_FAILED");
  return capturedAt;
}

function normalizeBalance(row: AsterBalanceRow) {
  return {
    asset: String(row.asset || "").toUpperCase(),
    balance: String(row.balance ?? row.crossWalletBalance ?? ""),
    availableBalance: String(row.availableBalance ?? ""),
    updateTime: row.updateTime ?? null,
  };
}

function normalizePosition(row: AsterPositionRiskRow) {
  return {
    symbol: String(row.symbol || "").toUpperCase(),
    positionAmt: String(row.positionAmt ?? ""),
    positionSide: row.positionSide ?? "BOTH",
    entryPrice: String(row.entryPrice ?? ""),
    markPrice: String(row.markPrice ?? ""),
    updateTime: row.updateTime ?? null,
  };
}

function normalizeOrder(row: AsterOrderResponse) {
  return {
    symbol: String(row.symbol || "").toUpperCase(),
    orderId: row.orderId ?? null,
    clientOrderId: row.clientOrderId ?? null,
    status: row.status ?? null,
    side: row.side ?? null,
    positionSide: row.positionSide ?? "BOTH",
    type: row.type ?? null,
    reduceOnly: row.reduceOnly === true,
    closePosition: row.closePosition === true,
    origQty: row.origQty ?? null,
    executedQty: row.executedQty ?? null,
    stopPrice: row.stopPrice ?? null,
    updateTime: row.updateTime ?? null,
  };
}

function assertHealthyRuntime(runtime: V4DynamicRuntimeSnapshot) {
  const sharedRisk = assertRecord(runtime.sharedRisk, "sharedRisk");
  if (sharedRisk.sourceComplete !== true || sharedRisk.tripped === true) {
    throw new Error("V4_DYNAMIC_REFRESH_SHARED_RISK_NOT_HEALTHY");
  }
  const marginGuard = assertRecord(runtime.marginGuard, "marginGuard");
  if (marginGuard.stage !== "HEALTHY" || marginGuard.ordersAllowed !== true) {
    throw new Error("V4_DYNAMIC_REFRESH_MARGIN_GUARD_NOT_HEALTHY");
  }
  const killSwitch = assertRecord(runtime.killSwitch, "killSwitch");
  if (killSwitch.active === true) throw new Error("V4_DYNAMIC_REFRESH_KILL_SWITCH_ACTIVE");
  const pendingExposure = assertRecord(runtime.pendingExposure, "pendingExposure");
  if (!Array.isArray(pendingExposure.entries)) throw new Error("V4_DYNAMIC_REFRESH_PENDING_REGISTRY_INVALID");
  const activeEntries = pendingExposure.entries.filter((entry: JsonRecord) => String(entry?.status || "").toUpperCase() !== "RELEASED");
  if (activeEntries.length !== 0) throw new Error(`V4_DYNAMIC_REFRESH_PENDING_EXPOSURE_NOT_EMPTY:${activeEntries.length}`);
  return { pendingCount: activeEntries.length };
}

/** Validate release-bound files without applying a wall-clock expiry to them. */
export function validateStaticReleaseEvidence(input: { sha: string; payloads: Record<string, unknown>; now?: number }) {
  const sha = assertSha(input.sha);
  const now = input.now ?? Date.now();
  for (const key of STATIC_KEYS) {
    const payload = assertRecord(input.payloads[key], key);
    if (payload.status !== "PASS") throw new Error(`V4_DYNAMIC_REFRESH_STATIC_STATUS_NOT_PASS:${key}`);
    if (payload.candidateSha !== sha) throw new Error(`V4_DYNAMIC_REFRESH_STATIC_SHA_MISMATCH:${key}`);
    const captured = Date.parse(String(payload.capturedAt || ""));
    if (!Number.isFinite(captured) || captured > now + 5 * 60_000) {
      throw new Error(`V4_DYNAMIC_REFRESH_STATIC_TIMESTAMP_INVALID:${key}`);
    }
  }
  const route = assertRecord(input.payloads.routeSourceParity, "routeSourceParity");
  if (Number(route.routeCount) !== 41 || route.sourceParity !== true) throw new Error("V4_DYNAMIC_REFRESH_STATIC_ROUTE_INVALID");
  const tests = assertRecord(input.payloads.v4ExecutionTests, "v4ExecutionTests");
  if (Number(tests.testPasses) <= 0 || Number(tests.failCount) !== 0 || tests.typecheck !== true) {
    throw new Error("V4_DYNAMIC_REFRESH_STATIC_TESTS_INVALID");
  }
  return true as const;
}

/**
 * Convert one official signed-read snapshot and one root runtime snapshot into
 * the three mutable evidence records.  This function is pure and intentionally
 * has no approval or order-authorizing output.
 */
export function buildV4DynamicEvidence(input: {
  sha: string;
  now?: number;
  refreshGeneration?: string;
  aster: V4SignedAsterSnapshot;
  runtime: V4DynamicRuntimeSnapshot;
}) {
  const sha = assertSha(input.sha);
  const now = input.now ?? Date.now();
  const capturedAt = capturedAtFor(now);
  const generation = String(input.refreshGeneration || `v4-dynamic-${sha}-${now}`).trim();
  if (!generation || generation.length > 160) throw new Error("V4_DYNAMIC_REFRESH_GENERATION_INVALID");
  const aster = input.aster;
  if (aster.signedGet !== true || aster.mutationCalls !== 0) throw new Error("V4_DYNAMIC_REFRESH_ASTER_READONLY_CONTRACT_FAILED");
  assertFinite(aster.serverTime, "aster.serverTime");
  if (!Array.isArray(aster.balances) || !Array.isArray(aster.positions) || !Array.isArray(aster.openOrders)) {
    throw new Error("V4_DYNAMIC_REFRESH_ASTER_SNAPSHOT_INVALID");
  }
  const { pendingCount } = assertHealthyRuntime(input.runtime);
  const positions = aster.positions.map(normalizePosition);
  const openOrders = aster.openOrders.map(normalizeOrder);
  const common = {
    status: "PASS",
    candidateSha: sha,
    capturedAt,
    refreshGeneration: generation,
    readOnly: true,
    signedGet: true,
    mutationCalls: 0,
    source: "ASTER_SIGNED_READONLY",
    venueServerTime: aster.serverTime,
  } as const;
  return {
    establishedAsterOrders: {
      ...common,
      schema: "disdex-v12-v4-evidence/established-orders-v2",
      positionCount: positions.length,
      openOrderCount: openOrders.length,
      positions,
      openOrders,
    },
    signedAsterAccount: {
      ...common,
      schema: "disdex-v12-v4-evidence/signed-account-v2",
      balances: aster.balances.map(normalizeBalance),
      positions,
      openOrders,
    },
    sharedRiskAndPeers: {
      status: "PASS",
      candidateSha: sha,
      capturedAt,
      refreshGeneration: generation,
      readOnly: true,
      signedGet: false,
      mutationCalls: 0,
      source: "ROOT_SHARED_RUNTIME_READONLY",
      sharedRiskHealthy: true,
      marginGuardHealthy: true,
      killSwitch: false,
      pendingCount,
      pendingExposureReconciled: true,
    },
  } as const;
}

export async function collectV4DynamicEvidence(input: {
  sha: string;
  client: Pick<AsterV3Client, "hasTradingCredentials" | "getServerTime" | "getBalances" | "getPositions" | "getOpenOrders">;
  runtime: V4DynamicRuntimeSnapshot;
  now?: number;
  refreshGeneration?: string;
}) {
  assertSha(input.sha);
  if (!input.client.hasTradingCredentials()) throw new Error("V4_DYNAMIC_REFRESH_CREDENTIALS_MISSING");
  // One bounded read round, in reconciliation order.  The client assigns
  // RECONCILIATION/RISK_READ priorities and readOnlyRateLimitMaxRetries is
  // explicitly disabled by the CLI; this helper never polls or retries.
  const serverTime = await input.client.getServerTime();
  const balances = await input.client.getBalances();
  const positions = await input.client.getPositions();
  const openOrders = await input.client.getOpenOrders();
  return buildV4DynamicEvidence({
    sha: input.sha,
    now: input.now,
    refreshGeneration: input.refreshGeneration,
    runtime: input.runtime,
    aster: {
      serverTime: Number(serverTime.serverTime),
      balances,
      positions,
      openOrders,
      signedGet: true,
      mutationCalls: 0,
    },
  });
}

export function buildV4DynamicRefreshPlan(input: {
  sha: string;
  staticPayloads: Record<string, unknown>;
  dynamicPayloads: Record<string, unknown>;
  now?: number;
}) {
  const sha = assertSha(input.sha);
  const now = input.now ?? Date.now();
  validateStaticReleaseEvidence({ sha, payloads: input.staticPayloads, now });
  const payloads = { ...input.staticPayloads, ...input.dynamicPayloads } as Record<EvidenceKey, unknown>;
  validateV4SharedExecutionEvidencePayloads(payloads, sha, now);
  const generation = String((input.dynamicPayloads[DYNAMIC_KEYS[0]] as JsonRecord)?.refreshGeneration || "");
  if (!generation || DYNAMIC_KEYS.some((key) => String((input.dynamicPayloads[key] as JsonRecord)?.refreshGeneration || "") !== generation)) {
    throw new Error("V4_DYNAMIC_REFRESH_GENERATION_MISMATCH");
  }
  return {
    status: "V4_DYNAMIC_EVIDENCE_REFRESH_PLAN_READY",
    sha,
    refreshedKeys: [...DYNAMIC_KEYS],
    staticKeys: [...STATIC_KEYS],
    refreshGeneration: generation,
    capturedAt: String((input.dynamicPayloads[DYNAMIC_KEYS[0]] as JsonRecord).capturedAt),
    readOnly: true,
    authorizesTrading: false,
    tradingEffects: { ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 },
  } as const;
}

async function readTrustedJson(path: string, requiredUid?: number): Promise<JsonRecord> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o022) !== 0) throw new Error(`V4_DYNAMIC_REFRESH_FILE_UNTRUSTED:${path}`);
  if (requiredUid !== undefined && stats.uid !== requiredUid) throw new Error(`V4_DYNAMIC_REFRESH_FILE_OWNER_INVALID:${path}`);
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BYTES) throw new Error(`V4_DYNAMIC_REFRESH_FILE_OVERSIZED:${path}`);
  return assertRecord(JSON.parse(raw), path);
}

async function assertTrustedDirectory(path: string, requiredUid = 0) {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory() || stats.uid !== requiredUid || (stats.mode & 0o022) !== 0) {
    throw new Error(`V4_DYNAMIC_REFRESH_DIRECTORY_UNTRUSTED:${path}`);
  }
}

async function readStaticPayloads(evidenceRoot: string) {
  const payloads: Record<string, unknown> = {};
  for (const key of EVIDENCE_KEYS) {
    payloads[key] = await readTrustedJson(join(evidenceRoot, evidenceFileName(key)), 0);
  }
  return payloads;
}

async function readRuntimeSnapshot() {
  return {
    sharedRisk: await readTrustedJson(process.env.DISDEX_V4_DYNAMIC_SHARED_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json"),
    marginGuard: await readTrustedJson(process.env.DISDEX_V4_DYNAMIC_MARGIN_PATH || "/var/lib/disdex/shared/margin-risk/guard-live.json"),
    killSwitch: await readTrustedJson(process.env.DISDEX_V4_DYNAMIC_KILL_SWITCH_PATH || "/var/lib/disdex/shared/kill-switch.json"),
    pendingExposure: await readTrustedJson(process.env.DISDEX_V4_DYNAMIC_PENDING_PATH || "/var/lib/disdex/shared/pending-exposure.json"),
  } satisfies V4DynamicRuntimeSnapshot;
}

async function assertReleaseMarker(releaseRoot: string, sha: string) {
  const resolvedRoot = await realpath(releaseRoot);
  if (resolve(resolvedRoot) !== resolve(releaseRoot) || !resolvedRoot.endsWith(`/${sha}`)) throw new Error("V4_DYNAMIC_REFRESH_RELEASE_ROOT_MISMATCH");
  const marker = (await readFile(join(resolvedRoot, ".disdex-release-sha"), "utf8")).trim().toLowerCase();
  if (marker !== sha) throw new Error("V4_DYNAMIC_REFRESH_RELEASE_MARKER_MISMATCH");
  return resolvedRoot;
}

async function stageJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  return temporary;
}

async function refreshDynamicFiles(input: {
  sha: string;
  releaseRoot: string;
  evidenceRoot: string;
  client: Pick<AsterV3Client, "hasTradingCredentials" | "getServerTime" | "getBalances" | "getPositions" | "getOpenOrders">;
  outputPath?: string;
  apply: boolean;
}) {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) throw new Error("V4_DYNAMIC_REFRESH_ROOT_REQUIRED");
  const sha = assertSha(input.sha);
  const releaseRoot = await assertReleaseMarker(input.releaseRoot, sha);
  await assertTrustedDirectory(input.evidenceRoot, 0);
  const current = await readStaticPayloads(input.evidenceRoot);
  const runtime = await readRuntimeSnapshot();
  const dynamic = await collectV4DynamicEvidence({ sha, client: input.client, runtime });
  const plan = buildV4DynamicRefreshPlan({ sha, staticPayloads: current, dynamicPayloads: dynamic });
  if (!input.apply) return { ...plan, status: "V4_DYNAMIC_EVIDENCE_REFRESH_DRY_RUN", releaseRoot, evidenceRoot: input.evidenceRoot } as const;

  const staged: Array<{ key: (typeof DYNAMIC_KEYS)[number]; path: string; temporary: string }> = [];
  const dynamicRecord = dynamic as Record<string, JsonRecord>;
  try {
    for (const key of DYNAMIC_KEYS) {
      const path = join(input.evidenceRoot, evidenceFileName(key));
      const existing = await readTrustedJson(path, 0);
      if (existing.candidateSha !== sha) throw new Error(`V4_DYNAMIC_REFRESH_TARGET_SHA_MISMATCH:${key}`);
      staged.push({ key, path, temporary: await stageJson(path, dynamicRecord[key]) });
    }
    // All payloads are validated and staged before the first target is
    // replaced.  A mixed generation is rejected by the runtime gate if the
    // host is interrupted between renames.
    for (const item of staged) await rename(item.temporary, item.path);
    for (const item of staged) {
      const readback = await readTrustedJson(item.path, 0);
      if (readback.refreshGeneration !== plan.refreshGeneration || readback.candidateSha !== sha) {
        throw new Error(`V4_DYNAMIC_REFRESH_READBACK_MISMATCH:${item.key}`);
      }
    }
  } catch (error) {
    for (const item of staged) await unlink(item.temporary).catch(() => undefined);
    throw error;
  }
  const applied = {
    ...plan,
    status: "V4_DYNAMIC_EVIDENCE_REFRESH_APPLIED",
    releaseRoot,
    evidenceRoot: input.evidenceRoot,
    evidenceSha256: Object.fromEntries(DYNAMIC_KEYS.map((key) => [key, createHash("sha256").update(JSON.stringify(dynamicRecord[key], null, 2) + "\n").digest("hex")])),
  } as const;
  if (input.outputPath) {
    const outputTemp = await stageJson(input.outputPath, applied);
    try { await rename(outputTemp, input.outputPath); } catch (error) { await unlink(outputTemp).catch(() => undefined); throw error; }
  }
  return applied;
}

function argValue(name: string, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function selfTest() {
  const sha = "a".repeat(40);
  const now = Date.parse("2026-10-30T00:00:00.000Z");
  const runtime: V4DynamicRuntimeSnapshot = {
    sharedRisk: { sourceComplete: true, tripped: false },
    marginGuard: { stage: "HEALTHY", ordersAllowed: true },
    killSwitch: { active: false },
    pendingExposure: { entries: [] },
  };
  const dynamic = buildV4DynamicEvidence({
    sha,
    now,
    runtime,
    aster: { serverTime: now, balances: [], positions: [], openOrders: [], signedGet: true, mutationCalls: 0 },
  });
  if (dynamic.sharedRiskAndPeers.pendingCount !== 0 || dynamic.signedAsterAccount.mutationCalls !== 0) throw new Error("V4_DYNAMIC_REFRESH_SELFTEST_FAILED");
  try { buildV4DynamicEvidence({ sha, now, runtime: { ...runtime, killSwitch: { active: true } }, aster: { serverTime: now, balances: [], positions: [], openOrders: [], signedGet: true, mutationCalls: 0 } }); throw new Error("V4_DYNAMIC_REFRESH_SELFTEST_ACCEPTED_KILL"); } catch (error) { if (!String(error).includes("KILL_SWITCH")) throw error; }
  console.log(JSON.stringify({ status: "V4_DYNAMIC_REFRESH_SELFTEST_PASS", readOnly: true, authorizesTrading: false, tradingEffects: { ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 } }));
}

async function main() {
  if (process.argv.includes("--self-test")) { selfTest(); return; }
  const sha = assertSha(argValue("--sha").toLowerCase());
  const releaseRoot = argValue("--release-root", `/home/deploy/disdex-trading/releases/${sha}`);
  const evidenceRoot = argValue("--evidence-root", "/etc/disdex/v12-v4-evidence");
  const outputPath = argValue("--output", "/var/lib/disdex/v12-v4/evidence-refresh-last.json");
  const client = new AsterV3Client({
    baseUrl: process.env.ASTER_FUTURES_BASE_URL,
    userAddress: process.env.ASTER_USER_ADDRESS,
    privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
    requestTimeoutMs: Number(process.env.ASTER_REQUEST_TIMEOUT_MS || 10_000),
    recvWindowMs: Number(process.env.ASTER_RECV_WINDOW_MS || 5_000),
    readOnlyRateLimitMaxRetries: 0,
    userAgent: "DisDex-V4-Dynamic-Evidence-Refresh/1.0",
  });
  const result = await refreshDynamicFiles({ sha, releaseRoot, evidenceRoot, client, outputPath, apply: process.argv.includes("--apply") });
  console.log(JSON.stringify(result));
}

if (process.argv[1]?.endsWith("disdex-v4-dynamic-evidence-refresh.ts")) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "V4_DYNAMIC_EVIDENCE_REFRESH_BLOCKED", reason: error instanceof Error ? error.message : String(error), readOnly: true, authorizesTrading: false, tradingEffects: { ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 } }));
    process.exitCode = 1;
  });
}
