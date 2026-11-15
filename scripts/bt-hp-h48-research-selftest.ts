import assert from "node:assert/strict";
import {evaluateH48ClosedHourly,createH48ResearchReplay,H48_RESEARCH_LOGIC,H48_RESEARCH_THRESHOLDS} from "../lib/bt-verification/h48-research-sandbox";
import {validateReplay,grossForFrame} from "../lib/bt-verification/replay";

const observation=Array.from({length:25},(_,i)=>({
  btcClose:100+i/24,
  hypeClose:i<=12?100+2.9*i/12:102.9+.1*(i-12)/12
}));
// Assert exact thresholds from frozen research entryRule; rounded decimals must
// not silently widen/narrow the accepted boundary.
assert.equal(H48_RESEARCH_THRESHOLDS.h12Max,0.004297852251518686);
assert.equal(H48_RESEARCH_THRESHOLDS.h24Min,0.02047426596091347);
assert.equal(H48_RESEARCH_THRESHOLDS.rel24Max,0.026202553353817715);
const boundary=Array.from({length:25},()=>({btcClose:100,hypeClose:100}));
boundary[12].hypeClose=103;
boundary[24].hypeClose=103*(1+H48_RESEARCH_THRESHOLDS.h12Max);
boundary[0].hypeClose=100;
boundary[24].btcClose=100*(1+0.02);
assert.equal(evaluateH48ClosedHourly(boundary).candidate,true);
const tooFast=boundary.map(x=>({...x}));
tooFast[24].hypeClose=103*(1+H48_RESEARCH_THRESHOLDS.h12Max+1e-8);
assert.equal(evaluateH48ClosedHourly(tooFast).candidate,false,"H12 strict boundary");
const low24=boundary.map(x=>({...x}));
low24[0].hypeClose=low24[24].hypeClose/(1+H48_RESEARCH_THRESHOLDS.h24Min-1e-8);
assert.equal(evaluateH48ClosedHourly(low24).candidate,false,"H24 strict boundary");
const highRel=boundary.map(x=>({...x}));
const currentH24=highRel[24].hypeClose/highRel[0].hypeClose-1;
highRel[24].btcClose=highRel[0].btcClose*(1+currentH24-H48_RESEARCH_THRESHOLDS.rel24Max-1e-8);
assert.equal(evaluateH48ClosedHourly(highRel).candidate,false,"Relative return strict boundary");
const pass=evaluateH48ClosedHourly(observation);
assert.equal(pass.ready,true);
assert.equal(pass.candidate,true);
assert.ok(pass.h12!==null&&pass.h12<.0043);
assert.ok(pass.h24!==null&&pass.h24>.0204);
assert.ok(pass.rel24!==null&&pass.rel24<.0262);
assert.equal(evaluateH48ClosedHourly(observation.slice(0,24)).ready,false,"Wait for 25 closed candles");
const spike=observation.map(x=>({...x}));
spike[24].hypeClose=105;
assert.equal(evaluateH48ClosedHourly(spike).candidate,false,"Reject high last-12h return");
const weak=observation.map(x=>({...x}));
weak[24].hypeClose=101;
assert.equal(evaluateH48ClosedHourly(weak).candidate,false,"Reject weak 24h return");
const relative=observation.map(x=>({...x}));
relative[24].btcClose=98;
assert.equal(evaluateH48ClosedHourly(relative).candidate,false,"Reject BTC-relative overshoot");
const stale=observation.map(x=>({...x}));
stale[24].btcClose=NaN;
assert.equal(evaluateH48ClosedHourly(stale).ready,false,"Fail closed on bad market data");

