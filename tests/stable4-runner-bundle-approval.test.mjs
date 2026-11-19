import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const token = fs.readFileSync("lib/deploy-approval-token.ts", "utf8");
const route = fs.readFileSync("app/api/system/deploy-approval/route.ts", "utf8");
const workflow = fs.readFileSync(".github/workflows/disdex-v4-hp-approval-request.yml", "utf8");
const bundle = fs.readFileSync("lib/stable4-runner-bundle.ts", "utf8");

test("bundle approval is a distinct exact six-runner operation", () => {
  assert.match(token, /STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE/);
  assert.match(token, /STABLE4_SCOPED_RUNNERS/);
  assert.match(token, /STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE:[\s\S]*?ordersEnabled:\s*true/);
  assert.match(route, /STABLE4_RUNNER_BUNDLE_SOURCE_SHA/);
  assert.match(route, /STABLE4_RUNNER_BUNDLE_PLAN_SHA256/);
  assert.match(route, /STABLE4 runner bundle exact source or manifest mismatch/);
});

test("HP request grammar accepts one bundle command and leaves HYPE separate", () => {
  assert.match(workflow, /DISDEX_PROTECTED_REQUEST STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE/);
  assert.match(workflow, /operation = "STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE"/);
  assert.match(workflow, /scope = "STABLE4_SCOPED_RUNNERS"/);
  assert.match(workflow, /orders_enabled = "true"/);
  assert.match(workflow, /STABLE4_RUNNER_BUNDLE_EXACT_SOURCE_AND_MANIFEST_REQUIRED/);
  assert.match(bundle, /HYPE.*intentionally absent/);
});
