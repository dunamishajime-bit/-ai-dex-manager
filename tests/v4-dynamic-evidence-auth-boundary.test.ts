import assert from "node:assert/strict";
import test from "node:test";
import {
  parseV4DynamicRefreshArgs,
  validateV4RefreshLease,
  V4_DYNAMIC_REFRESH_SCOPE,
} from "../scripts/ops/root/disdex-v4-dynamic-evidence-refresh";

const SHA = "a".repeat(40);
const PLAN = "b".repeat(64);
const NOW = Date.parse("2026-10-30T00:00:00.000Z");
const OUTPUT = "/var/lib/disdex/v12-v4/evidence-refresh-last.json";

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
    approvalNonceDigest: "c".repeat(64),
    approvalIssuedAt: NOW - 120_000,
    approvalExpiresAt: NOW - 60_000,
    approvedAt: NOW - 60_000,
    expiresAt: NOW + 23 * 60 * 60 * 1000,
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
  assert.throws(() => validateV4RefreshLease({ lease: lease({ signatureVerified: false }), sha: SHA, now: NOW }), /SIGNATURE_NOT_VERIFIED/);
  assert.throws(() => validateV4RefreshLease({ lease: lease({ expiresAt: NOW - 1 }), sha: SHA, now: NOW }), /EXPIRED/);
  assert.throws(() => validateV4RefreshLease({ lease: lease({ outputPath: "/etc/shadow" }), sha: SHA, now: NOW }), /OUTPUT_PATH_MISMATCH/);
});
