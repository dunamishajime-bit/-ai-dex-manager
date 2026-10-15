import test from "node:test";import assert from "node:assert/strict";import {createHash} from "node:crypto";
import {candidateFromProtectedIdle} from "../scripts/ops/root/disdex-idle-protected-fill-recovery.mjs";
const mk=(action,symbol,ts)=>"idle-"+action.toLowerCase()+"-"+createHash("sha256").update(["IDLE_PRIORITY_SHORT",action,symbol,ts].join("|")).digest("hex").slice(0,22);
const time=Date.now()-3600000;
const fixture={side:"SHORT",symbol:"DOTUSDT",entryPrice:1.087,quantity:65.9,signalTs:time-10000,entryTs:time,protectionVerified:true};
fixture.stopClientOrderId=mk("STOP",fixture.symbol,fixture.signalTs);
fixture.takeProfitClientOrderId=mk("TP",fixture.symbol,fixture.signalTs);
test("protected Idle actual entry yields delayed notice, never an order",()=>{
 const a=candidateFromProtectedIdle(fixture);assert.ok(a);
 assert.equal(a.status,"FILLED");assert.equal(a.side,"SELL");assert.equal(a.clientOrderId,mk("ENTRY",fixture.symbol,fixture.signalTs));
 assert.equal(a.metadata.delayed,true);
});
test("unprotected or incomplete entries are never notified",()=>{
 for(const bad of [{...fixture,protectionVerified:false},{...fixture,stopClientOrderId:"invalid"},
   {...fixture,quantity:0},{...fixture,entryTs:Date.now()+900000}]){
  assert.equal(candidateFromProtectedIdle(bad),null);
 }
});
