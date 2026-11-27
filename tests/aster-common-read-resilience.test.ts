import test from "node:test";
import assert from "node:assert/strict";
import {AsterApiError,AsterV3Client} from "../lib/aster-v3-client";
const good=()=>new Response('{"serverTime":123}',{status:200});
const err=(status:number,headers:Record<string,string>={})=>new Response('{"msg":"temporary"}',{status,headers});
function fixture(fn:(n:number,init?:RequestInit)=>Response|Promise<Response>){
 let n=0;
 const c=new AsterV3Client({readOnlyRateLimitMaxRetries:2,readOnlyRateLimitBackoffBaseMs:1,readOnlyRateLimitBackoffMaxMs:10,fetchImpl:(async(_u:any,i?:RequestInit)=>fn(++n,i)) as typeof fetch});
 return {c,calls:()=>n};
}
test("public GET retries transport, timeout and temporary 5xx",async()=>{
 const x=fixture(n=>{if(n===1)throw new TypeError("fetch failed");if(n===2)return err(503);return good();});
 assert.deepEqual(await x.c.getServerTime(),{serverTime:123});assert.equal(x.calls(),3);
 const y=fixture(n=>{if(n===1)throw new DOMException("timeout","AbortError");return good();});
 await y.c.getServerTime();assert.equal(y.calls(),2);
});
test("malformed success JSON never becomes market data",async()=>{
 const x=fixture(n=>n===1?new Response("<html>gateway</html>"):good());
 await x.c.getServerTime();assert.equal(x.calls(),2);
});
test("429 with longer Retry-After is never retried early; 418 and 400 never retried",async()=>{
 for(const status of [429,418,400]){
  const x=fixture(()=>err(status,{"Retry-After":"60"}));
  await assert.rejects(x.c.getServerTime(),(e:any)=>e instanceof AsterApiError&&e.status===status);assert.equal(x.calls(),1);
 }
});
test("persistent read failures bounded, later read recovers",async()=>{
 const x=fixture(n=>n<=3?err(503):good());await assert.rejects(x.c.getServerTime(),/temporary/);assert.equal(x.calls(),3);await x.c.getServerTime();assert.equal(x.calls(),4);
});
test("signed GET retries re-sign with fresh nonce; POST/DELETE never retry",async()=>{
 const key=("0x"+"1".repeat(64)) as `0x${string}`;let calls=0;const nonces:string[]=[];
 const c=new AsterV3Client({userAddress:"0x"+"2".repeat(40),privateKey:key,readOnlyRateLimitMaxRetries:2,readOnlyRateLimitBackoffBaseMs:1,readOnlyRateLimitBackoffMaxMs:10,fetchImpl:async(u:any,init?:RequestInit)=>{
  calls++;if(init?.method==="GET"){nonces.push(new URL(String(u)).searchParams.get("nonce")!);return calls===1?err(503):new Response("[]");}return err(503);
 }});
 await c.getBalances();assert.equal(calls,2);assert.ok(BigInt(nonces[1])>BigInt(nonces[0]));
 await assert.rejects(c.setLeverage("BTCUSDT",5));assert.equal(calls,3);
 await assert.rejects(c.cancelOrder("BTCUSDT","fixture"));assert.equal(calls,4);
});
