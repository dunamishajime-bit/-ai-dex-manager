import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("single approval redeem uses atomic mutation rather than read then save",()=>{
  const src=fs.readFileSync("app/api/system/deploy-approval/route.ts","utf8");
  const start=src.indexOf('if (body?.action === "redeem")');
  assert.ok(start>=0);
  const tail=src.slice(start);
  assert.match(tail,/mutateDeploymentApprovalAtomic\(approvalId/);
  assert.doesNotMatch(tail,/const record = await getDeploymentApproval\(approvalId\)/);
  assert.doesNotMatch(tail,/const redeemed = await saveDeploymentApproval/);
});
