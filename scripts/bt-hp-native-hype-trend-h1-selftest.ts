import {strict as assert} from "node:assert";
import {parseCandles,compareSignalSets} from "./bt-hp-native-hype-trend-h1-signal-replay";

const HOUR=3600000;
const START=Date.parse("2025-09-24T00:00:00Z");
function fixture(symbol:string,count=300){
 return {symbol,interval:"1h",rows:Array.from({length:count},(_,i)=>{
  const t=START+i*HOUR;
  return [t,100,105,99,101,20,t+HOUR-1];
 })};
}
let tests=0;
function check(name:string,fn:()=>void){fn();tests++;}

check("valid contiguous candle history",()=>{
 const c=parseCandles(fixture("HYPEUSDT"),"HYPEUSDT");
 assert.equal(c.length,300);
 assert.equal(c[0].openTime,START);
 assert.equal(c[299].close,101);
});
check("unknown symbol fails closed",()=>{
 assert.throws(()=>parseCandles(fixture("HYPEUSDT"),"BTCUSDT"),/INVALID_H1_IDENTITY/);
});
check("incomplete warmup fails closed",()=>{
 assert.throws(()=>parseCandles(fixture("HYPEUSDT",240),"HYPEUSDT"),/INSUFFICIENT_HYPE_TREND_H1_HISTORY/);
});
check("future candle time gap fails closed",()=>{
 const v=fixture("BTCUSDT");v.rows[149][0]+=HOUR;
 assert.throws(()=>parseCandles(v,"BTCUSDT"),/H1_GAP_OR_INVALID_CANDLE/);
});
check("incorrect close time fails closed",()=>{
 const v=fixture("BTCUSDT");v.rows[75][6]+=1;
 assert.throws(()=>parseCandles(v,"BTCUSDT"),/H1_GAP_OR_INVALID_CANDLE/);
});
check("non-physical price candle fails closed",()=>{
 const v=fixture("BTCUSDT");v.rows[4][2]=100;
 assert.throws(()=>parseCandles(v,"BTCUSDT"),/H1_GAP_OR_INVALID_CANDLE/);
});
check("matching two exact signal sets succeeds",()=>{
 assert.deepEqual(compareSignalSets([3,1,2],[2,3,1]),{matched:3,missing:[],extra:[],pass:true});
});
check("missing/extra candidates remain explicit",()=>{
 assert.deepEqual(compareSignalSets([1,4],[1,2]),{matched:1,missing:[2],extra:[4],pass:false});
});
check("duplicate accepted signal fails closed",()=>{
 assert.throws(()=>compareSignalSets([1,1],[1]),/DUPLICATE_CANDIDATE_TIMESTAMPS/);
});
console.log(JSON.stringify({status:"PASS",tests}));
