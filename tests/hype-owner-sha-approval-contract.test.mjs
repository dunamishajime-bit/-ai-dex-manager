import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const tokens = fs.readFileSync("lib/deploy-approval-token.ts","utf8");
const publish = fs.readFileSync(".github/workflows/disdex-v4-hp-approval-request.yml","utf8");
const route = fs.readFileSync("app/api/system/deploy-approval/route.ts","utf8");
const approval = fs.readFileSync("app/api/production-approval/route.ts","utf8");

const target="a7eee1f91d86d51f2333da117243d044ae1332dc";
const old="d6bcc94512a6416189cd92d7203b9ac3b2c98e70";
const stop="v12-v4-231ed20b6835c4148b5314d8da7e";

test("dedicated HYPE SHA recovery is exact runner scope and independent order-enabled approval",()=>{
  assert.match(tokens,/HYPE_TREND_LONG_SHA_RESTORE:\s*\{\s*scope:\s*"HYPE_TREND_LONG",\s*ordersEnabled:\s*true/);
  assert.match(tokens,/HYPE_TREND_LONG_SHA_RESTORE/);
  assert.match(tokens,/ALL_RUNNERS_LIVE_RESTORE:\s*\{\s*scope:\s*"FULL_PROJECT",\s*ordersEnabled:\s*false/);
});

test("GitHub request is only accepted for owner comment on exact reviewed HYPE SHA",()=>{
  assert.match(publish,/github\.actor == 'dunamishajime-bit'/);
  assert.match(publish,/github\.event\.comment\.author_association == 'OWNER'/);
  assert.match(publish,/github\.event\.issue\.number == 317/);
  assert.match(publish,/environment:\s*\n\s+name:\s*disdex-production/);
  assert.ok(publish.includes("DISDEX_PROTECTED_REQUEST HYPE_TREND_LONG_SHA_RESTORE SHA="));
  assert.ok(publish.includes('target != "'+target+'"'));
  assert.ok(publish.includes(old));
  assert.ok(publish.includes(stop));
  assert.match(publish,/operation = "HYPE_TREND_LONG_SHA_RESTORE"[\s\S]*?scope = "HYPE_TREND_LONG"[\s\S]*?orders_enabled = "true"/);
  assert.match(publish,/plan = hashlib\.sha256\(context\.encode\("ascii"\)\)\.hexdigest\(\)/);
});

test("HP still requires server-side OTP and signed owner token for the target plan",()=>{
  assert.match(route,/action === "publish"/);
  assert.match(route,/policy\.scope/);
  assert.match(route,/operation policy mismatch/);
  assert.match(approval,/createOtpChallenge/);
  assert.match(approval,/consumeOtpChallenge/);
  assert.match(approval,/issueDeploymentApprovalToken/);
  assert.match(approval,/scope:\s*policy\.scope/);
  assert.match(approval,/ordersEnabled:\s*policy\.ordersEnabled/);
});

test("no unapproved production cutover is introduced by the request workflow",()=>{
  assert.doesNotMatch(publish,/systemctl\s+(start|restart)/);
  assert.doesNotMatch(publish,/ordersSent:\s*[1-9]/);
  assert.doesNotMatch(publish,/--orders-enabled false.*HYPE_TREND_LONG_SHA_RESTORE/);
});
