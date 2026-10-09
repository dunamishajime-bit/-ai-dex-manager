import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/v12-v4-native-core-20261009.json";
import {attachV4NativeCoreCandidates} from "../lib/v12-v4-core-candidate";
const H=3600000,t=fixture.expected.entry_ts_ms;
const make=(slope:number)=>Array.from({length:48},(_,i)=>({openTs:t-(48-i)*H,
 open:100+i*slope,high:101+i*slope,low:99+i*slope,close:99.5+i*slope,
 quoteVolume:1000,volume:1000}));
test("native core maps true failed-upward-break into its single SHORT route and ATR",()=>{
 const base:any={schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE",
 decisionTs:t,capturedAtMs:t+5000,sourceFingerprint:"fixture",candidateCount:0,
 filteredCount:0,sourceCount:0,errors:[],candidates:[],filtered:[],entryAtrByCandidate:{},
 nativeCoreEvents:[{...fixture.expected,orderEnabled:false}],orderEnabled:false,
 realOrderEnabledV4:0,tradingMutation:0};
 const result=attachV4NativeCoreCandidates(base,{INJ:make(.2),BTC:make(.05)},
  new Map([[fixture.expected.symbol+"|"+t,fixture.expected.entry_price]]));
 assert.equal(result.candidateCount,1);
 assert.equal(result.candidates[0].route,"FAILED_BREAK_REV_SHORT_6H");
 assert.equal(result.candidates[0].effectiveSide,"SHORT");
 assert.equal(result.orderEnabled,false);
 const k=[fixture.expected.symbol,result.candidates[0].route,"SHORT",t].join("|");
 assert.equal(result.entryAtrByCandidate[k],fixture.expected.atr);
});
