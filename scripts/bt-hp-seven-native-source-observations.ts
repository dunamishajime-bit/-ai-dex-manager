/**
 * BT-481-H2: deterministic, SOURCE-ONLY causal observations.
 *
 * This evaluates six independently sourced research/native paths on one
 * synthetic-v4 33-symbol 5-minute market, without sending orders, modeling
 * STOP, filling positions or claiming a seven-runner PnL backtest.
 * V52 needs its separate Python two-source quote adapter and joins only after
 * the exact native V50 candidate method has been evaluated.
 */
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {SyntheticMarket5m,type SyntheticScenario} from "../lib/bt-verification/synthetic-market";
import {evaluateH48ClosedHourly,type H48Observation}
 from "../lib/bt-verification/h48-research-sandbox";
import {probeSyntheticFet} from "../lib/bt-verification/pinned-native-fet/probe";
import {probeSyntheticIdleAt} from "../lib/bt-verification/pinned-native-idle/probe";
import {probeNativePenguSyntheticAt}
 from "../lib/bt-verification/pinned-native-pengu/probe";
import {inspectQ102NativeS34Source}
 from "../lib/bt-verification/pinned-native-q102/probe";
import {inspectQ102NativeHighVolSyntheticAt}
 from "../lib/bt-verification/pinned-native-q102/highvol-probe";
import {V4NativeFailedBreakShadow}
 from "../lib/bt-verification/pinned-native-v4/native-core-probe";

type Family="V4"|"Q102"|"PENGU"|"FET"|"IDLE"|"V52"|"HYPE";
type Stage="FEATURE_ONLY"|"SOURCE_CANDIDATE";
type Decision="LONG"|"SHORT"|"NONE";
type Row={
 id:string;family:Family;runner:string;symbol:string;
 sourceSha256:string;sourcePath:string;
 stage:Stage;decision:Decision;eventTs:number;availableAtTs:number;
 sourceObservedUntilTs:number;route:string;
};
const H=3600_000;
const start="2025-10-01T00:00:00Z",endExclusive="2025-10-23T00:00:00Z";
const seed=20261115,scenario:SyntheticScenario="rotation";
const SHA={
 FET:"ee8213adbb695a387e653d89bb4a494c36640e0845ffcf648ec61927fc47be78",
 IDLE:"76f68ba1ec78f5adb34c68718a28b199f58bd29dd6651a404631326906c2f827",
 PENGU:"a72123d76e0c5783553cafa5a452664274d4450e06a5afb17ecf1738b5ad6546",
 V4:"f1d97f477f2b23e74f8b98cf59813f3c1650479e3c8cbadf6e2fdeeab90a7344",
 Q102S34:"1a75ba55bd58ddd93f26b3b1d9c58f0a42d7dcfb8f3dbbc57f2f4d555aef8466",
 Q102HV:"7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f",
 V52:"5f7b5299b50ac2b85bfab6cef1dd746d7e114ce70c442f5f6fcadbe47dc78762",
 HYPE:createHash("sha256").update(readFileSync(resolve(
   "lib/bt-verification/h48-research-sandbox.ts"))).digest("hex")
} as const;
const sourceManifest:Record<Family,string|string[]>={
 FET:SHA.FET,IDLE:SHA.IDLE,PENGU:SHA.PENGU,V4:SHA.V4,
 Q102:[SHA.Q102S34,SHA.Q102HV],V52:SHA.V52,HYPE:SHA.HYPE
};
const sourcePath={
 FET:"lib/bt-verification/pinned-native-fet/fet-brk48-signal.ts",
 IDLE:"lib/bt-verification/pinned-native-idle/idle-priority-short-signal.ts",
 PENGU:"lib/bt-verification/pinned-native-pengu/pengu-dual-ls-v2.ts",
 V4:"lib/bt-verification/pinned-native-v4/v12-v4-native-core.ts",
 Q102S34:"lib/bt-verification/pinned-native-q102/disdex-quality102-causal-v4-s34.ts",
 Q102HV:"lib/bt-verification/pinned-native-q102/disdex-quality102-causal-pipeline.ts",
 HYPE:"lib/bt-verification/h48-research-sandbox.ts"
} as const;

