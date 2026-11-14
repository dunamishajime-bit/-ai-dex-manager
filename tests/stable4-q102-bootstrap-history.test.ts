import test from "node:test";
import assert from "node:assert/strict";
import * as bootstrap from "../lib/stable4-q102-bootstrap-history";
const H=3600000,T=1800000000000;
const b=(timestampMs:number,open=100)=>({timestampMs,open,high:101,low:99,close:100,quoteVolume:1});
test("historical observation exposes only prior completed candles and current open",()=>{
 const slice=(bootstrap as any).historicalQ102History;assert.equal(typeof slice,"function");
 const source={UNIUSDT:[b(T-H),{...b(T,102),high:9999,close:9999},b(T+H,888)]};
 const x=slice(source,T);assert.deepEqual(x.candlesBySymbol.UNIUSDT,[source.UNIUSDT[0]]);assert.deepEqual(x.entryOpenBySymbol.UNIUSDT,{timestampMs:T,open:102});
 assert.equal("close"in x.entryOpenBySymbol.UNIUSDT,false);
});
test("a missing current open or previous completed boundary cannot become an observation",()=>{
 const slice=(bootstrap as any).historicalQ102History;
 assert.throws(()=>slice({UNIUSDT:[b(T-H)]},T),/ENTRY_OPEN_MISSING/);
 assert.throws(()=>slice({UNIUSDT:[b(T-2*H),b(T)]},T),/COMPLETED_BOUNDARY_MISSING/);
});
