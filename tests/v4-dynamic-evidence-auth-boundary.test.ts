import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assertHealthyV4DynamicRuntime,
  assertV4RefreshRateBudget,
  parseV4DynamicRefreshArgs,
  validateV4RefreshLease,
  V4_DYNAMIC_REFRESH_SCOPE,
} from "../scripts/ops/root/disdex-v4-dynamic-evidence-refresh";

const SHA = "a".repeat(40);
const PLAN = "b".repeat(64);
const NOW = Math.floor(Date.parse("2026-10-30T00:00:00.000Z") / 1000);
const OUTPUT = "/var/lib/disdex/unified-deploy/v4-evidence/evidence-refresh-last.json";

test("refresh requires the production shared API rate budget", () => {
  const socket=`/run/disdex-v4-budget-${SHA}/budget.sock`;
  assert.doesNotThrow(() => assertV4RefreshRateBudget("/var/lib/disdex/shared/aster-rate-budget.json",socket,SHA));
  for (const path of [undefined, "", "/tmp/other.json"]) {
    assert.throws(() => assertV4RefreshRateBudget(path,socket,SHA), /RATE_BUDGET_REQUIRED/);
  }
  assert.throws(()=>assertV4RefreshRateBudget("/var/lib/disdex/shared/aster-rate-budget.json",undefined,SHA),/PROXY_REQUIRED/);
});

test("refresh CLI uses the GET-only evidence transport", () => {
  const source=readFileSync("scripts/ops/root/disdex-v4-dynamic-evidence-refresh.ts", "utf8");
  assert.match(source,/fetchImpl:\s*createV4EvidenceFetch\(fetch\)/);
});

function lease(overrides: Record<string, unknown> = {}) {
  return {
    schema: "disdex-v4-evidence-refresh-lease/v1",
    repository: "dunamishajime-bit/-ai-dex-manager",
    deploymentTarget: "professional-dismanager.net",
    operatorTarget: "DD1296_FINAL_ALLIN_10BPS",
    scope: V4_DYNAMIC_REFRESH_SCOPE,
    route: "CODEX_SSH",
    approvedSha: SHA,
    approvedRunner: "V12_V4",
    approvedRunners: ["V12_V4"],
    approvedShaByRunner: { V12_V4: SHA },
    releaseRoot: `/home/deploy/disdex-trading/releases/${SHA}`,
    evidenceRoot: "/etc/disdex/v12-v4-evidence",
    outputPath: OUTPUT,
    planSha256: PLAN,
    ordersEnabled: false,
    signatureVerified: true,
    authorizationMethod: "OWNER_SIGNED_TOKEN",
    approvalNonceDigest: "c".repeat(64),
    approvalIssuedAt: NOW - 120,
    approvalExpiresAt: NOW - 60,
    approvedAt: NOW - 60,
    expiresAt: NOW + 23 * 60 * 60,
    leaseId: "d".repeat(32),
    ...overrides,
  };
}

test("refresh CLI requires exactly one explicit mode", () => {
  assert.equal(parseV4DynamicRefreshArgs(["--sha", SHA, "--verify-only"]).mode, "verify-only");
  assert.equal(parseV4DynamicRefreshArgs(["--sha", SHA, "--apply"]).mode, "apply");
  assert.throws(() => parseV4DynamicRefreshArgs(["--sha", SHA]), /MODE_REQUIRED/);
  assert.throws(() => parseV4DynamicRefreshArgs(["--sha", SHA, "--apply", "--verify-only"]), /MODE_CONFLICT/);
  assert.throws(() => parseV4DynamicRefreshArgs(["--sha", SHA, "--apply", "--unknown"]), /ARG_UNKNOWN/);
});

test("refresh CLI rejects duplicate and missing values", () => {
  assert.throws(() => parseV4DynamicRefreshArgs(["--sha", SHA, "--sha", SHA, "--verify-only"]), /ARG_DUPLICATE/);
  assert.throws(() => parseV4DynamicRefreshArgs(["--sha", "--verify-only"]), /ARG_VALUE_REQUIRED/);
  assert.throws(() => parseV4DynamicRefreshArgs(["--sha", "x", "--verify-only"]), /SHA_INVALID/);
});

test("refresh lease is limited to V4 evidence and never authorizes orders", () => {
  assert.equal(validateV4RefreshLease({ lease: lease(), sha: SHA, now: NOW }).scope, V4_DYNAMIC_REFRESH_SCOPE);
  assert.throws(() => validateV4RefreshLease({ lease: lease({ scope: "FULL_PROJECT" }), sha: SHA, now: NOW }), /SCOPE_MISMATCH/);
  assert.throws(() => validateV4RefreshLease({ lease: lease({ approvedSha: "e".repeat(40) }), sha: SHA, now: NOW }), /SHA_MISMATCH/);
  assert.throws(() => validateV4RefreshLease({ lease: lease({ ordersEnabled: true }), sha: SHA, now: NOW }), /ORDERS_NOT_ALLOWED/);
  assert.throws(() => validateV4RefreshLease({ lease: lease({ signatureVerified: false }), sha: SHA, now: NOW }), /AUTHORIZATION_NOT_VERIFIED/);
  assert.throws(() => validateV4RefreshLease({ lease: lease({ expiresAt: NOW - 1 }), sha: SHA, now: NOW }), /EXPIRED/);
  assert.throws(() => validateV4RefreshLease({ lease: lease({ outputPath: "/etc/shadow" }), sha: SHA, now: NOW }), /OUTPUT_PATH_MISMATCH/);
});