export function exportSixFamilyNativeObservations(){
 const feed=new SyntheticMarket5m(seed,scenario,{start,endExclusive,version:"v4"});
 const observations:Row[]=[];
 const seen=new Set<string>();
 const hypeHistory:H48Observation[]=[];
 const v4=new V4NativeFailedBreakShadow();
 const counters={h1:0,h2:0,q102S34Raw:0,q102S34Gated:0,
   q102HVThresholds:0,v4Events:0,hypeCandidates:0,
   penguCandidates:0,idleCandidates:0,fetCandidates:0};
 function add(
   family:Family,symbol:string,sourceSha256:string,srcPath:string,
   runner:string,route:string,stage:Stage,decision:Decision,
   eventTs:number,availableAtTs:number
 ){
   if(!Number.isSafeInteger(eventTs)||!Number.isSafeInteger(availableAtTs)||
      eventTs<0||eventTs>availableAtTs)throw Error("H2_NONCAUSAL_SOURCE_EVENT");
   if(stage==="FEATURE_ONLY"&&decision!=="NONE")throw Error("H2_FEATURE_IS_NOT_TRADE");
   const id=[family,runner,symbol,route,eventTs,stage].join("|");
   if(seen.has(id))throw Error("H2_DUPLICATE_SOURCE_EVIDENCE");
   seen.add(id);
   observations.push({id,family,runner,symbol,sourceSha256,sourcePath:srcPath,
      stage,decision,eventTs,availableAtTs,sourceObservedUntilTs:availableAtTs,route});
 }
 feed.runToEnd(step=>{
   if(!step.completedH1.some(x=>x.symbol==="BTCUSDT"))return;
   const now=Date.parse(step.observedAt);
   counters.h1++;
   const btc=step.completedH1.find(x=>x.symbol==="BTCUSDT");
   const hype=step.completedH1.find(x=>x.symbol==="HYPEUSDT");
   if(!btc||!hype||btc.closedAt!==hype.closedAt)
     throw Error("H2_HYPE_BTC_H1_NOT_ALIGNED");
   hypeHistory.push({btcClose:btc.close,hypeClose:hype.close});
   const hd=evaluateH48ClosedHourly(hypeHistory);
   if(hd.ready){
     const candidate=hd.candidate&&now%(6*H)===0;
     if(candidate)counters.hypeCandidates++;
     add("HYPE","HYPEUSDT",SHA.HYPE,sourcePath.HYPE,
      "HYPE_H48_RESEARCH_NOT_LIVE","H48R4_6H_CLOSED_H1",
      candidate?"SOURCE_CANDIDATE":"FEATURE_ONLY",candidate?"LONG":"NONE",
      now-H,now);
   }
   const fet=probeSyntheticFet(feed,step.observedAt);
   if(fet.status==="ASOF_GAP_OR_INVALID")
     throw Error("H2_FET_INVALID_SOURCE");
   if(fet.status==="NATIVE_SIGNAL_PASSED"||fet.status==="NATIVE_SIGNAL_REJECTED"){
     const accepted=fet.candidate!==null;
     if(accepted)counters.fetCandidates++;
     add("FET","FETUSDT",SHA.FET,sourcePath.FET,
       "FET_BRK48_NATIVE_ENTRY_SHADOW","BRK48_SOURCE_ONLY",
       accepted?"SOURCE_CANDIDATE":"FEATURE_ONLY",accepted?"LONG":"NONE",
       accepted?Math.min(fet.candidate!.referenceTs,now):now-H,now);
   }
   for(const idle of probeSyntheticIdleAt(feed,step.observedAt)){
     if(idle.status==="INVALID_MARKET_SOURCE")
       throw Error("H2_IDLE_INVALID_SOURCE");
     if(!idle.nativeFeatures)continue;
     // A native accepted signal may still be rejected by research prefilters.
     // Only a preliminary eligible signal is represented as a candidate.
     const eligible=idle.nativeEntryCandidate&&idle.researchPreliminaryEligible;
     if(eligible)counters.idleCandidates++;
     add("IDLE",idle.symbol,SHA.IDLE,sourcePath.IDLE,
       "IDLE_NATIVE_ENTRY_PLUS_PRETARGET_SHADOW",
       "PRIORITY_SHORT_"+idle.status,
       eligible?"SOURCE_CANDIDATE":"FEATURE_ONLY",
       eligible?"SHORT":"NONE",idle.nativeFeatures.signalTs,now);
   }
   const pengu=probeNativePenguSyntheticAt(feed,step);
   if(pengu.status==="SOURCE_INVALID_OR_GAP")
     throw Error("H2_PENGU_INVALID_SOURCE");
   if(pengu.status==="NATIVE_ENTRY_CANDIDATE"||
      pengu.status==="NATIVE_NO_CANDIDATE"){
     const accepted=pengu.status==="NATIVE_ENTRY_CANDIDATE";
     if(accepted)counters.penguCandidates++;
     add("PENGU","PENGUUSDT",SHA.PENGU,sourcePath.PENGU,
       "PENGU_V2_V20_V8_NATIVE_SHADOW",
       "SOURCE_"+(pengu.nativeEntryVersion??"NONE"),
       accepted?"SOURCE_CANDIDATE":"FEATURE_ONLY",
       accepted?pengu.nativeSide:"NONE",now-H,now);
   }
   const high=inspectQ102NativeHighVolSyntheticAt(feed,step);
   if(high.status==="INVALID_CLOSED_H1")
     throw Error("H2_Q102_HIGH_VOL_INPUT_INVALID");
   if(high.status==="FEATURES_EVALUATED_NO_MONTHLY_RULE"){
     for(const feature of high.features){
       counters.q102HVThresholds+=feature.gridLongThresholds+feature.gridShortThresholds;
       add("Q102",feature.symbol,SHA.Q102HV,sourcePath.Q102HV,
         "Q102_S1S2_UNTRAINED_FEATURE_ONLY",
         "HIGHVOL_NO_MONTHLY_RULE_L"+feature.gridLongThresholds+
          "_S"+feature.gridShortThresholds,"FEATURE_ONLY","NONE",
         now-H,now);
     }
   }
   if(new Date(now).getUTCHours()%4===1){
     const q=inspectQ102NativeS34Source(feed,step);
     if(q.status==="ASOF_GAP_OR_INVALID")
       throw Error("H2_Q102_S34_SOURCE_INVALID");
     const gated=new Set(q.gatedCandidates.map(c=>c.id));
     for(const c of q.rawCandidates){
       counters.q102S34Raw++;
       const accepted=gated.has(c.id);
       if(accepted)counters.q102S34Gated++;
       if(c.entryTs!==now||c.dataCutoffTs>=now)
         throw Error("H2_Q102_FUTURE_OR_STALE_DATA_CUTOFF");
       add("Q102",c.symbol,SHA.Q102S34,sourcePath.Q102S34,
         "Q102_S3S4_NATIVE_SOURCE_SHADOW",
         c.key+"_"+(accepted?"GATED":"RAW_ONLY"),
         accepted?"SOURCE_CANDIDATE":"FEATURE_ONLY",
         accepted?(c.side===1?"LONG":"SHORT"):"NONE",
         c.dataCutoffTs,now);
     }
   }
   const v=v4.inspect(feed,step);
   if(v.status==="SOURCE_INVALID"||v.status==="MISSING_SYMBOLS")
     throw Error("H2_V4_NATIVE_CORE_INPUT_INVALID");
   if(v.status==="SOURCE_EVALUATED"){
     counters.h2++;
     for(const symbol of v.evaluatedSymbols){
       add("V4",symbol,SHA.V4,sourcePath.V4,
         "V4_NATIVE_FAILED_BREAK_ONLY","H2_CORE_STATE_EVALUATED",
         "FEATURE_ONLY","NONE",now-2*H,now);
     }
     for(const event of v.nativeEvents){
       if(event.entry_ts_ms>now||event.orderEnabled!==false)
         throw Error("H2_V4_SOURCE_EVENT_NOT_SHADOW");
       counters.v4Events++;
       add("V4",event.symbol,SHA.V4,sourcePath.V4,
         "V4_NATIVE_FAILED_BREAK_ONLY",event.route,
         "SOURCE_CANDIDATE","SHORT",event.entry_ts_ms,now);
     }
   }
 });
 const cutoffTs=Date.parse(endExclusive);
 if(counters.h1!==22*24||counters.h2!==204||
    counters.q102S34Raw===0||counters.q102HVThresholds===0)
   throw Error("H2_NATIVE_EVALUATION_INCOMPLETE");
 return {schema:"bt-pr481-raw-native-source-events-v1",cutoffTs,
   generator:{seed,scenario,feedVersion:"v4",start,endExclusive,
     h2Mode:"SOURCE_ONLY_NO_FILL_NO_GROSS_NO_PNL",counters},
   sourceManifest,observations};
}
if(process.argv[1]?.endsWith("bt-hp-seven-native-source-observations.ts")){
 const out=process.argv[2];
 if(!out)throw Error("H2_REQUIRES_EXPLICIT_OUTPUT_JSON_PATH");
 const payload=exportSixFamilyNativeObservations();
 writeFileSync(resolve(out),JSON.stringify(payload)+"\n","utf8");
 console.log("PASS six offline source families, as-of causal observation candidates",JSON.stringify({
   records:payload.observations.length,counters:payload.generator.counters,
   output:resolve(out)}));
}
