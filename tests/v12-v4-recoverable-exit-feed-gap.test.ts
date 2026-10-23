import test from "node:test";
import assert from "node:assert/strict";
import {classifyV4RecoverableExitFeedFailure,v4ExitFeedWindow} from "../lib/v12-v4-runner-engine";

test("M5 exit-feed gaps become a fail-closed retry result instead of a daemon-fatal error",()=>{
 const result=classifyV4RecoverableExitFeedFailure(
  new Error("V4_EXIT_FEED_M5_GAP:1792689300000"),1792689600000);
 assert.deepEqual(result,{
  status:"blocked",
  reason:"V4_EXIT_FEED_GAP_RETRY:V4_EXIT_FEED_M5_GAP:1792689300000",
  eventTs:1792689600000,
  candidateCount:0,
  orderEnabled:false,
 });
});

test("unrelated failures remain fatal and are not reclassified as exit-feed gaps",()=>{
 assert.equal(classifyV4RecoverableExitFeedFailure(
  new Error("V4_PROTECTION_RECOVERY_VENUE_QTY_DRIFT:NEARUSDT"),100),undefined);
});

test("exit-feed requests are bounded to the causal lifetime of the open leg",()=>{
 assert.deepEqual(v4ExitFeedWindow(1792605600000,72,1792740000000),{
  fromTs:1792605600000,untilTs:1792740000000,
 });
 assert.deepEqual(v4ExitFeedWindow(1792605600000,72,1793000000000),{
  fromTs:1792605600000,untilTs:1792864800000,
 });
});
