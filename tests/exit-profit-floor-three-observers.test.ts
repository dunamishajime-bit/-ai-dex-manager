import test from "node:test";
import assert from "node:assert/strict";
import {
 observeThreeFloorH1History,validateThreeExitFloorShadowState,
} from "../lib/exit-profit-floor-three-observers";
import { EXIT_FLOOR_HOUR_MS as H, type ExitFloorIdentity } from "../lib/exit-profit-floor-three";
const start=500*H;
const mr:ExitFloorIdentity={owner:"Q102",family:"MR",symbol:"ETHUSDT",side:"SHORT",
 entryTs:start,entryPrice:100,entryQuantity:3,legId:"Q102:ETHUSDT:"+start+":-1"};
const rows=(closes:number[])=>closes.map((close,i)=>({
 timestampMs:start+i*H,open:close,high:close+2,low:close-2,close,
}));
test("closed H1 MR persists only after 3% favorable and retains prior activation",()=>{
 const candles=rows([99,97,96,95]);
 const first=observeThreeFloorH1History({identity:mr,closedCandles:candles.slice(0,2),
  observedAt:start+2*H});
 assert.equal(first.state?.armed,true);
 assert.equal(first.state?.floorStopPrice,99);
 assert.equal(first.state?.effectiveFromTs,start+2*H);
 assert.equal(first.newBars,2);
 assert.equal(first.armedOnThisCall,true);
 const second=observeThreeFloorH1History({identity:mr,closedCandles:candles,
  observedAt:start+4*H,previous:first.state});
 assert.equal(second.newBars,2);
 assert.equal(second.armedOnThisCall,false);
 assert.equal(second.state?.effectiveFromTs,first.state?.effectiveFromTs);
 assert.equal(second.state?.lastClosedH1OpenTs,start+3*H);
 assert.deepEqual(validateThreeExitFloorShadowState(second.state),second.state);
});
test("duplicate/old H1 recovery is read-only and not rearmed",()=>{
 const candles=rows([99,97,96]);
 const one=observeThreeFloorH1History({identity:mr,closedCandles:candles,
  observedAt:start+3*H});
 const two=observeThreeFloorH1History({identity:mr,closedCandles:candles,
  observedAt:start+3*H,previous:one.state});
 assert.equal(two.newBars,0);
 assert.deepEqual(two.state,one.state);
});
test("H1 gap and future input fail closed",()=>{
 const b=rows([99,97,96]);
 assert.throws(()=>observeThreeFloorH1History({identity:mr,closedCandles:[b[0],b[2]],
  observedAt:start+3*H}),/GAP_OR_REVERSE/);
 assert.throws(()=>observeThreeFloorH1History({identity:mr,closedCandles:b,
  observedAt:start+2*H}),/FUTURE_H1/);
});
test("late mid-hour entry cannot use partially observed initial bar",()=>{
 const x={...mr,entryTs:start+20_000};
 const res=observeThreeFloorH1History({identity:x,closedCandles:rows([91,99,96]),
  observedAt:start+3*H});
 assert.equal(res.newBars,2);
 assert.equal(res.state?.armed,true);
});
test("all excluded owners are inert",()=>{
 const x={...mr,owner:"PENGU",family:"MR"};
 const r=observeThreeFloorH1History({identity:x,closedCandles:rows([94]),
  observedAt:start+H});
 assert.equal(r.newBars,0);assert.equal(r.state,undefined);
});
test("strict restart shadow schema rejects unexpected/unarmed-stop fields",()=>{
 const a=observeThreeFloorH1History({identity:mr,closedCandles:rows([99]),
   observedAt:start+H}).state!;
 assert.equal(a.armed,false);
 assert.throws(()=>validateThreeExitFloorShadowState({...a,unexpected:true}),/MALFORMED/);
 assert.throws(()=>validateThreeExitFloorShadowState({...a,floorStopPrice:99}),/UNARMED/);
});
test("state validator refuses owner and stop price spoofing",()=>{
 const a=observeThreeFloorH1History({identity:mr,closedCandles:rows([96]),
   observedAt:start+H}).state!;
 assert.throws(()=>validateThreeExitFloorShadowState({...a,owner:"PENGU"}),/MALFORMED/);
 assert.throws(()=>validateThreeExitFloorShadowState({...a,floorStopPrice:110}),/ARMED_STATE_INVALID/);
});
