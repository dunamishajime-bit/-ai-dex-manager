/** Read-only native candidate capture. No entry permission, account-owner state,
 * or outcome-by-deadline inference. Source collectors must supply causal native
 * inputs and independently pinned native policy bytes. Replay completion stays
 * with the trusted policy-specific producer and the common ledger validator.
 */
import {createHash} from "node:crypto";
import {captureStable4EntryOpportunityCandidate} from "./stable4-entry-opportunity-publisher";
import type {Stable4EntryOpportunityStrategy} from "./stable4-entry-opportunity-book";
import {appendStable4NativeShadowCandidate,createStable4NativeShadowLedger,Stable4NativeShadowStore,type Stable4NativeShadowLedger} from "./stable4-native-shadow-ledger";
import {buildFetBrk48Signal,type FetBrk48Bar} from "./fet-brk48-signal";
import {FET_BRK48_RESIDUAL} from "../config/fetBrk48Runtime";
import type {IdleSignal} from "./idle-priority-short-signal";
import {idleRouteRequestedGross} from "./idle-priority-short-live";

type Candidate=Stable4NativeShadowLedger["entries"][number]["candidate"];
export interface Stable4NativeShadowCaptureContext{
 sourceSha:string;capturedAt:number;policyVersion:string;
 /** Digest of reviewed native policy source bytes; never a caller-supplied verifier callback. */
 policySourceDigestSha256:string;sourceRef:string;
}
export interface Stable4NativeShadowObservation extends Stable4NativeShadowCaptureContext{
 strategy:Stable4EntryOpportunityStrategy;nativeKey:string;symbol:string;side:"LONG"|"SHORT";route:string;
 logicalEntryTs:number;gross:number;modelExpectedHoldHours:number;entrySnapshot:unknown;
 coverageFrom:number;policyId:string;shortReturnConvention:"linear"|"reciprocal";
}
function canonical(value:unknown):string{
 if(value===null||typeof value==="string"||typeof value==="boolean")return JSON.stringify(value);
 if(typeof value==="number"&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value)){
  if(Array.from({length:value.length},(_,i)=>i).some(i=>!Object.hasOwn(value,i)))throw Error("STABLE4_SHADOW_CAPTURE_SPARSE_SOURCE");
  return"["+value.map(canonical).join(",")+"]";
 }
 if(value&&typeof value==="object"&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)){
  const keys=Reflect.ownKeys(value);
  if(keys.some(k=>typeof k!=="string"||!("value" in Object.getOwnPropertyDescriptor(value,k)!)))throw Error("STABLE4_SHADOW_CAPTURE_NON_DATA_SOURCE");
  return"{"+(keys as string[]).sort().map(k=>JSON.stringify(k)+":"+canonical((value as Record<string,unknown>)[k])).join(",")+"}";
 }
 throw Error("STABLE4_SHADOW_CAPTURE_NON_DATA_SOURCE");
}
/** All seven modeled native frameworks share this capture shape. The identity
 * is a native candidate key, never a real-position or modeled-exit membership.
 */
