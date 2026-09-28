import assert from "node:assert/strict";
import { evaluateFetBrk48PreEntryGates } from "@/lib/fet-brk48-preentry-gates";
import type { FetBrk48Bar } from "@/lib/fet-brk48-signal";
const H=3_600_000, ENTRY=100_000*H;
function bars(n:number,price:(i:number)=>number,spread=.01):FetBrk48Bar[]{
  return Array.from({length:n},(_,i)=>{
    const openTs=ENTRY-(n-i)*H,close=price(i);
    return {openTs,closeTs:openTs+H-1,open:close,high:close*(1+spread),
      low:close*(1-spread),close,volume:100};
  });
}
const flatFet=bars(73,()=>100),flatBtc=bars(25,()=>100);
let x=evaluateFetBrk48PreEntryGates(flatFet,flatBtc,ENTRY);
assert.equal(x.allow,true);
assert.equal(x.reason,"PASS");
const overheat=bars(73,i=>i<48?100:100+16*(i-48)/24,.02);
x=evaluateFetBrk48PreEntryGates(overheat,flatBtc,ENTRY);
assert.equal(x.allow,false);
assert.equal(x.reason,"FET_PREENTRY_OVERHEAT_24H_15PCT_ATR_2PCT");
const btcRising=bars(25,i=>100+i*.15);
x=evaluateFetBrk48PreEntryGates(flatFet,btcRising,ENTRY);
assert.equal(x.allow,false);
assert.equal(x.reason,"FET_PREENTRY_RELATIVE_WEAK_BTC_AND_FET24H_LT_1PCT");
assert.throws(()=>evaluateFetBrk48PreEntryGates(flatFet,flatBtc.slice(1),ENTRY),/MISSING_H1/);
const broken=[...flatFet];broken[17]={...broken[17],openTs:broken[17].openTs+H};
assert.throws(()=>evaluateFetBrk48PreEntryGates(broken,flatBtc,ENTRY),/GAPPED_H1/);
const unclosed=[...flatFet];unclosed[72]={...unclosed[72],closeTs:ENTRY};
assert.throws(()=>evaluateFetBrk48PreEntryGates(unclosed,flatBtc,ENTRY),/GAPPED_H1/);
console.log("FET_DUAL_PREENTRY_H1_GATE_SELFTEST_PASS",JSON.stringify({normal:true,overheat:true,relativeWeak:true,missingFailsClosed:true,nonContiguousFailsClosed:true,unclosedFailsClosed:true}));
