import assert from "node:assert/strict";import test from "node:test";
import {emptyIdleState,normalizeIdleState} from "../lib/idle-priority-short-state";
const sha="a".repeat(40);
test("empty state is SHA-bound and safe",()=>{const s=emptyIdleState(sha,1);assert.equal(s.runtimeSha,sha);assert.equal(s.manualReview,false);assert.deepEqual(s.positions,[])});
test("different runtime SHA fails closed",()=>assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),runtimeSha:"b".repeat(40)},sha),/RUNTIME_SHA_MISMATCH/));
test("unknown symbol ownership is rejected",()=>assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{symbol:"BTCUSDT",route:"x",side:"SHORT",entryTs:1,entryPrice:1,quantity:1,holdHours:12,protectionVerified:true}]},sha),/POSITION_INVALID/));
test("unverified protection is rejected",()=>assert.throws(()=>normalizeIdleState({...emptyIdleState(sha),positions:[{symbol:"TAOUSDT",route:"IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2",side:"SHORT",entryTs:1,entryPrice:1,quantity:1,holdHours:12,protectionVerified:false}]},sha),/POSITION_INVALID/));
