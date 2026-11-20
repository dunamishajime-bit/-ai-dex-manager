import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("redis-backed deployment approvals use CAS instead of disabling atomic mutations", () => {
  const store = fs.readFileSync("lib/server/deploy-approval-store.ts", "utf8");
  assert.doesNotMatch(store, /TASK_CLAIMS_REQUIRE_ATOMIC_STORAGE/);
  assert.match(store, /redisApprovalCompareAndSwap/);
});

test("redis approval records outlive the monitor-only retry window", () => {
  const source = fs.readFileSync("lib/server/deploy-approval-redis-cas.ts", "utf8");
  assert.match(source, /REDIS_APPROVAL_TTL_SECONDS\s*=\s*26\s*\*\s*60\s*\*\s*60/);
});
