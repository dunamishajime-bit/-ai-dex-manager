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


test("goal approval index persists independently of the 50-item UI history and is revoked atomically", () => {
  const redis = fs.readFileSync("lib/server/deploy-approval-redis-cas.ts", "utf8");
  const store = fs.readFileSync("lib/server/deploy-approval-store.ts", "utf8");
  assert.match(redis, /persistentRecord\?: boolean/);
  assert.match(redis, /goalIndexKey\?: string/);
  assert.match(redis, /ARGV\[9\]/);
  assert.match(redis, /ARGV\[10\]/);
  assert.match(redis, /redis\.call\("DEL", KEYS\[4\]\)/);
  assert.match(store, /GOAL_INDEX_PREFIX/);
  assert.match(store, /getDeploymentApproval\(id\)/);
  assert.match(store, /createPendingOwnerGoal/);
  assert.match(store, /goalActive:/);
});
