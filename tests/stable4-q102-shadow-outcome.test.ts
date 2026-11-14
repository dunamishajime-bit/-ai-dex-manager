import test from "node:test";
import assert from "node:assert/strict";
import * as model from "../lib/stable4-q102-shadow-outcome";
const H=3600000,M=300000,T=1800000000000;
const bar=(t:number,open=100,high=open,low=open,close=open)=>({timestampMs:t,open,high,low,close,quoteVolume:1});
function input(overrides:any={}){
 return {entryTs:T,entryPrice:100,side:"SHORT",family:"MR",hardStop:.07,maxHoldHours:1,exitPolicy:"FIXED_HOLD_STOP",now:T+2*H,
  fiveMinute:Array.from({length:24},(_,i)=>bar(T+i*M,i>=12?90:100)),hourly:[bar(T)],
  funding:{from:T,through:T+2*H,capturedAt:T+2*H,rows:[]},...overrides};
}
test("native shadow outcomes preserve research short-return convention and actual signed funding",()=>{
 const x=input({funding:{from:T,through:T+2*H,capturedAt:T+2*H,rows:[{fundingTime:T+H/2,fundingRate:.001} ]}});
 const out=(model as any).modelStable4Q102Outcome(x);
 assert.equal(out.exitTs,T+H);assert.equal(out.exitPrice,90);
 assert.ok(Math.abs(out.rawReturn-(100/90-1))<1e-12);
 assert.ok(Math.abs(out.net30-(100/90-1+.001-.003))<1e-12);
});
test("resident hard STOP uses gap-aware fill and actual completed M5 exit time",()=>{
 const x=input({side:"LONG",hardStop:.05,fiveMinute:[bar(T),bar(T+M,90,91,88,89)],now:T+2*M,hourly:[],funding:{from:T,through:T+2*M,capturedAt:T+2*M,rows:[]}});
 const out=(model as any).modelStable4Q102Outcome(x);
 assert.equal(out.exitTs,T+2*M);assert.equal(out.exitPrice,90);assert.equal(out.exitReason,"HARD_STOP");
});
test("PB initial-adverse outcome uses completed M5 close after three hours",()=>{
 const x=input({side:"LONG",family:"PB",hardStop:.07,maxHoldHours:12,now:T+3*H,
  fiveMinute:Array.from({length:36},(_,i)=>bar(T+i*M,100,100.1,i===35?98:100,i===35?98:100)),
  funding:{from:T,through:T+3*H,capturedAt:T+3*H,rows:[]}});
 const out=(model as any).modelStable4Q102Outcome(x);assert.equal(out.exitTs,T+3*H);assert.equal(out.exitPrice,98);assert.match(out.exitReason,/INITIAL_ADVERSE/);
});
test("missing, duplicate, future M5 or uncovered funding cannot silently create a completed label",()=>{
 const fn=(model as any).modelStable4Q102Outcome;
 const x=input();
 assert.throws(()=>fn({...x,fiveMinute:x.fiveMinute.filter((_:any,i:number)=>i!==5)}),/M5_GAP/);
 assert.throws(()=>fn({...x,fiveMinute:[...x.fiveMinute,x.fiveMinute[0]]}),/M5_DUPLICATE/);
 assert.throws(()=>fn({...x,fiveMinute:[...x.fiveMinute,bar(T+3*H)]}),/FUTURE/);
 assert.throws(()=>fn({...x,funding:{...x.funding,through:T+H-1}}),/FUNDING_COVERAGE/);
});
test("HIGH_VOL 72-hour close is available at the candle end, including terminal historical trades",()=>{
 const out=(model as any).modelStable4Q102Outcome(input({family:"HIGH_VOL",exitPolicy:"HIGH_VOL_TRAIL72",hardStop:.1,maxHoldHours:72,now:T+72*H,fiveMinute:[],hourly:Array.from({length:72},(_,i)=>bar(T+i*H)),funding:{from:T,through:T+72*H,capturedAt:T+72*H,rows:[]}}));
 assert.equal(out.exitTs,T+72*H);assert.equal(out.exitPrice,100);assert.equal(out.exitReason,"72h_time");
});