test("Codex SSH refresh lease uses root-session authorization without a signature", () => {
  const value = lease({
    signatureVerified: false,
    authorizationMethod: "ROOT_SSH_SESSION",
  });
  assert.equal(validateV4RefreshLease({ lease: value, sha: SHA, now: NOW }).route, "CODEX_SSH");
});

test("the 30-day lease boundary does not extend the five-minute approval window", () => {
  const long = lease({approvedAt: NOW, expiresAt: NOW + 30 * 86400});
  assert.equal(validateV4RefreshLease({lease: long, sha: SHA, now: NOW}).expiresAt, long.expiresAt);
  assert.throws(() => validateV4RefreshLease({lease: {...long, expiresAt: Number(long.expiresAt) + 1}, sha: SHA, now: NOW}), /EXPIRED/);
  assert.throws(() => validateV4RefreshLease({lease: {...long, approvalExpiresAt: Number(long.approvalIssuedAt) + 301}, sha: SHA, now: NOW}), /EXPIRED/);
});

test("runtime refresh leases use Unix seconds while evidence timestamps use milliseconds", () => {
  const now = Math.floor(Date.now() / 1000);
  const value = lease({
    signatureVerified: false,
    authorizationMethod: "ROOT_SSH_SESSION",
    approvalIssuedAt: now - 120,
    approvalExpiresAt: now - 60,
    approvedAt: now - 60,
    expiresAt: now + 23 * 60 * 60,
  });
  assert.equal(validateV4RefreshLease({ lease: value, sha: SHA }).expiresAt, value.expiresAt);
});


function healthyRuntime(now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  return {
    sharedRisk: { sourceComplete: true, tripped: false, utcDay: day, updatedAt: now - 1_000, maximumLossPct: 7.5 },
    marginGuard: { stage: "HEALTHY", ordersAllowed: true, checkedAt: now - 2_000 },
    killSwitch: { active: false },
    pendingExposure: {
      schema: "disdex-pending-exposure/v1",
      accountScope: "ASTER_FUTURES",
      updatedAt: now - 3_000,
      entries: [{ status: "RELEASED" }],
    },
  };
}

test("dynamic refresh requires the exact 7.5 percent shared risk limit", () => {
  const now = Date.parse("2026-11-02T12:00:00.000Z");
  for (const value of [undefined, null, 0, 7.6, 8, "NaN"]) {
    assert.throws(() => assertHealthyV4DynamicRuntime({
      ...healthyRuntime(now),
      sharedRisk: { ...healthyRuntime(now).sharedRisk, maximumLossPct: value },
    }, now), /SHARED_RISK_LIMIT/);
  }
});

test("dynamic refresh rejects stale shared runtime instead of re-stamping it", () => {
  const now = Date.parse("2026-11-02T12:00:00.000Z");
  assert.deepEqual(assertHealthyV4DynamicRuntime(healthyRuntime(now), now), { pendingCount: 0 });
  assert.throws(
    () => assertHealthyV4DynamicRuntime({
      ...healthyRuntime(now),
      sharedRisk: { ...healthyRuntime(now).sharedRisk, updatedAt: now - 15 * 60_000 - 1 },
    }, now),
    /SHARED_RISK_STALE/,
  );
  assert.throws(
    () => assertHealthyV4DynamicRuntime({
      ...healthyRuntime(now),
      marginGuard: { ...healthyRuntime(now).marginGuard, checkedAt: now - 15 * 60_000 - 1 },
    }, now),
    /MARGIN_GUARD_STALE/,
  );
  assert.throws(
    () => assertHealthyV4DynamicRuntime({
      ...healthyRuntime(now),
      pendingExposure: { ...healthyRuntime(now).pendingExposure, updatedAt: now - 15 * 60_000 - 1 },
    }, now),
    /PENDING_EXPOSURE_STALE/,
  );
});

test("dynamic refresh rejects wrong-day risk, unproven kill state and active pending", () => {
  const now = Date.parse("2026-11-02T12:00:00.000Z");
  assert.throws(
    () => assertHealthyV4DynamicRuntime({
      ...healthyRuntime(now),
      sharedRisk: { ...healthyRuntime(now).sharedRisk, utcDay: "2026-11-01" },
    }, now),
    /WRONG_UTC_DAY/,
  );
  assert.throws(
    () => assertHealthyV4DynamicRuntime({ ...healthyRuntime(now), killSwitch: {} }, now),
    /KILL_SWITCH_NOT_PROVEN_INACTIVE/,
  );
  assert.throws(
    () => assertHealthyV4DynamicRuntime({
      ...healthyRuntime(now),
      pendingExposure: {
        ...healthyRuntime(now).pendingExposure,
        entries: [{ status: "PENDING" }],
      },
    }, now),
    /PENDING_EXPOSURE_NOT_EMPTY:1/,
  );
});
