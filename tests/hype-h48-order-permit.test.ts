import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  HYPE_H48_ORDER_PERMIT_SCHEMA,
  validateHypeH48OrderPermit,
  type HypeH48OrderPermit,
} from "../lib/hype-h48-order-permit";

const SOURCE = "4786f600ae7bf86ffca948f1412956a9113cb20d";
const PLAN = "8af6e4eb73e53f63f7f7d441f171176cc420090a8ab29faaacf4f01427a3822d";
const CERT = "a".repeat(64);
const KILL = "b".repeat(64);
const NONCE = "c".repeat(64);
const now = 1_800_000_000_000;

function permit(overrides: Partial<HypeH48OrderPermit> = {}): HypeH48OrderPermit {
  return {
    schema: HYPE_H48_ORDER_PERMIT_SCHEMA,
    approvedSha: SOURCE,
    planSha256: PLAN,
    deploymentTarget: "professional-dismanager.net",
    operation: "HYPE_STABLE4_H48_TIME_ONLY_LIVE",
    scope: "HYPE_TREND_LONG",
    runner: "HYPE_TREND_LONG",
    policy: "H48_TIME_ONLY",
    ordersEnabled: true,
    killSwitchPath: "/var/lib/disdex/shared/kill-switch.json",
    killSwitchSha256: KILL,
    certificateSha256: CERT,
    approvalId: "5ad3c5a3-0833-4d27-bd05-f057ca434efa",
    approvalNonceSha256: NONCE,
    issuedAt: now - 10_000,
    expiresAt: now + 86_400_000,
    operator: "disdex-stable4-h48-order-enable",
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    ...overrides,
  };
}

const hold = {
  active: true,
  action: "HOLD_PROTECTED" as const,
  scope: "GLOBAL" as const,
  operator: "disdex-stable4-formal-owner-hold",
  strategyId: "STABLE4_H48_CUTOVER",
  reason: "STABLE4_RESEARCH_ROLLOUT:e0e4f1d8f22b62e9410188ef6e590a20e31f760f",
};

test("valid HYPE H48 permit is accepted only under the exact protected GLOBAL HOLD", () => {
  assert.deepEqual(
    validateHypeH48OrderPermit(permit(), {
      sourceSha: SOURCE,
      planSha256: PLAN,
      certificateSha256: CERT,
      killSwitchSha256: KILL,
      approvalId: permit().approvalId,
      now,
      killSwitch: hold,
    }),
    permit(),
  );
});

test("permit rejects wrong runner, source, plan, expiry, mutation counters and HOLD digest", () => {
  const checks: Array<Record<string, unknown>> = [
    { runner: "PENGU_V8" },
    { approvedSha: "d".repeat(40) },
    { planSha256: "e".repeat(64) },
    { expiresAt: now },
    { ordersSent: 1 },
    { killSwitchSha256: "f".repeat(64) },
  ];
  for (const diff of checks) {
    assert.throws(() => validateHypeH48OrderPermit(permit(diff as Partial<HypeH48OrderPermit>), {
      sourceSha: SOURCE,
      planSha256: PLAN,
      certificateSha256: CERT,
      killSwitchSha256: KILL,
      approvalId: permit().approvalId,
      now,
      killSwitch: hold,
    }));
  }
});

test("permit is fail-closed for inactive, non-GLOBAL or non-protected HOLD", () => {
  for (const killSwitch of [
    { ...hold, active: false },
    { ...hold, scope: "V52_REFERENCE_ONLY" as const },
    { ...hold, action: "FLATTEN_MANAGED" as const },
    { ...hold, strategyId: "OTHER" },
  ]) {
    assert.throws(() => validateHypeH48OrderPermit(permit(), {
      sourceSha: SOURCE,
      planSha256: PLAN,
      certificateSha256: CERT,
      killSwitchSha256: KILL,
      approvalId: permit().approvalId,
      now,
      killSwitch,
    }));
  }
});

test("permit requires the exact HYPE operation and no trading mutations", () => {
  for (const diff of [
    { operation: "ALL_RUNNERS_ORDER_ENABLE" },
    { scope: "FULL_PROJECT" },
    { policy: "TREND" },
    { ordersEnabled: false },
    { cancelsSent: 1 },
    { positionChangesSent: 1 },
  ]) {
    assert.throws(() => validateHypeH48OrderPermit(permit(diff as Partial<HypeH48OrderPermit>), {
      sourceSha: SOURCE,
      planSha256: PLAN,
      certificateSha256: CERT,
      killSwitchSha256: KILL,
      approvalId: permit().approvalId,
      now,
      killSwitch: hold,
    }));
  }
});

