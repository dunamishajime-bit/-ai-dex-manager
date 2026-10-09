/**
 * Real-time V4 signal pipeline, using only completed H1/H2 venue candles.
 * This is the deterministic decision half of a future Production runner.
 * It never reads trading credentials or sends an order.
 */
import {createHash} from "node:crypto";
import type {AsterV3Client,AsterKline} from "./aster-v3-client";
import {V12_X1_ALL} from "../config/v12X1AllRuntime";
import {resampleV12H1ToH2,type V12Bar} from "./v12-x1-all";
import {computeNativeV4Sources} from "./v12-v4-native-source";
import {stepNativeFailedBreakCore,type CoreMachineState,type NativeCoreEvent} from "./v12-v4-native-core";
import {adaptProductionCandidates,type FeatureBar} from "./v12-v4-production-features";
import {V12_V4_V2_POLICY} from "./v12-v4-v2-shadow";

export type V4VenueH1Bar=FeatureBar & {volume:number};
const H=3600000;
const TWO_HOURS=2*H;
export type V4LiveDecisionSnapshot={
 schema:"v12-v4-live-decision/v1";policyId:typeof V12_V4_V2_POLICY;decisionTs:number;capturedAtMs:number;
 sourceFingerprint:string;candidateCount:number;filteredCount:number;
 sourceCount:number;nativeCoreEvents:NativeCoreEvent[];errors:string[];orderEnabled:false;realOrderEnabledV4:0;tradingMutation:0;
 candidates:ReturnType<typeof adaptProductionCandidates>["candidates"];
 filtered:ReturnType<typeof adaptProductionCandidates>["filtered"];
};
function parseH1(rows:readonly AsterKline[],capturedAtMs:number):V4VenueH1Bar[]{
 const seen=new Set<number>(),data:V4VenueH1Bar[]=[];
 for(const r of rows){
  const openTs=Number(r[0]),closeTs=Number(r[6]);
  if(openTs%H!==0||openTs+H>capturedAtMs||closeTs>=capturedAtMs)continue;
  const bar={openTs,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),quoteVolume:Number(r[7])};
  if(![bar.open,bar.high,bar.low,bar.close,bar.volume,bar.quoteVolume].every(Number.isFinite)||Math.min(bar.open,bar.low,bar.close)<=0||
    bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||bar.quoteVolume<0)throw Error("INVALID_SIGNED_H1_CANDLE");
  if(seen.has(openTs))throw Error("DUPLICATE_H1_CANDLE");seen.add(openTs);data.push(bar);
 }
 return data.sort((a,b)=>a.openTs-b.openTs);
}
export async function loadV4ClosedCandles(client:Pick<AsterV3Client,"getKlines">,
 capturedAtMs:number,spacingMs=100):Promise<Record<string,V4VenueH1Bar[]>>{
 if(!Number.isFinite(capturedAtMs)||capturedAtMs<=0)throw Error("INVALID_V4_CLOCK");
 const out:Record<string,V4VenueH1Bar[]>={};
 for(const symbol of V12_X1_ALL.universe){
  if(spacingMs>0)await new Promise<void>(r=>setTimeout(r,spacingMs));
  const rows=await client.getKlines(symbol+"USDT","1h",500);
  const bars=parseH1(rows,capturedAtMs);
  if(bars.length<245)throw Error("V4_H1_WARMUP_INSUFFICIENT:"+symbol);
  out[symbol]=bars;
 }
 return out;
}
export function replayLiveNativeCore(universe:Record<string,V12Bar[]>):NativeCoreEvent[]{
 const btc=universe.BTC;
 if(!btc||btc.length<121)throw Error("V4_NATIVE_CORE_REPLAY_WARMUP");
 const events:NativeCoreEvent[]=[];
 for(const symbol of V12_X1_ALL.universe.filter(s=>s!=="BTC")){
  const rows=universe[symbol];
  if(!rows||rows.length!==btc.length)throw Error("V4_NATIVE_CORE_H2_ALIGNMENT");
  let state:CoreMachineState={lastDecisionTs:null,setup:null};
  for(let i=60;i<rows.length;i++){
   const result=stepNativeFailedBreakCore(state,symbol,rows.slice(i-60,i+1),btc.slice(i-60,i+1),rows[i].endTs);
   state=result.state;
   if(i===rows.length-1&&result.event)events.push(result.event);
  }
 }
 return events;
}
export function buildV4LiveDecisionBatch(h1:Record<string,V4VenueH1Bar[]>,capturedAtMs:number):V4LiveDecisionSnapshot{
 const commonSymbols=V12_X1_ALL.universe;
 if(!commonSymbols.every(symbol=>Array.isArray(h1[symbol])))throw Error("V4_UNIVERSE_NOT_COMPLETE");
 const h2:Record<string,V12Bar[]>={};
 for(const symbol of commonSymbols){
  const rows=h1[symbol];
  const source=rows.map(x=>({...x,ts:x.openTs,volume:x.volume,closed:true as const}));
  h2[symbol]=resampleV12H1ToH2(source);
 }
 const common=commonSymbols.reduce<Set<number>|undefined>((set,symbol)=>{
  const ts=new Set(h2[symbol].map(b=>b.endTs));
  return !set?ts:new Set([...set].filter(t=>ts.has(t)));
 },undefined);
 if(!common||common.size<121)throw Error("V4_COMMON_H2_WARMUP_INSUFFICIENT");
 const aligned:Record<string,V12Bar[]>={};
 for(const symbol of commonSymbols)aligned[symbol]=h2[symbol].filter(b=>common.has(b.endTs));
 const index=aligned.BTC.length-1;
 const decisionTs=aligned.BTC[index].endTs;
 if(!Number.isFinite(decisionTs)||decisionTs>capturedAtMs||
    capturedAtMs-decisionTs>TWO_HOURS+15*60_000)throw Error("V4_H2_STALE_OR_FUTURE");
 const source=computeNativeV4Sources(aligned,index,decisionTs);
 const nativeCoreEvents=replayLiveNativeCore(aligned);
 const candidates:V4LiveDecisionSnapshot["candidates"]=[],filtered:V4LiveDecisionSnapshot["filtered"]=[];
 const errors:string[]=[];
 for(const n of source){
  try{
   const bars=h1[n.source.symbol.replace(/USDT$/,"")];
   if(!bars)throw Error("V4_H1_SYMBOL_MISSING");
   const result=adaptProductionCandidates({source:n.source,decisionTs,symbolBars:bars,btcBars:h1.BTC});
   candidates.push(...result.candidates);filtered.push(...result.filtered);
  }catch(e){
   errors.push(n.source.symbol+":"+(e instanceof Error?e.message:String(e)));
  }
 }
 candidates.sort((a,b)=>a.rank-b.rank||a.eligibleEntryTs-b.eligibleEntryTs||a.symbol.localeCompare(b.symbol));
 const sourceFingerprint=createHash("sha256").update(JSON.stringify({decisionTs,h2:aligned,h1:h1.BTC.slice(-50)})).digest("hex");
 return {schema:"v12-v4-live-decision/v1",policyId:V12_V4_V2_POLICY,
  decisionTs,capturedAtMs,sourceFingerprint,candidateCount:candidates.length,filteredCount:filtered.length,
  sourceCount:source.length,nativeCoreEvents,errors,candidates:errors.length?[]:candidates,filtered,
  orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0};
}
