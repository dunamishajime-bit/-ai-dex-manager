import {test} from "node:test";
import {strict as assert} from "node:assert";
import {classifyBTEvent} from "../lib/bt-verification/event-types";
test("research model entry and exit never receive real venue status",()=>{
 assert.equal(classifyBTEvent("2026-02-01T02:00:00Z MODEL ENTRY V4 BTCUSDT LONG").label,"研究モデル入口（非実約定）");
 assert.equal(classifyBTEvent("MODEL EXIT V4 BTCUSDT +30 JPY").kind,"RESEARCH_EXIT");
});
test("candidate is not an entry and block is a rejection",()=>{
 assert.equal(classifyBTEvent("2026-01-01T01:00:00Z CANDIDATE Q102 MODEL_ENTER").kind,"CANDIDATE");
 assert.equal(classifyBTEvent("2026-01-01T01:00:00Z BLOCK V4 GROSS_CAP").kind,"RISK_REJECTED");
});
test("deposits and funding are not model PnL",()=>{
 assert.equal(classifyBTEvent("EXTERNAL DEPOSIT 10000 JPY").kind,"EXTERNAL_DEPOSIT");
 assert.equal(classifyBTEvent("FUNDING HYPE").kind,"FUNDING");
});
test("model and demo exit messages remain separate",()=>{
 assert.equal(classifyBTEvent("DEMO_Q102 ENTRY LONG").kind,"DEMO_ENTRY");
 assert.equal(classifyBTEvent("DEMO_Q102 EXIT WIN").kind,"DEMO_EXIT");
 assert.equal(classifyBTEvent("PARTIAL HYPE").kind,"PARTIAL");
});