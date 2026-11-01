import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const hp = fs.readFileSync(".github/workflows/disdex-v4-hp-approval-request.yml", "utf8");
const doge = fs.readFileSync(".github/workflows/disdex-v4-doge-missed-time-exit-approval-request.yml", "utf8");
const route = fs.readFileSync("app/api/system/deploy-approval/route.ts", "utf8");

test("legacy approval workflows never write the JSON store directly", () => {
  for (const source of [hp, doge]) {
    assert.doesNotMatch(source, /deploy-approvals\.json/);
    assert.doesNotMatch(source, /json\.dump\s*\(\s*records/);
    assert.doesNotMatch(source, /os\.replace\s*\([^\n]*deploy-approvals/);
  }
});

test("general HP request publishes only through authenticated approval API", () => {
  assert.match(hp, /DISDEX_HP_APPROVAL_BRIDGE_SECRET/);
  assert.match(hp, /https:\/\/professional-dismanager\.net\/api\/system\/deploy-approval/);
  assert.match(hp, /"action": "publish"/);
  assert.match(hp, /APPROVAL_ORDER_PERMISSION_MISMATCH/);
});

test("retired protected DOGE request remains fail closed after manual flat settlement", () => {
  assert.match(doge, /DOGE_PROTECTED_POSITION_PLAN_RETIRED_MANUAL_FLAT=TRUE/);
  assert.match(doge, /REQUIRES_NEW_FLAT_STATE_PLAN_AND_SCOPE=TRUE/);
  assert.match(doge, /exit 1/);
});

test("redeem uses the atomic store mutation and does not do read-then-save", () => {
  const redeem = route.split('if (body?.action === "redeem")')[1] ?? "";
  assert.match(redeem, /mutateDeploymentApprovalAtomic\(approvalId/);
  assert.doesNotMatch(redeem, /saveDeploymentApproval\(/);
  assert.match(redeem, /APPROVAL_ALREADY_REDEEMED/);
  assert.match(redeem, /APPROVAL_IDENTITY_MISMATCH/);
  assert.match(redeem, /APPROVAL_TOKEN_EXPIRED/);
});
