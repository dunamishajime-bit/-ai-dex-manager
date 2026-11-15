/**
 * Offline, deterministic V52 dual-quote input adapter.
 * This is NOT a calibrated venue simulator or an execution engine.
 * Underlying stock 5m bars are synthetic; source REFERENCE and ASTER
 * microquote prices are separately modeled at +/-5 sec around NY windows.
 * The native 85-line V52 V50 source method is tested in Python against these
 * as-of pairs. Nothing here sends HTTP, orders, STOP, or real money.
 */
import {SyntheticMarket5m,type SyntheticScenario} from "../lib/bt-verification/synthetic-market";

const V50_WINDOWS = new Map([
 ["11:25","11:30"],["12:25","12:30"],["13:25","13:30"]
]);
export const V52_NATIVE_STOCK_UNIVERSE=["AMZN","META","MSFT","NVDA","TSLA"] as const;
const H=3_600_000;
export type ModeledSourceTick={
 referencePrice:number;referenceReceivedMs:number;
 asterMid:number;asterBid:number;asterAsk:number;asterReceivedMs:number;
 spreadBps:number;depthUsd:number;roundTripCostBps:number
};
export type V52ModeledPair={
 symbol:typeof V52_NATIVE_STOCK_UNIVERSE[number];
 capture:ModeledSourceTick;decision:ModeledSourceTick;
};
export type V52ModeledEvent={
 nyDay:string;window:string;lastObserved5m:string;captureAtMs:number;decisionAtMs:number;
 pairs:readonly V52ModeledPair[]
};
export type V52ModeledTrace={
 schema:"disdex-bt-v52-dual-source-input-v1";
 seed:number;scenario:SyntheticScenario;feed:"synthetic-v1-23-symbol";
 start:string;endExclusive:string;
 sessionCalendar:"NY_WEEKDAY_RTH_ONLY_NO_HOLIDAYS";
 venueTruth:false;stockReferenceTruth:false;fills:0;fullV52Parity:false;
 sourceTiming:"five-second-before-and-after-scheduled-NY-entry";
 inputs:readonly V52ModeledEvent[];
 warning:string;
};
const random=(seed:number)=>{
 let s=seed>>>0;
 return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return (s+.5)/4294967296;};
};
const fmt=new Intl.DateTimeFormat("en-US",{
 timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",
 weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
});
function nyClock(now:number){
 const parts=fmt.formatToParts(now);
 const get=(key:string)=>parts.find(p=>p.type===key)?.value??"";
 return {date:[get("year"),get("month"),get("day")].join("-"),
   clock:get("hour")+":"+get("minute"),weekday:get("weekday")};
}
const rounded=(x:number)=>Number(x.toPrecision(12));
export function createV52ModeledDualSourceTrace(
 seed:number,scenario:SyntheticScenario
):V52ModeledTrace{
 const start="2025-10-01T00:00:00Z",endExclusive="2025-10-18T00:00:00Z";
 const feed=new SyntheticMarket5m(seed,scenario,{
   start,endExclusive,version:"v1"
 });
 const next=random(seed^0x52a5f03);
 const inputs:V52ModeledEvent[]=[];
 feed.runToEnd(step=>{
  const observed=Date.parse(step.observedAt);
  const clock=nyClock(observed);
  const window=V50_WINDOWS.get(clock.clock);
  if(!window||clock.weekday==="Sat"||clock.weekday==="Sun")return;
  const quotes=V52_NATIVE_STOCK_UNIVERSE.map(symbol=>
    step.quotes.find(q=>q.symbol===symbol));
  if(quotes.some(q=>!q||!q.tradable||q.category!=="stock"||q.price<=0))
    return;
  const captureAtMs=observed+4*60_000+55_000;
  const decisionAtMs=observed+5*60_000+5_000;
  const pairs=V52_NATIVE_STOCK_UNIVERSE.map((symbol,i)=>{
   const known=quotes[i]!;
   // Distinct fabricated reference microprice and modeled Aster basis.
   // Both are generated sequentially using only the already-observed 5m
   // stock quote; no next OHLC tick from the feed is read.
   const refCapture=rounded(known.price*(1+(next()-.5)*.00018));
   const basisCapture=(next()-.5)*190;
   const venueCapture=rounded(refCapture*(1+basisCapture/10_000));
   const refDecision=rounded(refCapture*(1+(next()-.5)*.00022));
   const basisDecision=basisCapture+(next()-.5)*16;
   const venueDecision=rounded(refDecision*(1+basisDecision/10_000));
   const spreadCapture=rounded(3+next()*9);
   const spreadDecision=rounded(3+next()*9);
   const captureDepth=rounded(500+next()*5_000);
   const decisionDepth=rounded(500+next()*5_000);
   const captureCost=rounded(5+next()*26);
   const decisionCost=rounded(5+next()*26);
   function build(refPrice:number,mid:number,at:number,spread:number,depth:number,cost:number)
      :ModeledSourceTick{
    return {
      referencePrice:refPrice,referenceReceivedMs:at-320,
      asterMid:mid,
      asterBid:rounded(mid*(1-spread/20_000)),
      asterAsk:rounded(mid*(1+spread/20_000)),
      asterReceivedMs:at-120,
      spreadBps:spread,depthUsd:depth,roundTripCostBps:cost
    };
   }
   return {symbol,capture:build(refCapture,venueCapture,captureAtMs,
     spreadCapture,captureDepth,captureCost),
    decision:build(refDecision,venueDecision,decisionAtMs,
     spreadDecision,decisionDepth,decisionCost)};
  });
  inputs.push({nyDay:clock.date,window,lastObserved5m:step.observedAt,
    captureAtMs,decisionAtMs,pairs});
 });
 if(inputs.length===0||inputs.some(x=>x.pairs.length!==5))
   throw Error("V52_SOURCE_TIMED_INPUT_INCOMPLETE");
 return {schema:"disdex-bt-v52-dual-source-input-v1",seed,scenario,
   feed:"synthetic-v1-23-symbol",start,endExclusive,
   sessionCalendar:"NY_WEEKDAY_RTH_ONLY_NO_HOLIDAYS",
   venueTruth:false,stockReferenceTruth:false,fills:0,fullV52Parity:false,
   sourceTiming:"five-second-before-and-after-scheduled-NY-entry",
   inputs,
   warning:"All venue and reference microquotes are artificial; NYSE holidays are not modeled. Exact native v50_candidate code can be tested on two causal quote sources, but no strategy execution, venue parity, PnL, 10/30bps integrated portfolio or LIVE certification exists."};
}
if(process.argv[1]?.endsWith("bt-hp-v52-dual-source-synthetic-input.ts")){
 process.stdout.write(JSON.stringify(createV52ModeledDualSourceTrace(
   Number(process.argv[2]??20261115),
   (process.argv[3]??"rotation") as SyntheticScenario
 )));
}
