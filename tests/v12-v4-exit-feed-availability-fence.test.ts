import test from "node:test";
import assert from "node:assert/strict";
import {evaluateV12V4Routes} from "../lib/v12-multilogic-v4-shadow";
import {createProductionState,planProductionEntry,applyProductionEvent} from "../lib/v12-v4-production-lifecycle";
import {appendV4ClosedExitBars} from "../lib/v12-v4-live-exit-feed";
const T=200*3600000,M=300000;
async function owned(){
 const base=evaluateV12V4Routes({symbol:"ETHUSDT",sourceSide:"SHORT",sourceSignalTs:T,age:2,volRatio:.5,er24:.5})[0];
 const candidate={...base,route:"REC_X09_TIME_48H",family:"RECOVERY_X",effectiveSide:"LONG" as const,requestedGross:.1};
 let state=createProductionState({equityUsd:1000,foreign:[],holdProtected:false});
 const e=await planProductionEntry(state,{candidate,ts:T,eventId:"reserve",referencePrice:100,entryAtr:1,minimumOrderNotionalUsd:5,quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any});
 state=applyProductionEvent(state,e);state=applyProductionEvent(state,{type:"ENTRY_FILL",id:e.leg.id,eventId:"fill",ts:T+1,qty:1,price:100,feeUsd:0});state=applyProductionEvent(state,{type:"ENTRY_TERMINAL",id:e.leg.id,eventId:"terminal",ts:T+2});return{state,id:e.leg.id};
}
const bar=(openTs:number,observedAt:number)=>({openTs,open:100,high:100.1,low:99.9,close:100,observedAt});
test("fetch crossing an M5 close evaluates only the provider's captured availability fence",async()=>{
 const {state,id}=await owned(),captured=T+2*M-1,applied=T+2*M+100;
 const next=appendV4ClosedExitBars(state,id,{closed:[],closedM5:[bar(T,captured)],availableThrough:captured} as any,applied);
 assert.equal(next.legs[id].fourRuleState?.lastM5OpenTs,T);assert.equal(next.journal.at(-1)?.ts,applied);
 const later=appendV4ClosedExitBars(next,id,{closed:[],closedM5:[bar(T+M,applied)],availableThrough:applied} as any,applied);
 assert.equal(later.legs[id].fourRuleState?.lastM5OpenTs,T+M);
});
test("genuinely missing data before the captured fence still rejects",async()=>{
 const {state,id}=await owned();assert.throws(()=>appendV4ClosedExitBars(state,id,{closed:[],closedM5:[],availableThrough:T+2*M-1} as any,T+2*M+100),/M5_GAP/);
});
test("invalid future or nonnumeric availability cannot expand or silently erase observation coverage",async()=>{
 const {state,id}=await owned(),at=T+2*M+100;
 for(const availableThrough of [at+1,T-1,NaN,"1",null])assert.throws(()=>appendV4ClosedExitBars(state,id,{closed:[],closedM5:[bar(T,at),bar(T+M,at)],availableThrough} as any,at),/AVAILABILITY/);
});
