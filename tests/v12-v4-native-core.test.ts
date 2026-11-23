import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-core-20261009.json";
import {stepNativeFailedBreakCore,selectNativeCoreEvents} from "../lib/v12-v4-native-core";
const bars=(name:"symbol"|"btc")=>fixture[name].map(b=>({...b,sourceCount:2 as const}));
test("Core confirms a failed upward break using only completed H2 and matches its frozen event",()=>{
 const symbol=bars("symbol"),btc=bars("btc");let state:any={lastDecisionTs:null,setup:null};
 const events:any[]=[];
 for(let i=120;i<symbol.length;i++){
  const out=stepNativeFailedBreakCore(state,fixture.expected.symbol,symbol.slice(Math.max(0,i-120),i+1),
    btc.slice(Math.max(0,i-120),i+1),symbol[i].endTs);state=out.state;if(out.event)events.push(out.event);
 }
 assert.equal(events.length,1);const got=events[0],want=fixture.expected;
 for(const key of ["symbol","side","entry_ts_ms","setup_ts_ms","state_age_h","onset_momentum90","atr","score"]){
  const a=got[key],b=(want as any)[key];
  if(typeof a==="number")assert.ok(Math.abs(a-b)<1e-10,key);else assert.equal(a,b,key);
 }
 const selected=selectNativeCoreEvents(events,new Map([[want.symbol+"|"+want.entry_ts_ms,want.entry_price]]));
 assert.equal(selected[0].requested_gross,fixture.selected.requested_gross);
 assert.equal(selected[0].rank,fixture.selected.rank);
});
test("repeated decision cannot emit the same Core event and future H2 is rejected",()=>{
 const symbol=bars("symbol"),btc=bars("btc"),now=symbol.at(-1)!.endTs;
 const state={lastDecisionTs:now,setup:null};
 assert.deepEqual(stepNativeFailedBreakCore(state,fixture.expected.symbol,symbol.slice(-121),btc.slice(-121),now),{state,event:null});
 assert.throws(()=>stepNativeFailedBreakCore({lastDecisionTs:null,setup:null},fixture.expected.symbol,
  symbol.slice(-121),btc.slice(-121),now-7200000),/UNCLOSED_CORE_H2/);
});
test("Core selection uses observed entry price and risk distance, with rank3 capped at 0.10x",()=>{
 const now=fixture.expected.entry_ts_ms;
 const events=["ETHUSDT","INJUSDT","LTCUSDT","SOLUSDT"].map((symbol,i)=>({...fixture.expected,symbol,score:4-i,atr:10,side:"SHORT" as const,sg:-1 as const,route:"FAILED_BREAK_REV_SHORT_6H" as const,orderEnabled:false as const}));
 const prices=new Map(events.map(x=>[x.symbol+"|"+now,100]));
 const out=selectNativeCoreEvents(events,prices);
 assert.equal(out.length,3);assert.equal(out[0].requested_gross,.0319/(2.477*10/100));
 assert.equal(out[2].requested_gross,.1);
 assert.throws(()=>selectNativeCoreEvents(events,new Map()),/CORE_ENTRY_REFERENCE_REQUIRED/);
});
test("native failed-break source cannot also open recovery routes from the same setup",async()=>{
 const {adaptProductionCandidates}=await import("../lib/v12-v4-production-features");
 const H=3600000,t=fixture.expected.entry_ts_ms;
 const make=(slope:number)=>Array.from({length:48},(_,i)=>({openTs:t-(48-i)*H,
  open:100+i*slope,high:101+i*slope,low:99+i*slope,close:99.5+i*slope,quoteVolume:1000}));
 const result=adaptProductionCandidates({source:{symbol:"ETHUSDT",side:"LONG",eligibleSourceEntryTs:t,
  decisionTs:t,momentumConditionAgeHours:0,coreRequestedGross:1,sourceEngine:"FAILED_BREAK_NATIVE",
  sourceParityVerified:false,failedBreak:{freshUpward90hOnset:true,structuralUpBreak:true,
   failedBelowWithin6h:true,oppositeClvBodyConfirm:true}},
  decisionTs:t,symbolBars:make(.2),btcBars:make(.05)});
 assert.deepEqual(result.candidates.map(x=>x.route),["FAILED_BREAK_REV_SHORT_6H"]);
});
