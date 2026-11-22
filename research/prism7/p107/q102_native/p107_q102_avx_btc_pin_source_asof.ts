import * as fs from "node:fs";
import {buildQuality102CausalV4Signal} from "./q102-pin-source-c7310d34/lib/disdex-quality102-causal-v4-signal";
import {resolveQuality102CausalV1Runtime} from "./q102-pin-source-c7310d34/config/disdexQuality102CausalV1Runtime";
const input=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const envGross=resolveQuality102CausalV1Runtime({QUALITY102_CAUSAL_V1_MAX_GROSS:"3.0"});
if(envGross.maximumGross!==3.0)throw Error("Q102_CAP_SOURCE_MISMATCH");
const events:any[]=[];
for(const c of input.cases){
 const now=Date.now();
 try{
  const sig=buildQuality102CausalV4Signal(c,{highVolSymbols:["AVAXUSDT"]});
  if(sig.referenceTs>c.decisionTs)throw Error("FUTURE_SIGNAL");
  const execGross=sig.side===0?0:Math.min(envGross.maximumGross,sig.requestedGross);
  if(execGross>3.00000001)throw Error("RUNTIME_GROSS_EXCEEDS_3P0");
  events.push({decisionTs:c.decisionTs,status:"PIN_SOURCE_CALLED",reason:sig.reason,side:sig.side,symbol:sig.symbol??null,route:sig.variant??null,layer:sig.layer??null,family:sig.family??null,sourceRequestedGross:sig.requestedGross,effectiveGross:execGross,dataCutoffTs:sig.dataCutoffTs,delayMillis:Date.now()-now});
 }catch(e:any){
  events.push({decisionTs:c.decisionTs,status:"SOURCE_THROW",error:String(e?.message||e),delayMillis:Date.now()-now});
 }
}
console.log(JSON.stringify({phase:"P107-Q102-NATIVE_PIN-SAMPLE",historicalDates:events.length,pin:input.pin,results:events,fullPortfolioParity:false}));
const correct=events.length===2&&events[0].status==="SOURCE_THROW"&&events[0].error==="QUALITY102_INVALID_CANDLE"&&events[1].status==="PIN_SOURCE_CALLED"&&events[1].reason==="QUALITY102_CAUSAL_V4_NO_SIGNAL";
if(!correct)process.exitCode=3;
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({expectedNegativeAndPositiveControlsPass:correct,pin:input.pin,results:events,p107FullParity:false},null,2)+"\n");
