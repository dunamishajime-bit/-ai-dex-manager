import assert from "node:assert/strict";

import { classifyPenguFailures } from "../lib/server/pengu-runtime-observability";

const alignmentFailure = {
  occurredAt: 1,
  message: "PENGU/BTC H1 timestamps are not fully aligned: PENGU=1000, BTC=999, aligned=999.",
};
const otherFailure = { occurredAt: 2, message: "shared risk state is stale" };

const resolved = classifyPenguFailures([alignmentFailure, otherFailure], 2000, 2000);
assert.deepEqual(resolved.active, [otherFailure]);
assert.deepEqual(resolved.resolved, [alignmentFailure]);

const stillBlocked = classifyPenguFailures([alignmentFailure], 2000, 1999);
assert.deepEqual(stillBlocked.active, [alignmentFailure]);
assert.deepEqual(stillBlocked.resolved, []);

console.log("PENGU_RUNTIME_OBSERVABILITY_SELFTEST_PASS");
