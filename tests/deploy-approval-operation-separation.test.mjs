import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const token = fs.readFileSync("lib/deploy-approval-token.ts", "utf8");
const task = fs.readFileSync("lib/deploy-all-runners-task.ts", "utf8");
const request = fs.readFileSync(".github/workflows/disdex-all-runners-live-task-approval-request.yml", "utf8");
const resume = fs.readFileSync(".github/workflows/disdex-allrunner-v4-idle-live-resume.yml", "utf8");
const hype = fs.readFileSync(".github/workflows/disdex-hype-v4-stop-overlay-hotfix.yml", "utf8");
const finalVerify = fs.readFileSync(".github/workflows/disdex-allrunner-final-verifications.yml", "utf8");

test("approval operations separate monitoring, runner enablement, shared-risk writer and global order enable", () => {
  for (const operation of [
    "ALL_RUNNERS_MONITOR_REFRESH",
    "V12_V4_LIVE",
    "PENGU_V8_LIVE",
    "SHARED_CRYPTO_RISK_WRITER",
    "ALL_RUNNERS_LIVE_RESTORE",
    "ALL_RUNNERS_ORDER_ENABLE",
  ]) assert.ok(token.includes(operation), operation);

  assert.match(token, /ALL_RUNNERS_MONITOR_REFRESH:[\s\S]*?scope:\s*"FULL_PROJECT"[\s\S]*?ordersEnabled:\s*false/);
  assert.match(token, /PENGU_V8_LIVE:[\s\S]*?scope:\s*"PENGU_V8"[\s\S]*?ordersEnabled:\s*true/);
  assert.match(token, /SHARED_CRYPTO_RISK_WRITER:[\s\S]*?scope:\s*"SHARED_CRYPTO_RISK_ONLY"[\s\S]*?ordersEnabled:\s*false/);
  assert.match(token, /ALL_RUNNERS_LIVE_RESTORE:[\s\S]*?scope:\s*"FULL_PROJECT"[\s\S]*?ordersEnabled:\s*false/);
  assert.match(token, /ALL_RUNNERS_ORDER_ENABLE:[\s\S]*?scope:\s*"FULL_PROJECT"[\s\S]*?ordersEnabled:\s*true/);
});

test("all-runner restore task is monitor-only and cannot mint an order-enabled child claim", () => {
  assert.match(task, /taskOrdersEnabled\s*===\s*false/);
  const stepEntries = [...task.matchAll(/^[ \t]+[A-Z0-9_]+:\s*\{[^\n]+ordersEnabled:\s*(true|false)[^\n]*\}/gm)];
  assert.ok(stepEntries.length >= 8);
  assert.equal(stepEntries.filter((match) => match[1] === "true").length, 0);
});

test("all-runner restore workflows verify and forward orders=false only", () => {
  assert.match(request, /approval\.get\("ordersEnabled"\)\s+is\s+False/);
  assert.doesNotMatch(request, /approval\.get\("ordersEnabled"\)\s+is\s+True/);

  for (const source of [resume, hype]) {
    assert.match(source, /data\.get\("ordersEnabled"\)\s+is\s+False/);
    assert.match(source, /--orders-enabled false/);
    assert.doesNotMatch(source, /--orders-enabled true/);
  }

  for (const runner of ["PENGU_LIVE_VERIFY", "Q102_LIVE_VERIFY", "FET_LIVE_VERIFY"]) {
    const index = finalVerify.indexOf(runner + ")");
    assert.ok(index >= 0, runner);
    assert.match(finalVerify.slice(index, index + 500), /orders=false/);
  }
});


test("all-runner pending approval reuse is monitor-only and admin signing is policy-bound", () => {
  const store = fs.readFileSync("lib/server/deploy-approval-store.ts", "utf8");
  assert.match(store, /current\.ordersEnabled\s*===\s*false/);
  assert.match(store, /input\.ordersEnabled\s*===\s*false/);

  const admin = fs.readFileSync("app/api/admin/deploy-approval/route.ts", "utf8");
  assert.match(admin, /DEPLOY_APPROVAL_OPERATION_POLICY/);
  assert.match(admin, /current\.scope\s*!==\s*policy\.scope/);
  assert.match(admin, /current\.ordersEnabled\s*!==\s*policy\.ordersEnabled/);
  assert.match(admin, /scope:\s*policy\.scope/);
  assert.match(admin, /ordersEnabled:\s*policy\.ordersEnabled/);
});


test("formal HP request workflow exposes each separated approval operation with fixed scope/order policy", () => {
  const source = fs.readFileSync(".github/workflows/disdex-v4-hp-approval-request.yml", "utf8");
  assert.match(source, /environment:\s*\n\s+name:\s*disdex-production/);
  for (const marker of [
    "DISDEX_DEPLOY_REQUEST V12_V4 ",
    "DISDEX_DEPLOY_REQUEST PENGU_V8 ",
    "DISDEX_PROTECTED_REQUEST SHARED_CRYPTO_RISK_WRITER ",
    "DISDEX_PROTECTED_REQUEST ALL_RUNNERS_MONITOR_REFRESH ",
    "DISDEX_PROTECTED_REQUEST ALL_RUNNERS_ORDER_ENABLE ",
    "DISDEX_PROTECTED_REQUEST IDLE_FLAT_STALE_REPAIR ",
  ]) assert.ok(source.includes(marker), marker);
  assert.match(source, /operation = "PENGU_V8_LIVE"[\s\S]*?scope = "PENGU_V8"[\s\S]*?orders_enabled = "true"/);
  assert.match(source, /operation = "SHARED_CRYPTO_RISK_WRITER"[\s\S]*?scope = "SHARED_CRYPTO_RISK_ONLY"[\s\S]*?orders_enabled = "false"/);
  assert.match(source, /operation = "ALL_RUNNERS_MONITOR_REFRESH"[\s\S]*?scope = "FULL_PROJECT"[\s\S]*?orders_enabled = "false"/);
  assert.match(source, /operation = "ALL_RUNNERS_ORDER_ENABLE"[\s\S]*?scope = "FULL_PROJECT"[\s\S]*?orders_enabled = "true"/);
});
