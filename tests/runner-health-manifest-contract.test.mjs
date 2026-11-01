import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("runner-health API is manifest-pinned and has no common-SHA fallback",()=>{
  const src=fs.readFileSync("app/api/system/runner-health/route.ts","utf8");
  assert.match(src,/loadRunnerPinManifest/);
  assert.doesNotMatch(src,/COMMON_RUNTIME_RELEASE/);
  assert.doesNotMatch(src,/return \{ sha: commonSha/);
  assert.match(src,/RUNNER_PIN_MANIFEST/);
});
