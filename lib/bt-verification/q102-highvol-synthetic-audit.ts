/**
 * Q102 S1/S2 HIGH_VOL source-input readiness audit. This deliberately cannot
 * grant stage membership, monthly training winners or trade admission.
 */
import {SyntheticMarket5m,type SyntheticScenario,type SyntheticFeedVersion} from "./synthetic-market";
import {
 inspectQ102NativeHighVolSyntheticAt,Q102_HV_SOURCE_PIN
} from "./pinned-native-q102/highvol-probe";
export interface Q102HighVol22DAudit{
 schema:"disdex-bt-q102-hv-source-audit-v1";
 seed:number;scenario:SyntheticScenario;feedVersion:SyntheticFeedVersion;
 start:string;endExclusive:string;
 pipelineSha256:string;
 requiredCompletedH1:337;
 requiredMonthlyTrainingDays:180;
 scheduledH1:number;warmupH1:number;sourceEvaluatedH1:number;
 rawThresholdGridMatches:number;
 evaluatedModelSymbols:readonly string[];
 missingModelSymbols:readonly string[];
 perSymbol:readonly {symbol:string;frames:number;rawGrid:number}[];
 examples:readonly {at:string;symbol:string;ret24:number;ret14d:number;
 rsi14:number;atrPct:number;longGrid:number;shortGrid:number}[];
 stageMembershipKnown:false;hasVerifiedMonthlyRules:false;
 nativeSelectedEntryCandidates:0;simulationFills:0;
 evaluation:"SOURCE_NATIVE_FEATURES_ONLY_FAIL_CLOSED";
 note:string;
}
export function auditQ102NativeHighVol22D(
 seed:number,scenario:SyntheticScenario,feedVersion:SyntheticFeedVersion="v3"
):Q102HighVol22DAudit{
 const start="2025-10-01T00:00:00Z",endExclusive="2025-10-23T00:00:00Z";
 const market=new SyntheticMarket5m(seed,scenario,{start,endExclusive,version:feedVersion});
 let scheduled=0,warmup=0,evaluated=0,grids=0;
 const checked=new Set<string>(),missing=new Set<string>();
 const symbolData=new Map<string,{frames:number;rawGrid:number}>();
 const examples:Q102HighVol22DAudit["examples"][number][]=[];
 market.runToEnd(step=>{
   if(!step.completedH1.some(x=>x.symbol==="BTCUSDT"))return;
   const result=inspectQ102NativeHighVolSyntheticAt(market,step);
   scheduled++;
   if(result.status==="INVALID_CLOSED_H1"||result.status==="NOT_CLOSED_H1")
     throw Error("Q102_HIGHVOL_INPUT_AUDIT_FAIL_CLOSED");
   if(result.status==="INSUFFICIENT_337H")warmup++;
   if(result.status==="FEATURES_EVALUATED_NO_MONTHLY_RULE")evaluated++;
   grids+=result.rawGridThresholdMatches;
   for(const symbol of result.missingSymbols)missing.add(symbol);
   for(const f of result.features){
      checked.add(f.symbol);
      const curr=symbolData.get(f.symbol)??{frames:0,rawGrid:0};
      curr.frames++;
      curr.rawGrid+=f.gridLongThresholds+f.gridShortThresholds;
      symbolData.set(f.symbol,curr);
      if(examples.length<28&&(f.gridLongThresholds+f.gridShortThresholds>0))
         examples.push({
           at:step.observedAt,symbol:f.symbol,ret24:f.ret24,ret14d:f.ret14d,
           rsi14:f.rsi14,atrPct:f.atrPct,
           longGrid:f.gridLongThresholds,shortGrid:f.gridShortThresholds
         });
   }
 });
 if(scheduled!==22*24||warmup!==336||evaluated!==192||checked.size===0||
     (feedVersion==="v3"&&missing.size!==0))
    throw Error("Q102_HIGHVOL_AUDIT_SOURCE_INCOMPLETE");
 return {
   schema:"disdex-bt-q102-hv-source-audit-v1",seed,scenario,feedVersion,
   start,endExclusive,pipelineSha256:Q102_HV_SOURCE_PIN.originalSha256,
   requiredCompletedH1:337,requiredMonthlyTrainingDays:180,
   scheduledH1:scheduled,warmupH1:warmup,sourceEvaluatedH1:evaluated,
   rawThresholdGridMatches:grids,
   evaluatedModelSymbols:[...checked].sort(),missingModelSymbols:[...missing].sort(),
   perSymbol:[...symbolData].sort((a,b)=>a[0].localeCompare(b[0])).map(
      ([symbol,values])=>({symbol,...values})
   ),
   examples,stageMembershipKnown:false,hasVerifiedMonthlyRules:false,
   nativeSelectedEntryCandidates:0,simulationFills:0,
   evaluation:"SOURCE_NATIVE_FEATURES_ONLY_FAIL_CLOSED",
   note:"The 180-day prior closed-outcome training and original S1/S2 upstream membership are unavailable. These are native input features and grid-threshold matches only, never actual quality102 S1/S2 entry signals; zero fills, no PnL or Gross."
 };
}
