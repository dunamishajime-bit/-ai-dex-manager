import assert from "node:assert/strict";
import test from "node:test";
import { H, M5, type P91Input } from "../lib/stable4-research-decision-observation";
import { selectAdoptedP91Candidate } from "../lib/pengu-adopted-p91";
import type { PenguDualLsV2Signal } from "../lib/pengu-dual-ls-v2";
const t=1000*H, now=t+M5;
const signal={side:0,targetGross:0,referenceTs:t-H,features:{referenceTs:t-H},diagnostics:{cooldownBlocked:false}} as PenguDualLsV2Signal;
const source:P91Input={signalTs:t,asof:now,macroBull:false,asterPoints:0,binancePoints:0,priorH1Close:100,bar:[t,100,101,98,99,1]};
test("P91 source creates only the adopted gross at closed M5 boundary in shadow",()=>{
  const x=selectAdoptedP91Candidate(signal,source,now,false,"SHADOW");
  assert.equal(x.side,-1);assert.equal(x.targetGross,.75);assert.equal(x.entryTs,now);
  const y=selectAdoptedP91Candidate(signal,{...source,macroBull:true,asterPoints:5,binancePoints:3},now,false,"SHADOW");
  assert.equal(y.targetGross,.5);
});
test("legacy V20 cannot fall through on absent or zero-volume P91",()=>{
  const old={...signal,side:-1 as const,entryVersion:"SHORT_V20" as const,targetGross:1};
  assert.equal(selectAdoptedP91Candidate(old,undefined,now,false,"SHADOW").side,0);
  assert.equal(selectAdoptedP91Candidate(old,{...source,bar:[t,100,101,98,99,0]},now,false,"SHADOW").side,0);
});
test("existing position and ordinary long are unchanged",()=>{
  const long={...signal,side:1 as const};
  assert.equal(selectAdoptedP91Candidate(long,source,now,false,"SHADOW"),long);
  assert.equal(selectAdoptedP91Candidate(signal,source,now,true,"SHADOW"),signal);
});
test("missing ASTER seed, cooldown and unissued live certificate fail closed",()=>{
  assert.equal(selectAdoptedP91Candidate({...signal,features:undefined},source,now,false,"SHADOW").side,0);
  assert.equal(selectAdoptedP91Candidate({...signal,diagnostics:{...signal.diagnostics,cooldownBlocked:true}},source,now,false,"SHADOW").side,0);
  assert.equal(selectAdoptedP91Candidate(signal,source,now,false,"LIVE").side,0);
  assert.equal(selectAdoptedP91Candidate(signal,{...source,asof:t},now,false,"SHADOW").side,0);
});
