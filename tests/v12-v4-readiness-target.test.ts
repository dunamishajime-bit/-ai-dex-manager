import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("full-live readiness targets the V4 policy, not the unrelated DD1296 portfolio", async () => {
  const readiness = JSON.parse(await readFile("docs/production/v12-v4-implementation-readiness.json", "utf8"));

  assert.equal(readiness.target, "V12_V4_V2_M150_D05_CORE_NATIVE");
  assert.equal(readiness.canonicalTarget, "docs/implementation/V12_V4_V2_M150_PRODUCTION_GATE_20261009.md");
  assert.equal(readiness.status, "BLOCKED");
  assert.equal(readiness.ordersEnabled, false);
  assert.deepEqual(readiness.blockers, ["OPERATOR_LIVE_ACTIVATION_REQUIRED"]);
});
