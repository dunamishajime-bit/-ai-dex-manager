/** Frozen FAILED_BREAK native transition, no orders or hindsight trade IDs.
 * 6h is the setup confirmation window, not the exit hold duration.
 * Call once per completed aligned H2 boundary and persist the returned state. */
import type {V12Bar} from "./v12-x1-all";
type Setup={sg:1|-1;setupTs:number;atr:number;level:number;momentum90:number;hadPullback:boolean};
export type CoreMachineState={lastDecisionTs:number|null;setup:Setup|null};
export type NativeCoreEvent={symbol:string;side:"SHORT";sg:-1;route:"FAILED_BREAK_REV_SHORT_6H";
 entry_ts_ms:number;decision_ts_ms:number;setup_ts_ms:number;state_age_h:number;onset_momentum90:number;
 atr:number;score:number;orderEnabled:false};
const H=3600000;
function frame(bs:readonly V12Bar[],btc:readonly V12Bar[],now:number){
 if(bs.length<61||btc.length!==bs.length)throw Error("CORE_H2_WARMUP");
 for(let i=0;i<bs.length;i++){
  const b=bs[i],ref=btc[i];
  if(b.endTs>now||ref.endTs>now)throw Error("UNCLOSED_CORE_H2");
  if(b.endTs!==ref.endTs||b.endTs-b.ts!==2*H||ref.endTs-ref.ts!==2*H||
   b.ts%(2*H)||ref.ts%(2*H)||i>0&&(b.ts!==bs[i-1].endTs||ref.ts!==btc[i-1].endTs))
   throw Error("CORE_H2_ALIGNMENT");
  for(const x of [b,ref])if(![x.open,x.high,x.low,x.close,x.volume].every(Number.isFinite)||
   Math.min(x.open,x.high,x.low,x.close)<=0||x.volume<0||
   x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close))throw Error("INVALID_CORE_H2");
 }
 const c=bs.at(-1)!,p=bs.at(-2)!;
 if(c.endTs!==now)throw Error("CORE_DECISION_BOUNDARY_MISMATCH");
 const tr=bs.slice(1).map((x,i)=>Math.max(x.high-x.low,Math.abs(x.high-bs[i].close),Math.abs(x.low-bs[i].close)));
 const atr=tr.slice(-31).reduce((a,b)=>a+b,0)/31;
 const previousAtr=tr.slice(-32,-1).reduce((a,b)=>a+b,0)/31;
 const av=bs.slice(-21,-1).reduce((a,b)=>a+b.volume,0)/20;
 if(Math.min(atr,previousAtr,av)<=0)return null;
 const span=Math.max(c.high-c.low,1e-20),clv=(c.close-c.low)/span;
 const ret6=c.close/bs.at(-4)!.close-1,btc6=btc.at(-1)!.close/btc.at(-4)!.close-1;
 return {c,p,atr,levelHigh:Math.max(...bs.slice(-13,-1).map(b=>b.high)),
  levelLow:Math.min(...bs.slice(-13,-1).map(b=>b.low)),volumeRatio:c.volume/av,
  clvLong:clv,clvShort:1-clv,btc6,ret6,rel6:ret6-btc6,
  bodyAtr:Math.abs(c.close-c.open)/atr,
  momentum90:c.close/bs.at(-46)!.close-1,
  previousMomentum90:p.close/bs.at(-47)!.close-1};
}
export function stepNativeFailedBreakCore(state:CoreMachineState,symbol:string,
 bars:readonly V12Bar[],btc:readonly V12Bar[],now:number):{state:CoreMachineState;event:NativeCoreEvent|null}{
 if(!Number.isFinite(now)||now%(2*H))throw Error("INVALID_CORE_DECISION_TIME");
 if(state.lastDecisionTs!==null&&now<state.lastDecisionTs)throw Error("CORE_DECISION_TIME_REVERSED");
 if(state.lastDecisionTs===now)return {state,event:null};
 const f=frame(bars,btc,now);
 if(!f)return {state:{lastDecisionTs:now,setup:null},event:null};
 let setup=state.setup?{...state.setup}:null;
 let event:NativeCoreEvent|null=null;
 if(setup){
  const age=now-setup.setupTs;
  if(age>6*H||state.lastDecisionTs!==null&&now-state.lastDecisionTs!==2*H)setup=null;
  else{
   const {sg,atr,level}=setup,c=f.c;
   const sameClv=sg===1?f.clvLong:f.clvShort,oppClv=sg===1?f.clvShort:f.clvLong;
   const touch=sg===1?c.low<=level+.25*atr:c.high>=level-.25*atr;
   const reclaim=sg===1?c.close>=level+.05*atr:c.close<=level-.05*atr;
   const retest=touch&&reclaim&&sg*(c.close-c.open)>0&&sameClv>=.60&&f.bodyAtr>=.15&&sg*f.btc6>=-.005;
   if(sg*(c.close-f.p.close)<0)setup.hadPullback=true;
   const clear=sg===1?c.close>=f.p.high+.05*f.atr:c.close<=f.p.low-.05*f.atr;
   const reaccel=setup.hadPullback&&clear&&sameClv>=.65&&f.bodyAtr>=.20&&sg*f.ret6>0&&sg*f.rel6>=0&&sg*f.btc6>=-.005;
   const fail=sg*(c.close-level)<=-.15*atr&&oppClv>=.65&&f.bodyAtr>=.20;
   if(fail||retest||reaccel){
    if(fail&&sg===1)event={symbol,side:"SHORT",sg:-1,route:"FAILED_BREAK_REV_SHORT_6H",
     entry_ts_ms:now,decision_ts_ms:now,setup_ts_ms:setup.setupTs,state_age_h:age/H,
     onset_momentum90:setup.momentum90,atr:f.atr,
     score:Math.max(.01,f.volumeRatio)*Math.max(.01,f.clvShort)*Math.max(.05,f.bodyAtr),orderEnabled:false};
    setup=null;
   }
  }
 }
 if(!setup){
  const sg=f.momentum90>=.0227&&f.previousMomentum90<.0227?1:
   f.momentum90<=-.0227&&f.previousMomentum90>-.0227?-1:0;
  if(sg){
   const clv=sg===1?f.clvLong:f.clvShort;
   const confirm=f.volumeRatio>=.80&&sg*f.ret6>0&&sg*f.rel6>=0&&clv>=.60&&f.bodyAtr>=.20;
   const breakout=sg===1?f.c.close>=f.levelHigh+.05*f.atr:f.c.close<=f.levelLow-.05*f.atr;
   if(confirm&&breakout)setup={sg,setupTs:now,atr:f.atr,level:sg===1?f.levelHigh:f.levelLow,
    momentum90:f.momentum90,hadPullback:false};
  }
 }
 return {state:{lastDecisionTs:now,setup},event};
}
export function selectNativeCoreEvents(events:readonly NativeCoreEvent[],prices:ReadonlyMap<string,number>){
 const groups=new Map<number,NativeCoreEvent[]>();
 for(const event of events){const a=groups.get(event.entry_ts_ms)??[];a.push(event);groups.set(event.entry_ts_ms,a);}
 const out:Array<NativeCoreEvent&{rank:number;requested_gross:number;entry_price:number}>=[];
 for(const [ts,rows] of [...groups].sort((a,b)=>a[0]-b[0])){
  const ranked=[...rows].sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol));
  for(const [i,row] of ranked.slice(0,3).entries()){
   const price=prices.get(row.symbol+"|"+ts);
   if(!(typeof price==="number"&&Number.isFinite(price)&&price>0))throw Error("CORE_ENTRY_REFERENCE_REQUIRED");
   const distance=Math.max(2.477*row.atr,price*.005),gross=Math.min(1,.0319/(distance/price));
   out.push({...row,rank:i+1,requested_gross:i===2?Math.min(.1,gross):gross,entry_price:price});
  }
 }
 return out;
}
