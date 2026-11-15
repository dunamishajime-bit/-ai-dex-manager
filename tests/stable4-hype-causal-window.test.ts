import test from "node:test";
import assert from "node:assert/strict";
import {evaluateStable4HypeSignal} from "../lib/hype-stable4-opportunity-signal";
const H=3600000;
const candle=(ts:number,close:number)=>({ts,open:close,high:close*1.01,low:close*.99,close});
const hype=Array.from({length:30},(_,i)=>candle(i*H,i<=5?100:i<=17?102.5:102.8));
const btc=Array.from({length:30},(_,i)=>candle(i*H,i<=5?100:101));
test("HYPE h12/h24 use exact completed hourly boundaries",()=>{
 const full=evaluateStable4HypeSignal({now:30*H,btc1h:btc,hype1h:hype});assert.equal(full.accepted,true);
 for(const input of [
  {btc1h:btc,hype1h:hype.filter(x=>x.ts!==13*H)},
  {btc1h:btc.filter(x=>x.ts!==13*H),hype1h:hype},
  {btc1h:[...btc,btc[13]],hype1h:hype},
  {btc1h:btc,hype1h:[...hype,hype[13]]},
 ]){
  const s=evaluateStable4HypeSignal({now:30*H,...input});
  assert.equal(s.accepted,false);assert.match(s.reason,/NONCONTIGUOUS|DUPLICATE/);
 }
});
test("non-finite candles cannot pass a causal signal window",()=>{
 const broken=hype.map((x,i)=>i===13?{...x,close:NaN}:x);
 const s=evaluateStable4HypeSignal({now:30*H,btc1h:btc,hype1h:broken});assert.equal(s.accepted,false);assert.match(s.reason,/INVALID_H1/);
});
