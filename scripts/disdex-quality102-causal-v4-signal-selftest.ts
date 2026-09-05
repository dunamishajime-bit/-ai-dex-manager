import assert from "node:assert/strict";
import { buildQuality102CausalV4Signal } from "../lib/disdex-quality102-causal-v4-signal";
import type { Quality102Candle } from "../lib/disdex-quality102-causal-pipeline";

const HOUR=3_600_000;
const NOW=Date.UTC(2026,8,5,13,0,5);
const ENTRY_TS=Math.floor(NOW/HOUR)*HOUR;

function highVolOnlyRows(): Quality102Candle[] {
  const count=225*24;
  const start=ENTRY_TS-count*HOUR;
  const rows:Quality102Candle[]=Array.from({length:count},(_,i)=>({timestampMs:start+i*HOUR,open:100,high:101,low:99,close:100,quoteVolume:1000,baseVolume:100}));
  const set=(i:number,close:number,open=close)=>{ rows[i]={...rows[i],open,close,high:Math.max(open,close)*1.01,low:Math.min(open,close)*0.99}; };
  const addWinner=(i:number)=>{
    set(i-336,90); set(i-24,120);
    for(let j=i-23;j<i;j++) set(j,120-(j-(i-24))*0.8);
    set(i,100,99); for(let j=i+1;j<i+72;j++) set(j,100); set(i+72,112);
  };
  for(const i of [650,1250,1850,2450,3050,3650]) addWinner(i);
  const current=rows.length-1; set(current-336,90); set(current-24,120);
  for(let j=current-23;j<current;j++) set(j,120-(j-(current-24))*0.8);
  set(current,100,99); return rows;
}
function flat(symbol:string, entryOpen:number, lastClose=100, close24=100){
  const count=181*24;
  const start=ENTRY_TS-count*HOUR;
  const rows:Quality102Candle[]=Array.from({length:count},(_,i)=>({timestampMs:start+i*HOUR,open:100,high:101,low:99,close:100,quoteVolume:1000,baseVolume:100}));
  rows[rows.length-25]={...rows[rows.length-25],close:close24};
  rows[rows.length-1]={...rows[rows.length-1],close:lastClose,high:Math.max(101,lastClose),low:Math.min(99,lastClose)};
  return {history:{candlesBySymbol:{[symbol]:rows},entryOpenBySymbol:{[symbol]:{timestampMs:ENTRY_TS,open:entryOpen}}},rows};
}

{
  const {history}=flat("FETUSDT",125,94,100);
  const s=buildQuality102CausalV4Signal({history,decisionTs:NOW,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false}});
  assert.equal(s.family,"REV"); assert.equal(s.side,1); assert.equal(s.symbol,"FETUSDT");
  assert.equal(s.exitPolicy,"FIXED_HOLD_STOP"); assert.ok((s.maxHoldHours??0)<=24); assert.equal(s.referenceTs,ENTRY_TS);
}
{
  const {history}=flat("APTUSDT",123,94,100);
  const s=buildQuality102CausalV4Signal({history,decisionTs:NOW,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false}});
  assert.equal(s.side,0); assert.equal(s.reason,"QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL");
}
{
  const {history}=flat("FETUSDT",125,94,100);
  const s=buildQuality102CausalV4Signal({history,decisionTs:NOW,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:true}});
  assert.equal(s.side,0); assert.equal(s.reason,"QUALITY102_CAUSAL_V4_BASE_NOT_IDLE");
}

{
  const hv=highVolOnlyRows();
  const calm=hv.map(r=>({...r,open:100,high:101,low:99,close:100,quoteVolume:1000,baseVolume:100}));
  const history={candlesBySymbol:{AVAXUSDT:hv,AAVEUSDT:calm},entryOpenBySymbol:{AVAXUSDT:{timestampMs:ENTRY_TS,open:100},AAVEUSDT:{timestampMs:ENTRY_TS,open:100}}};
  const s=buildQuality102CausalV4Signal({history,decisionTs:NOW,sleeveOccupancy:{activePosition:false,unresolvedPendingEntry:false,basePositionActive:false}}, {highVolSymbols:["AAVEUSDT"]});
  assert.notEqual(s.family,"HIGH_VOL","S34-only AVAX must not enter the HIGH_VOL scanner universe");
}
console.log("QUALITY102_CAUSAL_V4_SIGNAL_SELFTEST_PASS");
