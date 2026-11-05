import test from "node:test";
import assert from "node:assert/strict";
import {readOnlyHypeAdoptedM5Snapshot} from "../lib/hype-adopted-m5-native-evidence";
const M5=300000,T=Math.floor(1793000000000/M5)*M5;
const rows=(end:number)=>Array.from({length:37},(_,i)=>{
 const p=i===36?end:100;
 return [T+i*M5,p,p*1.001,p*0.999,p,1000];
});
test("native public M5 reader uses exactly two reads, never orders",async()=>{
 const calls:string[]=[];
 const read={
  getKlines:async (symbol:"BTCUSDT"|"HYPEUSDT",interval:"5m",limit:number)=>{
   calls.push(symbol+":"+interval+":"+limit);
   return rows(symbol==="BTCUSDT"?100.5:103.2);
  },
 };
 const r=await readOnlyHypeAdoptedM5Snapshot({provider:read,decisionTs:T+37*M5});
 assert.equal(r.status,"RESEARCH_SIGNAL_ACCEPTED");
 assert.equal(r.ordersSent,0);assert.equal(r.cancelsSent,0);
 assert.deepEqual(calls,["BTCUSDT:5m:72","HYPEUSDT:5m:72"]);
});
test("missing native M5 history fails closed without alternative venue",async()=>{
 const read={getKlines:async(_s:"BTCUSDT"|"HYPEUSDT",_i:"5m",_l:number)=>rows(103).slice(15)};
 const r=await readOnlyHypeAdoptedM5Snapshot({provider:read,decisionTs:T+37*M5});
 assert.equal(r.status,"RESEARCH_SIGNAL_BLOCKED");assert.equal(r.ordersSent,0);
});
test("API 429/cooldown is not retried inside collector",async()=>{
 let calls=0;
 const read={getKlines:async(_s:"BTCUSDT"|"HYPEUSDT",_i:"5m",_l:number):Promise<readonly (readonly unknown[])[]>=>{calls++;throw Error("429");}};
 const r=await readOnlyHypeAdoptedM5Snapshot({provider:read,decisionTs:T+37*M5});
 assert.equal(r.status,"BLOCKED");assert.equal(calls,2);assert.equal(r.liveActivationAllowed,false);
});
test("invalid decision timestamp rejects without API requests",async()=>{
 let calls=0;
 const read={getKlines:async(_s:"BTCUSDT"|"HYPEUSDT",_i:"5m",_l:number)=>{calls++;return rows(100);}};
 const r=await readOnlyHypeAdoptedM5Snapshot({provider:read,decisionTs:NaN});
 assert.equal(r.reason,"INVALID_DECISION_TS");assert.equal(calls,0);
});
test("invalid native number never invents an entry",async()=>{
 const read={getKlines:async(_s:"BTCUSDT"|"HYPEUSDT",_i:"5m",_l:number)=>{
  const a=rows(105);
  a[25][4]=NaN;
  return a;
 }};
 const r=await readOnlyHypeAdoptedM5Snapshot({provider:read,decisionTs:T+37*M5});
 assert.equal(r.status,"BLOCKED");assert.equal(r.ordersSent,0);
});
