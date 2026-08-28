import assert from "node:assert/strict";

const target = process.argv[2] || "http://127.0.0.1:3000/ai-view";

try {
  const response = await fetch(target, { redirect: "error" });
  const body = await response.text();
  assert.equal(response.status, 200, `expected HTTP 200, got ${response.status}`);
  assert.ok(body.includes("SYSTEM STATUS"), "SSR body is missing SYSTEM STATUS");
  for (const anchor of ["V12", "PENGU", "V52", "tradingMutation=0"]) {
    assert.ok(body.includes(anchor), `SSR body is missing ${anchor}`);
  }
  assert.match(body, /PASS|FAIL|WAIT|BLOCKED|UNKNOWN/);
  const textOnly = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  assert.notEqual(textOnly, "Loading...", "SSR body must not be Loading-only");
  for (const forbidden of ["api_key", "private_key", "process.env", "DisDex.pem", "/home/deploy/", "C:\\Users\\dis\\", "orderId", "tradeId", "balanceUsd", "entryPrice", "markPrice", "quantity"]) {
    assert.equal(body.toLowerCase().includes(forbidden.toLowerCase()), false, `HTTP body leaked ${forbidden}`);
  }
  console.log(`AI_VIEW_HTTP_SELFTEST_PASS ${target}`);
} catch (error) {
  console.error(`AI_VIEW_HTTP_SELFTEST_FAIL ${target}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
