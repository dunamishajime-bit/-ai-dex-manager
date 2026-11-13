import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPLOY_APPROVAL_OPERATION_POLICY,
  DEPLOY_APPROVAL_OPERATIONS,
} from "../lib/deploy-approval-token";

test("DOGE missed TIME exit is a distinct exact approval operation",()=>{
  assert.ok(DEPLOY_APPROVAL_OPERATIONS.includes("V4_DOGE_MISSED_TIME_EXIT"));
  assert.deepEqual(DEPLOY_APPROVAL_OPERATION_POLICY.V4_DOGE_MISSED_TIME_EXIT,{
    scope:"V12_V4",
    ordersEnabled:true,
    label:"DOGEUSDT SHORT 226 / TIME決済（指定建玉1件のみ）",
  });
});
