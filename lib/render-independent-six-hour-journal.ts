/**
 * Independent RENDER read-only 6h shadow journal. This is a separate
 * causal data product: hypothetical TP1.5% exits are NOT the real TP2.5% venue exits.
 * All source data is signed off by the caller as complete venue M5 data.
 */
import {readFile, lstat, mkdir, writeFile, rename, chmod} from "node:fs/promises";
import {dirname} from "node:path";
import {
 RENDER_H1_MS, RENDER_INDEPENDENT_ROUTE, RENDER_SHADOW_VERSION,
 evaluateRenderIndependentGate, evaluateIndependentPriority, settleSixHourShadow,
 type ClosedM5, type ShadowSixHourResult
} from "./render-highwr-and-legacy-stop";

export type RenderIndependentShadowState = {
 schema:typeof RENDER_SHADOW_VERSION;
 runtimeSha:string;
 lastDecisionTs:number|null;
 pendingSignalTs:number[];
 settled:ShadowSixHourResult[];
};
export type RenderShadowDecision = {
 decisionTs:number;rawAccepted:boolean;rawReason:string;
 priority:ReturnType<typeof evaluateIndependentPriority>;
 pendingCount:number;settledCount:number;
};
const MAX_BACKFILL_HOURS=12;
function isSha(v:unknown){return typeof v==="string"&&/^[a-f0-9]{40}$/.test(v);}
function validate(x:RenderIndependentShadowState,sha:string){
 if(x.schema!==RENDER_SHADOW_VERSION||x.runtimeSha!==sha||!isSha(sha))throw Error("RENDER_SHADOW_SHA_OR_SCHEMA_MISMATCH");
 if(x.lastDecisionTs!==null&&(!Number.isSafeInteger(x.lastDecisionTs)||x.lastDecisionTs%RENDER_H1_MS!==0))throw Error("RENDER_SHADOW_LAST_TS_INVALID");
 if(!Array.isArray(x.pendingSignalTs)||!Array.isArray(x.settled))throw Error("RENDER_SHADOW_LEDGER_INVALID");
 const ids=new Set<number>();
 for(const t of x.pendingSignalTs){
  if(!Number.isSafeInteger(t)||t%RENDER_H1_MS!==0||ids.has(t)||x.lastDecisionTs!==null&&t>x.lastDecisionTs)throw Error("RENDER_SHADOW_PENDING_INVALID");
  ids.add(t);
 }
 for(const row of x.settled){
  if(row.route!==RENDER_INDEPENDENT_ROUTE||!Number.isSafeInteger(row.signalTs)||row.signalTs%RENDER_H1_MS!==0||
     !Number.isSafeInteger(row.settledAt)||row.settledAt<row.signalTs||
     !Number.isFinite(row.net30Pct)||!Number.isFinite(row.entryPrice)||!Number.isFinite(row.exitPrice)||
     ids.has(row.signalTs))throw Error("RENDER_SHADOW_SETTLED_INVALID");
  ids.add(row.signalTs);
 }
}
export function emptyRenderShadow(sha:string):RenderIndependentShadowState{
 const state={schema:RENDER_SHADOW_VERSION,runtimeSha:sha,lastDecisionTs:null,pendingSignalTs:[],settled:[]};
 validate(state,sha);return state;
}
export async function loadRenderShadow(path:string,sha:string):Promise<RenderIndependentShadowState>{
 try{
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error("RENDER_SHADOW_UNSAFE_PATH");
  const state=JSON.parse(await readFile(path,"utf8")) as RenderIndependentShadowState;
  validate(state,sha);return state;
 }catch(e){
  if((e as NodeJS.ErrnoException).code==="ENOENT")return emptyRenderShadow(sha);
  throw e;
 }
}
export async function saveRenderShadow(path:string,state:RenderIndependentShadowState){
 validate(state,state.runtimeSha);
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const tmp=path+"."+process.pid+".tmp";
 // Rename is atomic on the same filesystem; journal is never partly parsed.
 try{
  await writeFile(tmp,JSON.stringify(state)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});
  await chmod(tmp,0o600);
  await rename(tmp,path);
 }catch(e){throw e;}
}
export function advanceRenderShadow(input:{
 state:RenderIndependentShadowState;asOfDecisionTs:number;
 renderM5:readonly ClosedM5[];btcM5:readonly ClosedM5[];
 incumbentAt:(t:number)=>{route:string;score?:number}|undefined;
 sameSymbolPositionOrPending:boolean;cooldownUntil:number;
 requireShadowQuality?:boolean;
}):{state:RenderIndependentShadowState;decision:RenderShadowDecision}{
 const {asOfDecisionTs:t}=input;const old=input.state;validate(old,old.runtimeSha);
 if(!Number.isSafeInteger(t)||t%RENDER_H1_MS!==0||(old.lastDecisionTs!==null&&t<old.lastDecisionTs))throw Error("RENDER_SHADOW_TIME_REWIND");
 if(old.lastDecisionTs!==null&&t-old.lastDecisionTs>MAX_BACKFILL_HOURS*RENDER_H1_MS)throw Error("RENDER_SHADOW_BACKFILL_GAP_OPERATOR_REVIEW");
 const state:RenderIndependentShadowState={...old,pendingSignalTs:[...old.pendingSignalTs],settled:[...old.settled]};
 let final:RenderShadowDecision|undefined;
 const first=old.lastDecisionTs===null?t:old.lastDecisionTs+RENDER_H1_MS;
 for(let ts=first;ts<=t;ts+=RENDER_H1_MS){
  for(const signalTs of [...state.pendingSignalTs]){
   const result=settleSixHourShadow({signalTs,asOfTs:ts,renderM5:input.renderM5});
   if(result){
    state.settled.push(result);
    state.pendingSignalTs=state.pendingSignalTs.filter(s=>s!==signalTs);
   }
  }
  const gate=evaluateRenderIndependentGate({decisionTs:ts,renderM5:input.renderM5,btcM5:input.btcM5});
  const priority=evaluateIndependentPriority({
   decisionTs:ts,gate,fullySettledSixHourShadows:state.settled,
   incumbent:input.incumbentAt(ts),
   sameSymbolPositionOrPending:input.sameSymbolPositionOrPending,
   cooldownUntil:input.cooldownUntil,requireShadowQuality:input.requireShadowQuality
  });
  // The hypothetical quality ledger is independent of account capacity,
  // incumbent preference, cooldown, and whether any real trade was entered.
  if(gate.accepted)state.pendingSignalTs.push(ts);
  state.lastDecisionTs=ts;
  final={decisionTs:ts,rawAccepted:gate.accepted,rawReason:gate.reason,priority,
   pendingCount:state.pendingSignalTs.length,settledCount:state.settled.length};
 }
 // A repeated H1 must still return an as-of decision without duplicating signals.
 if(!final){
  const gate=evaluateRenderIndependentGate({decisionTs:t,renderM5:input.renderM5,btcM5:input.btcM5});
  final={decisionTs:t,rawAccepted:gate.accepted,rawReason:gate.reason,
   priority:evaluateIndependentPriority({decisionTs:t,gate,fullySettledSixHourShadows:state.settled,
    incumbent:input.incumbentAt(t),sameSymbolPositionOrPending:input.sameSymbolPositionOrPending,
    cooldownUntil:input.cooldownUntil,requireShadowQuality:input.requireShadowQuality}),
   pendingCount:state.pendingSignalTs.length,settledCount:state.settled.length};
 }
 validate(state,state.runtimeSha);
 return {state,decision:final};
}
