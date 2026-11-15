import type {Quality102CausalV1Signal,Quality102CausalV1History} from "./disdex-quality102-causal-v1-signal";
import {detectQuality102CausalV4S34RawSignal} from "./disdex-quality102-causal-v4-s34";
import type {Stable4EntryOpportunityCaptureInput} from "./stable4-entry-opportunity-publisher";

export function stable4Q102EntryCapture(input:{signal:Quality102CausalV1Signal;history:Quality102CausalV1History;sourceSha:string;positionId:string;capturedAt:number}):Stable4EntryOpportunityCaptureInput{
 const {signal:s,history}=input;
 if(!s.symbol||s.side===0||!(s.maxHoldHours!>0)||!(s.requestedGross>0))throw Error("STABLE4_Q102_CAPTURE_SIGNAL_INVALID");
 let features:Record<string,number>={},route:string;
 if(s.reason.split(":")[0]==="STABLE4_Q102_AVAX_ONLINE_KNN")route="Q102_AVAX_ONLINE_KNN_STOP5_TP3_Q01365";
 else if(s.family==="HIGH_VOL")route="HIGH_VOL|"+s.symbol;
 else{
  const rows=history.candlesBySymbol[s.symbol],open=history.entryOpenBySymbol?.[s.symbol];
  if(!rows?.length||!open||open.timestampMs!==s.referenceTs||!s.variant)throw Error("STABLE4_Q102_CAPTURE_NATIVE_FEATURES_MISSING");
  const raw=detectQuality102CausalV4S34RawSignal(rows,open,s.variant);
  if(!raw||raw.side!==s.side||rows.at(-1)!.timestampMs+3600000!==s.referenceTs)throw Error("STABLE4_Q102_CAPTURE_NATIVE_SIGNAL_CONFLICT");
  features={ret14:raw.ret14,strength:raw.strength,margin:raw.margin};
  route=s.symbol.replace(/USDT$/,"")+"|"+s.variant;
 }
 return{sourceGitSha:input.sourceSha,nativePositionId:input.positionId,strategy:"Q102",symbol:s.symbol,side:s.side===1?"LONG":"SHORT",route,logicalEntryTs:s.referenceTs,gross:s.requestedGross,plannedHoldHours:s.maxHoldHours!,entrySnapshot:features,capturedAt:input.capturedAt};
}
