import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const script=readFileSync("scripts/ops/disdex-v12-mutual-exclusion-preflight.sh","utf8");

test("V12/V4 startup preflight bounded-waits valid peer leases without stealing them",()=>{
 assert.match(script,/DISDEX_V12_PREFLIGHT_LOCK_WAIT_MS:-15000/);
 assert.match(script,/DISDEX_V12_PREFLIGHT_LOCK_RETRY_MS:-500/);
 assert.match(script,/while \[\[ -e "\$lock_path" \]\]; do/);
 assert.match(script,/account lock temporarily held; waiting owner=/);
 assert.match(script,/remained held after bounded wait; refusing concurrent startup owner=/);
 assert.doesNotMatch(script,/^\s*(?:rm|unlink)\b.*account-order\.lock/im);
});

test("V12/V4 startup preflight remains fail-closed for malformed or expired locks",()=>{
 assert.match(script,/account lock is malformed; operator review required/);
 assert.match(script,/account lock is expired; explicit recovery is required owner=/);
 assert.match(script,/wait_ms >= 0 && wait_ms <= 30000/);
 assert.match(script,/retry_ms >= 250 && retry_ms <= 2000/);
});
