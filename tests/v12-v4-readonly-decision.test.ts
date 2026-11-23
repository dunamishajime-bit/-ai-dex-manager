import test from "node:test";
import assert from "node:assert/strict";
import {buildV4LiveDecisionBatch} from "../lib/v12-v4-live-candidate-builder";
test("missing market universe fails closed rather than enabling orders",()=>{
 assert.throws(()=>buildV4LiveDecisionBatch({},Date.now()),/V4_UNIVERSE_NOT_COMPLETE/);
});
