/**
 * One-source-route V4 H2-native research auditor, no venue I/O or fills.
 * The 14-symbol upstream V12_X1_ALL universe is present only in v4 feed.
 */
import {SyntheticMarket5m,type SyntheticScenario} from "./synthetic-market";
import {V4NativeFailedBreakShadow,V4_NATIVE_CORE_PIN}
 from "./pinned-native-v4/native-core-probe";
export type V4NativeCore22DAudit={
 schema:"disdex-bt-v4-native-core-22d-audit-v1";
 seed:number;scenario:SyntheticScenario;feedVersion:"v4";
 sourceSha256:string;sourceRevision:string;
 from:string;endExclusive:string;
 configuredSymbols:14;evaluatedNonBtcSymbols:13;
 completedH2Times:number;warmupH2Times:number;evaluatedH2Times:number;
 nativeSourceEvents:number;badInputs:number;
 eventSample:readonly {at:string;symbol:string;route:string;side:"SHORT";
 score:number;setupAt:string}[];
 actualOrders:0;fullV4:false;
 note:string;
};
export function auditV4NativeFailedBreak22D(seed:number,scenario:SyntheticScenario):V4NativeCore22DAudit{
 const from="2025-10-01T00:00:00Z",endExclusive="2025-10-23T00:00:00Z";
 const feed=new SyntheticMarket5m(seed,scenario,{start:from,endExclusive,version:"v4"});
 const probe=new V4NativeFailedBreakShadow();
 let count=0,warm=0,evaluated=0,signals=0,errors=0;
 const examples:V4NativeCore22DAudit["eventSample"][number][]=[];
 feed.runToEnd(step=>{
   const result=probe.inspect(feed,step);
   if(result.status==="NOT_H2")return;
   count++;
   if(result.status==="WARMUP_61_H2")warm++;
   if(result.status==="SOURCE_EVALUATED"){
      evaluated++;
      if(result.evaluatedSymbols.length!==13)
        throw Error("V4_NATIVE_CORE_PARTIAL_UNIVERSE");
      signals+=result.nativeEvents.length;
      for(const event of result.nativeEvents){
         if(event.orderEnabled!==false)throw Error("V4_NATIVE_CORE_ORDER_DISABLED_REQUIRED");
         if(examples.length<25)examples.push({
           at:step.observedAt,symbol:event.symbol,route:event.route,
           side:event.side,score:event.score,
           setupAt:new Date(event.setup_ts_ms).toISOString()
         });
      }
   }
   if(result.status==="SOURCE_INVALID"||result.status==="MISSING_SYMBOLS")errors++;
 });
 if(count!==264||warm!==60||evaluated!==204||errors!==0)
   throw Error("V4_NATIVE_CORE_SOURCE_AUDIT_FAIL_CLOSED");
 return {
   schema:"disdex-bt-v4-native-core-22d-audit-v1",seed,scenario,feedVersion:"v4",
   sourceSha256:V4_NATIVE_CORE_PIN.originalSha256,
   sourceRevision:V4_NATIVE_CORE_PIN.sourceRevision,
   from,endExclusive,configuredSymbols:14,evaluatedNonBtcSymbols:13,
   completedH2Times:count,warmupH2Times:warm,evaluatedH2Times:evaluated,
   nativeSourceEvents:signals,badInputs:errors,eventSample:examples,
   actualOrders:0,fullV4:false,
   note:"Frozen reference branch V4 FAILED_BREAK native core only. Historical production V4 SHA, remaining V4 source routes, selection ranking, actual next H1 open, STOP, cooldown, gross, opportunity and real fills are not verified or connected."
 };
}
