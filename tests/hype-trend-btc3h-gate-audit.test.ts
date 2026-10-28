import test from "node:test";
import assert from "node:assert/strict";
import { buildHypeTrendSignal } from "../lib/hype-trend-long-signal";
const HOUR=3600000,START=1790000000000;
const hype=Array.from({length:320},(_,i)=>{
 const base=100*Math.pow(1.001,i);
 const close=i===319?base*1.015:base;
 return {openTime:START+i*HOUR,open:close,high:close*1.0004,low:close*0.9996,close,volume:1000};
});
const btc=Array.from({length:320},(_,i)=>{
 const close=i===319?51500:i===318?51000:i===317?50500:50000;
 return {openTime:START+i*HOUR,open:close,high:close*1.0002,low:close*0.9998,close,volume:1000};
});
test("AUDIT: current HYPE TREND entry ignores BTC 3h +3% gate and relative weakness",()=>{
 const now=START+320*HOUR;
 const flatBtc=btc.map(x=>({...x,open:50000,high:50010,low:49990,close:50000}));
 const normal=buildHypeTrendSignal({hype,btc:flatBtc,now});
 const shock=buildHypeTrendSignal({hype,btc,now});
 assert.equal(normal.reason,"HYPE_TREND_LONG_SIGNAL_ACCEPTED",JSON.stringify(normal));
 assert.equal(shock.reason,normal.reason);
 assert.equal(shock.accepted,true);
 assert.equal(shock.stopPrice,normal.stopPrice);
 // This PASS demonstrates the missing approved BTC/relative-strength admission filter.
 // It is NOT a certificate approving the old HYPE behavior.
});
