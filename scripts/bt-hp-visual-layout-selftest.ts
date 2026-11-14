import assert from "node:assert/strict";
import {createPreviewReplay} from "../lib/bt-verification/demo";
import {grossForFrame,validateReplay} from "../lib/bt-verification/replay";
for(const scenario of ["trend","range","down","volatile"] as const){
 const data=createPreviewReplay(123456,scenario);
 assert.equal(validateReplay(data),true,"Demo must satisfy the same strict replay schema");
 assert.equal(data.mode,"DEMO");
 assert.equal(data.engineSha,"VISUAL_DEMO_SYNTHETIC_NOT_A_BACKTEST");
 assert.equal(data.frames.length,72);
 assert.equal(data.btcCandles?.length,288);
 assert.equal(data.frames[0].btc,null);
 assert.ok(data.frames.some(f=>f.events.some(e=>e.startsWith("PARTIAL "))),"Partial model event must be visible");
 assert.ok(data.frames.some(f=>f.events.some(e=>e.startsWith("ENTRY "))),"Entries visible");
 assert.ok(data.frames.some(f=>f.events.some(e=>e.startsWith("EXIT "))),"Exits visible");
 for(const frame of data.frames){
   const gross=grossForFrame(frame);
   assert.equal(gross.inconsistent,false);
   assert.ok(gross.total<=data.limits.total,"Synthetic gross respects demo limits");
   if(frame.btc!==null)assert.ok(data.btcCandles!.some(c=>c.closedAt<=frame.timestamp && c.close===frame.btc));
 }
 assert.deepEqual(createPreviewReplay(123456,scenario),data,"Seed must be deterministic");
}
assert.notEqual(createPreviewReplay(123456,"trend").frames.at(-1)?.equity,createPreviewReplay(123456,"down").frames.at(-1)?.equity,"Scenario should visibly change the balance curve");
console.log(JSON.stringify({status:"PASS",scenarios:4,framesPerScenario:72,candlesPerScenario:288,notCanonical:true}));