let totalEntries=0;
for(const scenario of ["trend","range","down","volatile"] as const){
 const a=createH48ResearchReplay(123456,scenario,10);
 const b=createH48ResearchReplay(123456,scenario,10);
 assert.deepEqual(a,b,"Frozen seed and scenario must be byte-stable");
 assert.equal(validateReplay(a),true,"H48 single-sleeve satisfies replay schema");
 assert.equal(a.frames.length,144*12);
 assert.equal(a.btcCandles?.length,212);
 assert.equal(a.mode,"DEMO");
 assert.equal(a.source?.kind,"SYNTHETIC_H48_RESEARCH_RULE_ONLY");
 assert.equal(a.limits.total,3.5);
 assert.ok(a.frames.every(f=>f.positions.every(p=>p.logic===H48_RESEARCH_LOGIC&&p.symbol==="HYPEUSDT")));
 assert.ok(a.frames.every(f=>f.events.every(e=>!e.includes("DEMO_V4"))),"Never conflate proxy rules with research");
 const entries=a.frames.flatMap(f=>f.events.filter(e=>e.startsWith("ENTRY ")));
 const exits=a.frames.flatMap(f=>f.events.filter(e=>e.startsWith("EXIT ")));
 totalEntries+=entries.length;
 assert.ok(entries.length>=exits.length);
 for(let i=0;i<a.frames.length;i++){
   const f=a.frames[i];
   assert.ok(f.h48Research?.hypePrice!==undefined && f.h48Research.hypePrice>0,"HYPE quote must update with every modeled tick");
   if(f.events.some(e=>e.startsWith("RISK "+H48_RESEARCH_LOGIC))){
     assert.equal(f.h48Research?.ready,true,"H48 closing decision is complete");
   }
   assert.equal(grossForFrame(f).inconsistent,false);
   assert.ok(f.equity>0);
   const pnl=f.positions.reduce((sum,p)=>sum+(p.quantity??0)*((p.mark??p.entry)-p.entry)*145,0);
   assert.ok(Math.abs(f.equity-(10000+f.realized+pnl))<.1,"Equity = cash + marked position");
   const entriesHere=f.events.filter(e=>e.startsWith("ENTRY "));
   if(entriesHere.length){
     const prev=i-1;
     assert.ok(prev>=0 && a.frames[prev].events.some(e=>e.includes(" HYPEUSDT PASS ")),"Entry only after previous closed-hour H48 PASS");
     assert.equal(i%12,0,"Entry occurs at following hour open, not current signal close");
     assert.equal(new Date(f.timestamp).getUTCHours()%6,0,"Frozen H48 entries are six-hour UTC grid");
   }
   for(const e of f.events.filter(e=>e.startsWith("EXIT "))){
     if(e.includes("TIME48_NEXTOPEN")) assert.equal(i%12,0,"H48 time exit is at next-open hour");
     else assert.ok(e.includes("H48_STUDY_STOP_6PCT_5MIN_OBSERVED"),"Only sourced time/STOP paths allowed");
   }
 }
}
const sourceGridExample=createH48ResearchReplay(11,"trend",10);
const sourceGridEntries=sourceGridExample.frames.filter(f=>f.events.some(e=>e.startsWith("ENTRY "+H48_RESEARCH_LOGIC)));
assert.ok(sourceGridEntries.length>0,"Frozen H48 6h research grid must have an executable artificial-market example");
assert.equal(new Date(sourceGridEntries[0].timestamp).getUTCHours()%6,0,"Example respects observed six-hour research entry grid");
totalEntries+=sourceGridEntries.length;
const badH48=structuredClone(createH48ResearchReplay());
badH48.frames[1].h48Research!.hypePrice=Number.NaN;
assert.equal(validateReplay(badH48),false,"Do not allow synthetic price tampering");
const badExternal=structuredClone(createH48ResearchReplay());
badExternal.mode="EXTERNAL";
assert.equal(validateReplay(badExternal),false,"Do not allow study observation in external research data");
const ten=createH48ResearchReplay(555,"range",10),thirty=createH48ResearchReplay(555,"range",30);
assert.deepEqual(ten.frames.filter(f=>f.events.some(e=>e.includes(" HYPEUSDT PASS "))).map(f=>f.timestamp),
 thirty.frames.filter(f=>f.events.some(e=>e.includes(" HYPEUSDT PASS "))).map(f=>f.timestamp),
 "Fee scenario must not rewrite source signal timestamps");
assert.ok(ten.source?.note?.includes("NOT modeled"));
console.log("PASS H48 frozen rules, closed-bar causality, next-open entry/48h exit, equity/Gross, deterministic 4-scenario playback. Entries="+totalEntries);
