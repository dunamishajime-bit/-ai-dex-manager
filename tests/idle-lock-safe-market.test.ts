import test from "node:test";
import assert from "node:assert/strict";
import {reuseFlatIdleMarketSnapshot} from "../lib/idle-lock-safe-market";

const H=3_600_000;
const base=Math.floor(Date.now()/H)*H;

test("reuse completed H1 market snapshot only while local ownership remains flat",()=>{
 const market={decisionTs:base,symbols:{example:[]}};
 assert.equal(reuseFlatIdleMarketSnapshot(market,base+5000,true),market);
 assert.equal(reuseFlatIdleMarketSnapshot(market,base+5000,false),undefined);
});
test("discard pre-lock market snapshot at H1 rollover and when missing",()=>{
 const market={decisionTs:base,symbols:{}};
 assert.equal(reuseFlatIdleMarketSnapshot(market,base+H+10,true),undefined);
 assert.equal(reuseFlatIdleMarketSnapshot(undefined,base+10,true),undefined);
 assert.equal(reuseFlatIdleMarketSnapshot({decisionTs:base+H},base+100,true),undefined);
});
