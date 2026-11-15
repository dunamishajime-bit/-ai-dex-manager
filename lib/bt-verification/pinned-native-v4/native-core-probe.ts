/**
 * Pinned native V4 FAILED_BREAK H2 source-only diagnostic, NEVER an order.
 * Not full V4 or production SHA parity. State remains in memory.
 */
import {stepNativeFailedBreakCore,type CoreMachineState,type NativeCoreEvent}
 from "./v12-v4-native-core";
import type {V12Bar} from "./native-v12-bar-type";
import type {SyntheticMarket5m,SyntheticStep,SyntheticSymbol,MarketCandle5m}
 from "../synthetic-market";
const H=3600000,TWO=2*H,LEN=122;
export const V4_NATIVE_CORE_TARGETS=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT",
 "LINKUSDT","AVAXUSDT","DOGEUSDT","INJUSDT","XRPUSDT","ADAUSDT",
 "LTCUSDT","ATOMUSDT","AAVEUSDT","NEARUSDT"] as const;
export const V4_NATIVE_CORE_PIN={
 sourceRevision:"9118eeaa6c209dc6e37887cf5be139b3baaa005d",
 originalSha256:"f1d97f477f2b23e74f8b98cf59813f3c1650479e3c8cbadf6e2fdeeab90a7344",
 requiredH2:61,fullV4Parity:false,orders:0
} as const;
export type V4NativeCoreShadow={
 at:string;status:"NOT_H2"|"MISSING_SYMBOLS"|"WARMUP_61_H2"|
 "SOURCE_INVALID"|"SOURCE_EVALUATED";
 missingSymbols:readonly string[];
 evaluatedSymbols:readonly string[];
 nativeEvents:readonly NativeCoreEvent[];
 fills:0;fullV4Parity:false;
};
function result(at:string,status:V4NativeCoreShadow["status"],
 patch?:Partial<V4NativeCoreShadow>):V4NativeCoreShadow{
 return {at,status,missingSymbols:[],evaluatedSymbols:[],nativeEvents:[],
  fills:0,fullV4Parity:false,...patch};
}
function h2(symbol:string,rows:readonly MarketCandle5m[],asOf:number):V12Bar[]{
 if(rows.length!==LEN)throw Error("V4_NATIVE_H2_122_H1_REQUIRED");
 let last:number|null=null;
 const out:V12Bar[]=[];
 for(let i=0;i<LEN;i+=2){
  const a=rows[i],b=rows[i+1];
  const from=Date.parse(a.openTime),middle=Date.parse(a.closedAt),
    bStart=Date.parse(b.openTime),end=Date.parse(b.closedAt);
  if(!Number.isFinite(from)||from%TWO!==0||
     middle!==from+H||middle!==bStart||end!==from+TWO||
     end>asOf||(last!==null&&last!==from)||
     a.symbol!==symbol||b.symbol!==symbol||
     a.category!=="crypto"||b.category!=="crypto"||
     a.partialSession||b.partialSession||a.ticks!==12||b.ticks!==12||
     ![a.open,a.high,a.low,a.close,a.volume,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||
     a.open<=0||a.low<=0||a.close<=0||b.open<=0||b.low<=0||b.close<=0||
     a.volume<0||b.volume<0||
     a.high<Math.max(a.open,a.close)||a.low>Math.min(a.open,a.close)||
     b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))
      throw Error("V4_NATIVE_H2_CAUSAL_INPUT_REJECTED");
  out.push({ts:from,endTs:end,sourceCount:2,open:a.open,
    high:Math.max(a.high,b.high),low:Math.min(a.low,b.low),
    close:b.close,volume:a.volume+b.volume});
  last=end;
 }
 if(last!==asOf||out.length!==61)throw Error("V4_NATIVE_H2_STALE");
 return out;
}
export class V4NativeFailedBreakShadow{
 private state=new Map<string,CoreMachineState>();
 inspect(feed:SyntheticMarket5m,step:SyntheticStep):V4NativeCoreShadow{
  const now=Date.parse(step.observedAt);
  if(!Number.isFinite(now)||now%TWO!==0||
     !step.completedH1.some(x=>x.symbol==="BTCUSDT"&&Date.parse(x.closedAt)===now))
     return result(step.observedAt,"NOT_H2");
  const have=new Set<string>(feed.description.symbols);
  const missing=V4_NATIVE_CORE_TARGETS.filter(x=>!have.has(x));
  if(missing.length)return result(step.observedAt,"MISSING_SYMBOLS",{missingSymbols:missing});
  const series=new Map<string,V12Bar[]>();
  for(const symbol of V4_NATIVE_CORE_TARGETS){
   const history=feed.historyH1(symbol as SyntheticSymbol,LEN);
   if(history.length<LEN)return result(step.observedAt,"WARMUP_61_H2");
   try{series.set(symbol,h2(symbol,history,now))}
   catch{return result(step.observedAt,"SOURCE_INVALID")}
  }
  const next=new Map(this.state),events:NativeCoreEvent[]=[],evaluated:string[]=[];
  try{
   for(const symbol of V4_NATIVE_CORE_TARGETS){
    if(symbol==="BTCUSDT")continue;
    const prior=this.state.get(symbol)??{lastDecisionTs:null,setup:null};
    const sample=stepNativeFailedBreakCore(prior,symbol,series.get(symbol)!,
      series.get("BTCUSDT")!,now);
    next.set(symbol,sample.state);evaluated.push(symbol);
    if(sample.event){
     if(sample.event.orderEnabled!==false||sample.event.entry_ts_ms>now)
        throw Error("V4_NATIVE_INVALID_SOURCE_EVENT");
     events.push(sample.event);
    }
   }
  }catch{return result(step.observedAt,"SOURCE_INVALID")}
  this.state=next;
  return result(step.observedAt,"SOURCE_EVALUATED",{
    evaluatedSymbols:evaluated,nativeEvents:events});
 }
}