export function captureStable4NativeShadowObservation(input:Stable4NativeShadowObservation):Candidate{
 const sourceDigest=createHash("sha256").update(canonical(input.entrySnapshot)).digest("hex");
 const capture=captureStable4EntryOpportunityCandidate({sourceGitSha:input.sourceSha,nativePositionId:input.nativeKey,strategy:input.strategy,symbol:input.symbol,side:input.side,route:input.route,logicalEntryTs:input.logicalEntryTs,gross:input.gross,plannedHoldHours:input.modelExpectedHoldHours,entrySnapshot:input.entrySnapshot,capturedAt:input.capturedAt});
 const candidate={nativeKey:input.nativeKey,sourceSha:input.sourceSha,strategy:input.strategy,symbol:input.symbol,side:input.side,route:input.route,logicalEntryTs:input.logicalEntryTs,gross:input.gross,modelExpectedHoldHours:input.modelExpectedHoldHours,capturedAt:input.capturedAt,entryFeatures:capture.candidate.features,
  nativePolicy:{id:input.policyId,version:input.policyVersion,sourceSha:input.sourceSha,sourceDigestSha256:input.policySourceDigestSha256,shortReturnConvention:input.shortReturnConvention,roundTripCost:.003},
  evidenceCoverage:{from:input.coverageFrom,through:input.logicalEntryTs,observedAt:input.capturedAt,refs:[{kind:"ENTRY",ref:input.sourceRef,sha256:sourceDigest},{kind:"POLICY",ref:input.policyId+":"+input.policyVersion,sha256:input.policySourceDigestSha256}]}};
 return appendStable4NativeShadowCandidate(createStable4NativeShadowLedger(input.strategy),candidate).entries[0].candidate;
}
export function captureStable4FetNativeCandidates(input:{rows:readonly FetBrk48Bar[];decisionTs:number},context:Stable4NativeShadowCaptureContext):Candidate[]{
 for(const r of input.rows)if(![r.openTs,r.closeTs,r.open,r.high,r.low,r.close,r.volume].every(x=>typeof x==="number"&&Number.isFinite(x))||r.open<=0||r.close<=0||r.low<=0||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)||r.volume<0)throw Error("STABLE4_FET_SHADOW_SOURCE_INVALID");
 const signal=buildFetBrk48Signal(input.rows,input.decisionTs);if(!signal)return[];
 const causal=input.rows.filter(r=>r.closeTs<signal.entryTs);
 // Raw normalized history is hashed as a separate source reference. Features
 // remain the exact native signal fields selected by the common causal schema.
 const candidate=captureStable4NativeShadowObservation({...context,strategy:"FET",nativeKey:["FET",signal.symbol,signal.side,signal.entryTs].join(":"),symbol:signal.symbol,side:"LONG",route:FET_BRK48_RESIDUAL.strategyId,logicalEntryTs:signal.entryTs,gross:FET_BRK48_RESIDUAL.maximumGross,modelExpectedHoldHours:FET_BRK48_RESIDUAL.holdHours,entrySnapshot:signal,coverageFrom:causal[0].openTs,policyId:"FET_BRK48_RESIDUAL_NATIVE_EXIT",shortReturnConvention:"linear"});
 const historyDigest=createHash("sha256").update(canonical(causal)).digest("hex");
 return appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("FET"),{...candidate,evidenceCoverage:{...candidate.evidenceCoverage,refs:[...candidate.evidenceCoverage.refs,{kind:"ENTRY",ref:context.sourceRef+":closed-h1",sha256:historyDigest}]}}).entries.map(e=>e.candidate);
}
export function captureStable4IdleNativeCandidates(input:{signals:readonly IdleSignal[];sourceSnapshot:unknown},context:Stable4NativeShadowCaptureContext):Candidate[]{
 const sourceDigest=createHash("sha256").update(canonical(input.sourceSnapshot)).digest("hex");
 return input.signals.flatMap(signal=>{
  if(signal.accepted!==true)return[];
  if(signal.side!=="SHORT")throw Error("STABLE4_IDLE_SHADOW_NATIVE_SIDE_INVALID");
  const candidate=captureStable4NativeShadowObservation({...context,strategy:"IDLE",nativeKey:["IDLE",signal.symbol,signal.route,signal.side,signal.features.decisionTs].join(":"),symbol:signal.symbol,side:"SHORT",route:signal.route,logicalEntryTs:signal.features.decisionTs,gross:idleRouteRequestedGross(signal.symbol,signal.route),modelExpectedHoldHours:signal.holdHours,entrySnapshot:signal,coverageFrom:signal.features.signalTs,policyId:signal.route+":NATIVE_EXIT",shortReturnConvention:"linear"});
  return appendStable4NativeShadowCandidate(createStable4NativeShadowLedger("IDLE"),{...candidate,evidenceCoverage:{...candidate.evidenceCoverage,refs:[...candidate.evidenceCoverage.refs,{kind:"ENTRY",ref:context.sourceRef+":closed-history",sha256:sourceDigest}]}}).entries.map(e=>e.candidate);
 });
}
/** Snapshot before dispatch; neither observer failure nor an unresolved promise
 * is awaited by the protection/entry runner. No unhandled rejection escapes.
 */
export function dispatchStable4NativeShadowObservation<T>(observer:((snapshot:T)=>Promise<unknown>)|undefined,input:T,onFailure?:(message:string)=>void):void{
 if(!observer)return;
 let snapshot:T;
 try{snapshot=structuredClone(input);}catch(error){onFailure?.(error instanceof Error?error.message:String(error));return;}
 void Promise.resolve().then(()=>observer(snapshot)).catch(error=>{try{onFailure?.(error instanceof Error?error.message:String(error));}catch{/* Diagnostics cannot interrupt protection. */}});
}
/** Single trusted writer per framework partition. Missing stores never become
 * empty evidence. Candidate retries preserve the first observation clock when
 * native inputs, feature values, policy and source-content hashes are identical.
 */
export class Stable4NativeShadowObserver{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private readonly store:Stable4NativeShadowStore,private readonly strategy:Stable4EntryOpportunityStrategy){}
 capture(candidates:readonly Candidate[]):Promise<{captured:number;retained:number;revision:number}>{
  const captured=structuredClone(candidates);
  const work=this.queue.then(async()=>{
   const snap=await this.store.snapshot();if(snap.ledger.strategy!==this.strategy)throw Error("STABLE4_SHADOW_OBSERVER_PARTITION_MISMATCH");
   let next=snap.ledger,added=0,retained=0;
   for(const c of captured){
    const validated=appendStable4NativeShadowCandidate(createStable4NativeShadowLedger(this.strategy),c).entries[0].candidate;
    const old=next.entries.find(e=>e.candidate.nativeKey===validated.nativeKey)?.candidate;
    const retry=old?{...validated,capturedAt:old.capturedAt,evidenceCoverage:{...validated.evidenceCoverage,observedAt:old.evidenceCoverage.observedAt}}:validated;
    next=appendStable4NativeShadowCandidate(next,retry);if(old)retained++;else added++;
   }
   if(added)next=await this.store.commit(snap,next);
   return{captured:added,retained,revision:next.revision};
  });
  this.queue=work.catch(()=>undefined);return work;
 }
}
