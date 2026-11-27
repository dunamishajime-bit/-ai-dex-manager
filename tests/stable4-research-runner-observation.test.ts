import test from "node:test";
import assert from "node:assert/strict";
import {V4RunnerEngine} from "../lib/v12-v4-runner-engine";
import {PenguDualLsV2PortfolioRunner} from "../lib/pengu-dual-ls-v2-portfolio-runner";
import {initial,H,M5,type Candidate} from "../lib/stable4-research-decision-observation";
const at=200*H;
test("V4 actual flat decision acquisition attaches research observation only",async()=>{
 const c:Candidate={id:"a",route:"R21_OLD24",symbol:"ETHUSDT",ts:at,gross:.3,side:"SHORT"};
 const base:any={candidates:[],candidateCount:0,orderEnabled:false,sourceFingerprint:"unchanged"};
 const deps:any={now:()=>at,store:{read:()=>({intents:{},state:{legs:{}}})},fetchDecision:async()=>base,researchR21Input:async()=>({state:initial(),candidates:[c]})};
 const r=await new V4RunnerEngine(deps).prepareFlatMarketDecision();
 assert.equal(r?.kind,"READY");if(r?.kind!=="READY")throw Error("not ready");
 assert.deepEqual(r.decision.candidates,base.candidates);assert.equal(r.decision.sourceFingerprint,base.sourceFingerprint);
 assert.equal(r.decision.researchR21?.decisions[0].reason,"ELIGIBLE_OFFLINE");assert.equal(r.decision.researchR21?.orderEnabled,false);
 deps.researchR21Input=async()=>{throw Error("missing")};
 const rejected=await new V4RunnerEngine(deps).prepareFlatMarketDecision();
 assert.equal(rejected?.kind==="READY"&&rejected.decision.researchR21?.status,"UNAVAILABLE");
});
test("PENGU actual Runner observation leaves native signal and exit intact",async()=>{
 const base:any={side:-1,targetGross:1,reason:"native",entryTs:at,diagnostics:{}};
 const r=Object.create(PenguDualLsV2PortfolioRunner.prototype) as PenguDualLsV2PortfolioRunner;
 let calls=0;Object.assign(r,{now:()=>at+M5,dependencies:{researchP91Input:async()=>{calls++;return {signalTs:at,asof:at+M5,macroBull:false,asterPoints:0,binancePoints:0,priorH1Close:100,bar:[at,100,101,98,99,5]};}}});
 const x=await r.observeResearchP91(base,false);
 assert.equal(x.diagnostics.researchP91?.pass,true);assert.equal(x.diagnostics.researchP91?.orderEnabled,false);assert.equal(x.side,base.side);assert.equal(x.targetGross,base.targetGross);assert.equal(x.entryTs,base.entryTs);
 assert.equal(await r.observeResearchP91(base,true),base);assert.equal(calls,1);
});
