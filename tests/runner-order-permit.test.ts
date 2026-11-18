import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  RUNNER_ORDER_PERMIT_SCHEMA,
  validateRunnerOrderPermit,
  type RunnerOrderPermit,
} from "../lib/runner-order-permit";

const SOURCE = "1657e173d250ad58f53e62f7bb0a3428fb405496";
const PLAN = "a".repeat(64);
const KILL = "b".repeat(64);
const NONCE = "c".repeat(64);
const now = 1_800_000_000_000;
const APPROVAL = "5ad3c5a3-0833-4d27-bd05-f057ca434efa";

function permit(overrides: Partial<RunnerOrderPermit> = {}): RunnerOrderPermit {
  return {
    schema: RUNNER_ORDER_PERMIT_SCHEMA,
    approvedSha: SOURCE,
    planSha256: PLAN,
    deploymentTarget: "professional-dismanager.net",
    operation: "PENGU_V8_SCOPED_ORDER_ENABLE",
    scope: "PENGU_V8",
    runner: "PENGU_V8",
    policy: "STABLE4_SCOPED_HOLD_BYPASS",
    ordersEnabled: true,
    killSwitchPath: "/var/lib/disdex/shared/kill-switch.json",
    killSwitchSha256: KILL,
    approvalId: APPROVAL,
    approvalNonceSha256: NONCE,
    issuedAt: now - 10_000,
    expiresAt: now + 86_400_000,
    operator: "disdex-runner-scoped-order-enable",
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
  reason: `STABLE4_RESEARCH_ROLLOUT:${SOURCE}`,
};

const context = {
  sourceSha: SOURCE,
  planSha256: PLAN,
  runner: "PENGU_V8" as const,
  scope: "PENGU_V8" as const,
  operation: "PENGU_V8_SCOPED_ORDER_ENABLE" as const,
  approvalId: APPROVAL,
  killSwitchSha256: KILL,
  now,
  killSwitch: hold,
};

test("accepts an exact Runner-scoped permit under the protected GLOBAL HOLD", () => {
  assert.equal(validateRunnerOrderPermit(permit(), context).runner, "PENGU_V8");
});

test("rejects wrong Runner, scope, operation, source, plan, expiry and mutation counters", () => {
  const checks: Array<Partial<RunnerOrderPermit>> = [
    { runner: "V52" },
    { scope: "FULL_PROJECT" },
    { operation: "ALL_RUNNERS_ORDER_ENABLE" },
    { approvedSha: "d".repeat(40) },
    { planSha256: "e".repeat(64) },
    { expiresAt: now },
    { ordersSent: 1 },
  ];
  for (const diff of checks) assert.throws(() => validateRunnerOrderPermit(permit(diff), context));
});

test("rejects inactive, non-GLOBAL, wrong-provenance or changed HOLD", () => {
  for (const killSwitch of [
    { ...hold, active: false },
    { ...hold, scope: "V52_REFERENCE_ONLY" as const },
    { ...hold, action: "FLATTEN_MANAGED" as const },
    { ...hold, strategyId: "OTHER" },
    { ...hold, reason: "OTHER" },
  ]) {
    assert.throws(() => validateRunnerOrderPermit(permit(), { ...context, killSwitch }));
  }
});

test("does not accept the FULL_PROJECT scope or HYPE operation", () => {
  assert.throws(() => validateRunnerOrderPermit(permit({ scope: "FULL_PROJECT" }), context));
  assert.throws(() => validateRunnerOrderPermit(permit({ operation: "HYPE_STABLE4_H48_TIME_ONLY_LIVE" }), context));
});
