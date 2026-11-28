/** Four changed formal source pins: offline behavior only, NEVER test orders.
 * No real network, no credentials, no production or Owner/Root authority.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {AsterV3Client} from "../lib/aster-v3-client";
import {PenguDualLsV2PortfolioRunner} from "../lib/pengu-dual-ls-v2-portfolio-runner";
import {V4RunnerEngine} from "../lib/v12-v4-runner-engine";
import {STABLE4_V4_ADMISSION_CAPS} from "../lib/v12-v4-production-lifecycle";
import {initial} from "../lib/stable4-research-decision-observation";

const H=3_600_000, M5=300_000;
const t=Date.UTC(2026,9,1,0,0,0),asof=t+M5;

function mockAster(responses: Array<{status:number;body:string;headers?:Record<string,string>}>) {
  let calls=0;
  const fakeFetch:typeof fetch=async (url,init) => {
    assert.equal(init?.method,"GET","test policy allows GET only; never create even a mock mutation");
    assert.match(String(url),/^https:\/\/fapi\.asterdex\.com\/fapi\/v3\/time$/);
    const item=responses[Math.min(calls++,responses.length-1)];
    return new Response(item.body,{status:item.status,headers:{"content-type":"application/json",...(item.headers??{})}});
  };
  const client=new AsterV3Client({fetchImpl:fakeFetch,requestTimeoutMs:1_000,
    readOnlyRateLimitMaxRetries:2,readOnlyRateLimitBackoffBaseMs:1,
    readOnlyRateLimitBackoffMaxMs:1});
  return {client,calls:()=>calls};
}

test("ASTER read-only GET: a transient 503 can retry with bounded count; NO order endpoints", async()=>{
  const f=mockAster([{status:503,body:'{"code":-1000,"msg":"transient"}'},{status:200,body:'{"serverTime":1234}'}]);
  const value=await f.client.getServerTime();
  assert.deepEqual(value,{serverTime:1234});
  assert.equal(f.calls(),2);
});

test("ASTER read-only malformed 200 JSON rejects until bounded recovery, with no silent empty data",async()=>{
  const f=mockAster([{status:200,body:'not-json'},{status:200,body:'{"serverTime":4321}'}]);
  assert.deepEqual(await f.client.getServerTime(),{serverTime:4321});
  assert.equal(f.calls(),2);
});

test("ASTER read-only HTTP 418 is non-retryable; 429 Retry-After beyond cap is not shortened",async()=>{
  const banned=mockAster([{status:418,body:'{"code":-1003,"msg":"banned"}'}]);
  await assert.rejects(banned.client.getServerTime());
  assert.equal(banned.calls(),1);
  const limited=mockAster([{status:429,body:'{"code":-1003,"msg":"rate limited"}',headers:{"retry-after":"5"}}]);
  await assert.rejects(limited.client.getServerTime());
  assert.equal(limited.calls(),1,"5-second vendor cooldown must not be truncated to 1ms retry");
});

test("P91 research hook only augments diagnostics; side/size/exits remain identical",async()=>{
  const base:any={side:"SHORT",requestedGross:.75,referenceTs:t,exit:{type:"STOP"},
    orderEnabled:false,diagnostics:{cause:"native-only"}};
  const fake:any={now:()=>asof,dependencies:{researchP91Input:async(time:number)=>{
    assert.equal(time,asof);
    return {signalTs:t,asof,macroBull:false,asterPoints:8,binancePoints:9,
      priorH1Close:101,bar:[t,100,101,98,99,20]};
  }}};
  const out:any=await PenguDualLsV2PortfolioRunner.prototype.observeResearchP91.call(fake,base,false);
  assert.equal(out.side,base.side);
  assert.equal(out.requestedGross,base.requestedGross);
  assert.strictEqual(out.exit,base.exit);
  assert.equal(out.orderEnabled,false);
  assert.equal(out.diagnostics.cause,"native-only");
  assert.equal(out.diagnostics.researchP91.status,"OBSERVATION_ONLY");
  assert.equal(out.diagnostics.researchP91.orderEnabled,false);
  assert.equal(out.diagnostics.researchP91.pass,true);
  assert.strictEqual(await PenguDualLsV2PortfolioRunner.prototype.observeResearchP91.call(fake,base,true),base,
    "existing position must not trigger research provider");
  fake.dependencies.researchP91Input=async()=>{throw new Error("source down")};
  const fallback:any=await PenguDualLsV2PortfolioRunner.prototype.observeResearchP91.call(fake,base,false);
  assert.equal(fallback.diagnostics.researchP91.status,"UNAVAILABLE");
  assert.equal(fallback.diagnostics.researchP91.orderEnabled,false);
  assert.equal(fallback.side,base.side);
});

test("R21 research hook only augments decision observation; never chooses venue candidate",async()=>{
  const base:any={candidate:{symbol:"BTCUSDT",side:"SHORT",requestedGross:.3},
    source:"native-only",referenceTs:t,orderEnabled:false};
  const fake:any={now:()=>asof,deps:{fetchDecision:async()=>base,
    researchR21Input:async()=>({candidates:[{
      id:"offline-1",symbol:"BTCUSDT",route:"R21_OLD24",ts:t,gross:.3,side:"SHORT"}],state:initial()})}};
  const wrap=(V4RunnerEngine.prototype as any).fetchDecisionWithObservation;
  const out:any=await wrap.call(fake);
  assert.strictEqual(out.candidate,base.candidate);
  assert.equal(out.source,base.source);
  assert.equal(out.referenceTs,base.referenceTs);
  assert.equal(out.orderEnabled,false);
  assert.equal(out.researchR21.orderEnabled,false);
  assert.equal(out.researchR21.status,"OBSERVATION_ONLY");
  assert.equal(out.researchR21.decisions[0].reason,"ELIGIBLE_OFFLINE");
  fake.deps.researchR21Input=async()=>{throw new Error("research unavailable")};
  const fallback:any=await wrap.call(fake);
  assert.strictEqual(fallback.candidate,base.candidate);
  assert.equal(fallback.researchR21.status,"UNAVAILABLE");
  assert.equal(fallback.researchR21.orderEnabled,false);
});

test("V4 shared Gross source policy matches strict runtime admission cap 2/3/4.25",()=>{
  assert.deepEqual(STABLE4_V4_ADMISSION_CAPS,{recovery:2.5,v12:2.0,crypto:3.0,total:4.25});
  assert.ok(STABLE4_V4_ADMISSION_CAPS.crypto < 3.5);
  assert.ok(STABLE4_V4_ADMISSION_CAPS.total < 4.75);
});
