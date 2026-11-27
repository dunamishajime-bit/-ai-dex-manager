import test from "node:test";
import assert from "node:assert/strict";
import {createResilientPublicGet} from "../lib/stable4-public-get-resilience";
const H=3600000,t=200*H;
const row=(n:number)=>[n,"100","101","99","100","2",n+H-1];
const good=()=>new Response(JSON.stringify([row(t-H)]),{status:200});
function harness(fn:(n:number)=>Response|Promise<Response>){
 let clock=t+300000,calls=0;const delays:number[]=[];
 const get=createResilientPublicGet({now:()=>clock,sleep:async ms=>{delays.push(ms);clock+=ms;},random:()=>0,fetcher:(async()=>{calls++;return fn(calls);}) as typeof fetch});
 return {get,delays,calls:()=>calls,advance:(ms:number)=>{clock+=ms;}};
}
const read=(h:ReturnType<typeof harness>,venue:"ASTER"|"BINANCE"="ASTER")=>h.get(venue,"PENGUUSDT","1h",t-H,t);
test("timeout and 503 recover, exact-window cache and copies",async()=>{
 const h=harness(n=>{if(n===1)throw new DOMException("timeout","TimeoutError");if(n===2)return new Response("",{status:503});return good();});
 const a=await read(h);assert.equal(h.calls(),3);assert.deepEqual(h.delays,[500,1000]);(a[0] as any[])[4]="999";
 assert.equal((await read(h))[0][4],"100");assert.equal(h.calls(),3);
 await read(h,"BINANCE");assert.equal(h.calls(),4);
});
test("429 honors Retry-After and no duplicate concurrent request",async()=>{
 const h=harness(n=>n===1?new Response("",{status:429,headers:{"Retry-After":"3"}}):good());
 const [a,b]=await Promise.all([read(h),read(h)]);assert.deepEqual(a,b);assert.equal(h.calls(),2);assert.equal(h.delays[0],3000);
});
test("long rate cooldown fails without hammering; recovers when elapsed",async()=>{
 const h=harness(n=>n===1?new Response("",{status:429,headers:{"Retry-After":"60"}}):good());
 await assert.rejects(read(h),/RETRY_BUDGET/);
 await assert.rejects(read(h),/COOLDOWN/);assert.equal(h.calls(),1);
 h.advance(61000);assert.equal((await read(h)).length,1);assert.equal(h.calls(),2);
});
test("418 and permanent 400 not retried, independent venue unaffected",async()=>{
 const h=harness(n=>n===1?new Response("",{status:418}):n===2?good():new Response("",{status:400}));
 await assert.rejects(read(h),/418/);await assert.rejects(read(h),/COOLDOWN/);assert.equal(h.calls(),1);
 await read(h,"BINANCE");assert.equal(h.calls(),2);h.advance(121000);
 await assert.rejects(read(h),/400/);assert.equal(h.calls(),3);
});
test("late closed bar retried, stale or malformed data not substituted",async()=>{
 const h=harness(n=>n===1?new Response("[]"):good());assert.equal((await read(h)).length,1);assert.equal(h.calls(),2);
 const bad=harness(()=>new Response(JSON.stringify([row(t-H),row(t-H)])));
 await assert.rejects(read(bad),/DUPLICATE/);assert.equal(bad.calls(),1);
 const stale=harness(()=>new Response(JSON.stringify([row(t-2*H)])));
 await assert.rejects(read(stale),/CLOSED_RANGE_GAP/);assert.equal(stale.calls(),3);
});
test("persistent failures never return old data, later call recovers",async()=>{
 const h=harness(n=>n===1||n>=5?good():new Response("",{status:503}));
 await read(h);h.advance(601000);
 await assert.rejects(read(h),/503/);assert.equal(h.calls(),4);
 assert.equal((await read(h)).length,1);assert.equal(h.calls(),5);
});
