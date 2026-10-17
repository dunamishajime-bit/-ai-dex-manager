import assert from "node:assert/strict";
import test from "node:test";
import type { AsterKline } from "../lib/aster-v3-client";
import { IdlePriorityAsterMarketDataProvider, normalizeIdlePriorityH1, parseIdlePriorityH1 } from "../lib/idle-priority-short-market-data";

const H=3_600_000;
const M=300_000;
function k(ts:number, qv=100):AsterKline {
  return [ts,"100","110","90","105","10",ts+H-1,String(qv),1,"1","1","0"];
}
test("parses quoteVolume from Aster kline index 7",()=>{
  assert.equal(parseIdlePriorityH1(k(100*H,987.5)).quoteVolume,987.5);
});
test("drops current incomplete H1 and returns exact decision boundary",()=>{
  const now=200*H+30_000;
  const rows=Array.from({length:100},(_,i)=>k((101+i)*H));
  const x=normalizeIdlePriorityH1(rows,"TAOUSDT",now);
  assert.equal(x.decisionTs,200*H);
  assert.equal(x.rows.at(-1)?.ts,199*H);
  assert.ok(!x.rows.some((r)=>r.ts===200*H));
});
test("fails closed on a gap",()=>{
  const now=200*H+1;
  const rows=Array.from({length:100},(_,i)=>k((100+i)*H)).filter((r)=>r[0]!==150*H);
  assert.throws(()=>normalizeIdlePriorityH1(rows,"TIAUSDT",now),/IDLE_MARKET_DATA_GAP/);
});
test("fails closed on duplicate bars",()=>{
  const now=200*H+1;
  const rows=Array.from({length:100},(_,i)=>k((100+i)*H));
  rows.push(k(150*H));
  assert.throws(()=>normalizeIdlePriorityH1(rows,"DOTUSDT",now),/IDLE_MARKET_DATA_DUPLICATE/);
});
test("fails closed when latest closed H1 is stale",()=>{
  const now=200*H+1;
  const rows=Array.from({length:95},(_,i)=>k((100+i)*H));
  assert.throws(()=>normalizeIdlePriorityH1(rows,"JUPUSDT",now),/IDLE_MARKET_DATA_STALE/);
});
test("loads only the exact latest completed 5m candle for the trail",async()=>{
  const now=200*M+30_000;
  const latest=199*M;
  const k5=(ts:number,close:string="98"):[number,string,string,string,string,string,number,string,number,string,string,string]=>[ts,"100","101","97",close,"10",ts+M-1,"100",1,"1","1","0"];
  const client={getKlines:async()=>[k5(latest-M),k5(latest),k5(200*M)]};
  const provider=new IdlePriorityAsterMarketDataProvider(client as any,{now:()=>now});
  const result=await provider.loadFiveMinute("DOTUSDT");
  assert.equal(result.timestampMs,latest);
  assert.equal(result.close,98);
  const missing={getKlines:async()=>[k5(latest-M),k5(200*M)]};
  await assert.rejects(()=>new IdlePriorityAsterMarketDataProvider(missing as any,{now:()=>now}).loadFiveMinute("RENDERUSDT"),/IDLE_5M_CANDLE_UNAVAILABLE/);
});
