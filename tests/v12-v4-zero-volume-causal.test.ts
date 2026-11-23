import test from "node:test";
import assert from "node:assert/strict";
import {computeProductionH1Features} from "../lib/v12-v4-production-features";
const H=3600000;
test("zero prior quote-volume median mirrors original Python None; non-volume route features survive",()=>{
 const start=Date.parse("2026-04-01T00:00:00Z");
 const at=start+65*H;
 const symbol=Array.from({length:65},(_,i)=>({
  openTs:start+i*H,open:100+i*.1,close:100.05+i*.1,
  high:100.2+i*.1,low:99.9+i*.1,
  quoteVolume:i===64?1000:i<40?500:0
 }));
 const btc=Array.from({length:65},(_,i)=>({
  openTs:start+i*H,open:200+i*.1,close:200.05+i*.1,
  high:200.2+i*.1,low:199.9+i*.1,quoteVolume:1000
 }));
 const result=computeProductionH1Features("ATOMUSDT","SHORT",at,at,symbol,btc);
 assert.equal(result.features.volRatio,undefined);
 assert.ok(Number.isFinite(result.features.sret6));
 assert.ok(Number.isFinite(result.atr14));
 const nonzero=structuredClone(symbol);
 for(let j=41;j<64;j++)nonzero[j].quoteVolume=100;
 assert.equal(computeProductionH1Features("ATOMUSDT","SHORT",at,at,nonzero,btc).features.volRatio,10);
});
