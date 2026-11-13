import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("redis-backed deployment approvals use CAS instead of disabling atomic mutations", () => {
  const store = fs.readFileSync("lib/server/deploy-approval-store.ts", "utf8");
  assert.doesNotMatch(store, /TASK_CLAIMS_REQUIRE_ATOMIC_STORAGE/);
  assert.match(store, /redisApprovalCompareAndSwap/);
});
