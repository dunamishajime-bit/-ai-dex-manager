import "dotenv/config";
import {readFile,lstat,mkdir,rename,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {AsterV3Client} from "../lib/aster-v3-client";
import {V12AsterLiveAdapter} from "../lib/v12-aster-live-adapter";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {executeV4WithContentionAudit} from "../lib/v12-v4-lock-contention-observer";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {initializeV4SignedFlatState} from "../lib/v12-v4-signed-bootstrap";
import {V4RunnerEngine,classifyV4RecoverableExitFeedFailure,classifyV4StaleExitDecisionFailure,classifyV4AccountLeaseRenewalFailure,classifyV4MarketDataReadFailure,type V4OperatorExitAuthorization} from "../lib/v12-v4-runner-engine";
import {loadV4ClosedCandles,buildV4LiveDecisionBatch} from "../lib/v12-v4-live-candidate-builder";
import {productionExitSpec} from "../lib/v12-v4-production-lifecycle";
import {assertV4CertifiedSource,assertV4CertifiedOrder} from "../lib/v12-v4-certified-gates";
import {readV4CanaryPermit,assertV4CanarySourceSnapshot,assertV4CanaryOrderAuthority} from "../lib/v12-v4-canary-permit";
import {readV4TimeStopApproval,approvedV4TimeStopQuote} from "../lib/v12-v4-time-stop-approval";
import {attachV4NativeCoreCandidates} from "../lib/v12-v4-core-candidate";
import {liveV4PeerLineageMode,type V4PeerKind,type V4PeerSource,type V4PeerLineageMode} from "../lib/v12-v4-peer-state-owners";
import {observeV4PeerService,observeCurrentV4PeerService} from "../lib/v12-v4-peer-service-attestation";
import {assertV4EntrySafety} from "../lib/v12-v4-entry-safety";
import {classifyAsterRateBudgetFailure,nextAsterRateBudgetRetryMs} from "../lib/disdex-aster-rate-budget-policy";
import type {V4ExecutionDocument} from "../lib/v12-v4-execution-store";
import type {V4PreparedDecision,V4TickResult} from "../lib/v12-v4-runner-engine";
const H2=7200000;
const V4_HEALTH_SCHEMA="disdex-v12-v4-runner-heartbeat/v1";
const V4_REALTIME_DECISION_SCHEMA="v12-v4-live-decision/v1";
const V4_GATE_TELEMETRY_SCHEMA="disdex-v12-v4-gate-telemetry/v1";
export type V4RateBudgetDefer={reason:string;waitMs:number};
export function classifyV4RateBudgetDefer(error:unknown,doc:V4ExecutionDocument):V4RateBudgetDefer|undefined{
 const rate=classifyAsterRateBudgetFailure(error);
 if(!rate)return;
 const activeIntent=Object.values(doc.intents).some(intent=>intent.stage!=="TERMINAL");
 const activeLeg=Object.values(doc.state.legs).some(leg=>leg.qty>0||leg.status==="PENDING_ENTRY"||leg.status==="OPEN");
 const activeProtection=Object.values(doc.protections).some(protection=>protection.phase!=="CLOSED");
 // A rate slot is reserved before HTTP transmission. It is safe to defer only
 // while the durable execution store proves there is nothing to reconcile.
 if(activeIntent||activeLeg||activeProtection)return;
 const waitMs=nextAsterRateBudgetRetryMs(0,1000,15000,rate.waitMs??0,()=>0.5);
 return {reason:"V4_RATE_BUDGET_DEFERRED:"+rate.reason,waitMs};
}
// A missing/foreign TIME37 approval is a flat-state configuration block, not a
// process crash. Never defer it when signed state may require STOP reconciliation.
export function classifyV4DaemonTimeStopApprovalBlock(error:unknown,doc:V4ExecutionDocument):
 {status:"blocked";reason:string;waitMs:number}|undefined{
 const message=error instanceof Error?error.message:String(error);
 const missing=error instanceof Error&&"code" in error&&error.code==="ENOENT";
 if(message!=="V4_TIME_STOP_OPERATOR_APPROVAL_REQUIRED"&&!missing)return;
 const activeIntent=Object.values(doc.intents).some(intent=>intent.stage!=="TERMINAL");
 const activeLeg=Object.values(doc.state.legs).some(leg=>leg.qty>0||leg.status==="PENDING_ENTRY"||leg.status==="OPEN");
 const activeProtection=Object.values(doc.protections).some(protection=>protection.phase!=="CLOSED");
 if(activeIntent||activeLeg||activeProtection)return;
 return {status:"blocked",reason:"V4_TIME37_APPROVAL_SHA_MISSING_OR_MISMATCH",waitMs:60000};
}
export async function retryV4FlatBootstrapRateBudget<T>(input:{
 operation:()=>Promise<T>;store:V4ExecutionStore;attempts?:number;wait?:(ms:number)=>Promise<void>;
}):Promise<T>{
 const attempts=Math.max(1,Math.min(12,Math.trunc(input.attempts??8)));
 const wait=input.wait??((ms:number)=>new Promise<void>(done=>setTimeout(done,ms)));
 for(let attempt=0;;attempt++){
  try{return await input.operation();}
  catch(error){
   const deferred=classifyV4RateBudgetDefer(error,input.store.read());
   if(!deferred||attempt+1>=attempts)throw error;
   const delay=nextAsterRateBudgetRetryMs(attempt,1000,15000,deferred.waitMs,()=>0.5);
   await wait(delay);
  }
 }
}
export async function retryV4StartupExchangeInfo<T>(input:{
 operation:()=>Promise<T>;store:V4ExecutionStore;attempts?:number;wait?:(ms:number)=>Promise<void>;
}):Promise<T>{
 const attempts=Math.max(1,Math.min(3,Math.trunc(input.attempts??3)));
 const wait=input.wait??((ms:number)=>new Promise<void>(done=>setTimeout(done,ms)));
 for(let attempt=0;;attempt++){
  try{return await input.operation();}
  catch(error){
   const failure=classifyV4MarketDataReadFailure(error,Date.now(),input.store.read());
   if(!failure||attempt+1>=attempts)throw error;
   await wait(Math.max(1000,Math.min(15000,failure.retryAfterMs??15000)));
  }
 }
}
export function classifyV4StartupExchangeInfoFailure(error:unknown,eventTs=Date.now()):V4TickResult|undefined{
 const message=error instanceof Error?error.message:String(error);
 const prefix="V4_STARTUP_EXCHANGE_INFO_UNAVAILABLE:";
 if(!message.startsWith(prefix))return;
 const inner=message.slice(prefix.length);
 if(inner.startsWith("V4_RATE_BUDGET_RECONCILIATION_BLOCKED:"))
  return {status:"blocked",reason:inner,eventTs,candidateCount:0,orderEnabled:false,retryAfterMs:15000};
 if(inner.startsWith("V4_RATE_BUDGET_DEFERRED:"))
  return {status:"observing",reason:inner,eventTs,candidateCount:0,orderEnabled:false,retryAfterMs:15000};
 const reason=inner.startsWith("V4_MARKET_DATA_UNAVAILABLE:")?inner.slice("V4_MARKET_DATA_UNAVAILABLE:".length):inner;
 const failure=classifyV4MarketDataReadFailure(new Error(reason),eventTs);
 if(!failure)return;
 return failure;
}
// Keep the daemon alive during precisely classified local rate-budget
// contention. With an unresolved intent, owned leg, or resident protection,
// this is not a benign defer: publish a BLOCKED fail-closed heartbeat, disable
// new orders for the tick, and retry signed reconciliation on the next cycle.
// Unknown and non-budget errors retain the fatal path.
export type V4DaemonRateBudgetOutcome={status:"observing"|"blocked";reason:string;waitMs:number};
export function classifyV4DaemonRateBudgetOutcome(
 error:unknown,doc:V4ExecutionDocument,
):V4DaemonRateBudgetOutcome|undefined{
 const rate=classifyAsterRateBudgetFailure(error);
 if(!rate)return;
 const flat=classifyV4RateBudgetDefer(error,doc);
 if(flat)return {...flat,status:"observing"};
 return {status:"blocked",reason:"V4_RATE_BUDGET_RECONCILIATION_BLOCKED:"+rate.reason,
  waitMs:Math.max(15000,nextAsterRateBudgetRetryMs(0,1000,15000,rate.waitMs??0,()=>0.5))};
}
export type V4HealthSafetyState="HEALTHY"|"BLOCKED"|"DEFERRED_FAIL_CLOSED";
export function classifyV4HealthSafetyState(result:{status:string;reason:string}):V4HealthSafetyState{
 if(result.status==="blocked"||/^(?:V4_PREPARE_NOT_AVAILABLE|V4_MARKET_DATA_UNAVAILABLE|V4_STARTUP_EXCHANGE_INFO_UNAVAILABLE|V4_EXIT_FEED_GAP_RETRY|V4_EXIT_FEED_NEXT_OPEN_RETRY|V4_STALE_EXIT_REVIEW_REQUIRED|V4_ACCOUNT_LEASE_RENEWAL_FAILED_RETRY)(?::|$)/.test(result.reason))return "BLOCKED";
 if(result.reason.startsWith("V4_RATE_BUDGET_"))return "DEFERRED_FAIL_CLOSED";
 return "HEALTHY";
}
function v4HealthPath(){
 return String(process.env.V12_V4_HEALTH_STATE_PATH??"/var/lib/disdex/v12-v4/heartbeat.json").trim();
}
const V4_IDLE_BASELINE_SCHEMA="v12-v4-idle-baseline/v1";
export type V4IdleBaselineSnapshot={
 schema:typeof V4_IDLE_BASELINE_SCHEMA;strategyId:"V12_V4";releaseSha:string;runtimeSha:string;
 updatedAt:number;sourceComplete:boolean;candidateCount:number;reason:string;decisionTs?:number;capturedAtMs?:number;
};
export function buildV4IdleBaselineSnapshot(releaseSha:string,prepared:V4PreparedDecision|undefined,updatedAt=Date.now()):V4IdleBaselineSnapshot{
 const base={schema:V4_IDLE_BASELINE_SCHEMA,strategyId:"V12_V4" as const,releaseSha,runtimeSha:releaseSha,updatedAt} as const;
 if(!prepared)return {...base,sourceComplete:false,candidateCount:0,reason:"V4_EXECUTION_STATE_NOT_FLAT_OR_PREPARE_SKIPPED"};
 if(prepared.kind==="FAILED")return {...base,sourceComplete:false,candidateCount:0,reason:"V4_MARKET_DATA_UNAVAILABLE:"+prepared.reason};
 const decision=prepared.decision;
 const sourceComplete=decision.errors.length===0;
 return {...base,sourceComplete,candidateCount:sourceComplete?decision.candidateCount:0,
  reason:sourceComplete?(decision.candidateCount>0?"SIGNAL_AVAILABLE":"NO_COMPLETED_BAR_SIGNAL"):"V4_DECISION_SOURCE_INCOMPLETE",
  decisionTs:decision.decisionTs,capturedAtMs:decision.capturedAtMs};
}
async function writeV4IdleBaselineSnapshot(releaseSha:string,prepared:V4PreparedDecision|undefined){
 const path=String(process.env.V12_V4_IDLE_BASELINE_SNAPSHOT_PATH??"/var/lib/disdex/v12-v4/idle-baseline-snapshot.json").trim();
 if(!path.startsWith("/var/lib/disdex/v12-v4/"))throw Error("V4_IDLE_BASELINE_PATH_INVALID");
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const now=Date.now(),tmp=path+"."+process.pid+"."+now+".tmp";
 await writeFile(tmp,JSON.stringify(buildV4IdleBaselineSnapshot(releaseSha,prepared,now))+"\n",{encoding:"utf8",mode:0o600});
 await rename(tmp,path);
}
function telemetryPath(name:string,fallback:string){
 const path=String(process.env[name]??fallback).trim();
 if(!path.startsWith("/var/lib/disdex/v12-v4/"))throw Error("V4_TELEMETRY_PATH_INVALID:"+name);
 return path;
}
async function writeAtomicJson(path:string,payload:Record<string,unknown>){
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const now=Date.now(),tmp=path+"."+process.pid+"."+now+".tmp";
 await writeFile(tmp,JSON.stringify(payload)+"\n",{encoding:"utf8",mode:0o600});
 await rename(tmp,path);
}
export function buildV4RealtimeDecisionTelemetry(releaseSha:string,operationMode:string,prepared:V4PreparedDecision|undefined,result:Pick<V4TickResult,"status"|"reason"|"eventTs"|"candidateCount"|"orderEnabled">,updatedAt=Date.now()):Record<string,unknown>{
 const base={releaseSha,runtimeSha:releaseSha,sourceRuntimeSha:releaseSha,source:"RUNNER_SAME_CLOSED_CANDLE_BATCH",operationMode,
  status:result.status,reason:result.reason,orderEnabled:result.orderEnabled,updatedAt,lastTickAt:result.eventTs};
 if(!prepared||prepared.kind!=="READY")return {schema:V4_REALTIME_DECISION_SCHEMA,policyId:"V2_M150_D05_CORE_NATIVE",decisionTs:null,capturedAtMs:null,
  sourceFingerprint:null,candidateCount:0,filteredCount:0,sourceCount:0,nativeCoreEvents:[],entryAtrByCandidate:{},errors:[prepared&&prepared.kind==="FAILED"?prepared.reason:"V4_PREPARE_NOT_AVAILABLE"],
  candidates:[],filtered:[],realOrderEnabledV4:0,tradingMutation:0,stale:true,staleReason:prepared&&prepared.kind==="FAILED"?prepared.reason:"V4_PREPARE_NOT_AVAILABLE",...base};
 const decision=prepared.decision;
 return {...decision,...base,schema:V4_REALTIME_DECISION_SCHEMA,stale:false,staleReason:null};
}
export function buildV4GateTelemetry(releaseSha:string,operationMode:string,prepared:V4PreparedDecision|undefined,result:Pick<V4TickResult,"status"|"reason"|"eventTs"|"candidateCount"|"orderEnabled">,computedAtMs=Date.now()):Record<string,unknown>{
 const base={schema:V4_GATE_TELEMETRY_SCHEMA,strategyId:"V12_V4",releaseSha,runtimeSha:releaseSha,activeRunnerSha:releaseSha,operationMode,
  source:"RUNNER_SAME_CLOSED_CANDLE_BATCH",computedAtMs,updatedAt:computedAtMs,lastTickAt:result.eventTs,status:result.status,reason:result.reason,
  stale:true,telemetryFresh:false};
 if(!prepared||prepared.kind!=="READY")return {...base,decisionTs:null,capturedAtMs:null,sourceFingerprint:null,sourceCount:0,candidateCount:0,filteredCount:0,btcRegime:"UNKNOWN",symbolCount:0,symbols:[]};
 const decision=prepared.decision;
 const sourceBySymbol=new Map((decision.nativeSources??[]).map(source=>[source.source.symbol.replace(/USDT$/,""),source] as const));
 const observedBySymbol=new Map((decision.observedCandidates??[]).map(candidate=>[candidate.symbol,candidate] as const));
 const symbols=Array.from(new Set([
  ...(decision.observedCandidates??[]).map(candidate=>candidate.symbol),
  ...(decision.nativeSources??[]).map(source=>source.source.symbol.replace(/USDT$/,"")),
  ...decision.candidates.map(candidate=>candidate.symbol),
  ...decision.filtered.map(candidate=>candidate.symbol),
 ])).sort().map(symbol=>{
  const source=sourceBySymbol.get(symbol);
  const observed=observedBySymbol.get(symbol);
  const candidate=decision.candidates.find(row=>row.symbol===symbol);
  const side=source?.source.side??observed?.side??(candidate as any)?.effectiveSide??(candidate as any)?.side??null;
  const eligible=Boolean(source);
  return {symbol:symbol+"USDT",nativeSide:side,sourceEligible:eligible,
   sourceReason:source?.entryGateReason??observed?.signalReason??(eligible?"NATIVE_SIGNAL_SOURCE":"NO_NATIVE_SIGNAL_SOURCE"),
   portfolioRank:source?.rank??observed?.portfolioRank??(candidate as any)?.rank??null,nativeScore:source?.score??observed?.score??(candidate as any)?.score??null,
   gates:[{key:"NATIVE_ENTRY_SOURCE",state:eligible?"PASS":"BLOCK",actual:eligible?1:0,required:"V12_NATIVE_ENTRY_SOURCE",
    reason:source?.entryGateReason??observed?.signalReason??(eligible?"NATIVE_SIGNAL_SOURCE":"NO_NATIVE_SIGNAL_SOURCE")}],
   routeGate:{state:eligible?"PASS":"NOT_EVALUATED",routes:[],reason:eligible?"PRODUCTION_CANDIDATE_ADAPTER":observed?.signalReason??"NO_NATIVE_SIGNAL_SOURCE"}};
 });
 return {...base,decisionTs:decision.decisionTs,capturedAtMs:decision.capturedAtMs,sourceFingerprint:decision.sourceFingerprint,
  sourceCount:decision.sourceCount,candidateCount:decision.candidateCount,filteredCount:decision.filteredCount,btcRegime:decision.btcRegime??"UNKNOWN",
  symbolCount:symbols.length,symbols,stale:false,telemetryFresh:true};
}
async function writeV4DecisionTelemetry(releaseSha:string,operationMode:string,prepared:V4PreparedDecision|undefined,result:Pick<V4TickResult,"status"|"reason"|"eventTs"|"candidateCount"|"orderEnabled">){
 const now=Date.now();
 await writeAtomicJson(telemetryPath("V12_V4_REALTIME_DECISION_PATH","/var/lib/disdex/v12-v4/realtime-decision.json"),buildV4RealtimeDecisionTelemetry(releaseSha,operationMode,prepared,result,now));
 await writeAtomicJson(telemetryPath("V12_V4_GATE_TELEMETRY_PATH","/var/lib/disdex/v12-v4/gate-telemetry.json"),buildV4GateTelemetry(releaseSha,operationMode,prepared,result,now));
}
async function writeV4Health(releaseSha:string,operationMode:string,result:{
 status:string;reason:string;eventTs:number;candidateCount:number;orderEnabled:boolean;
}){
 const path=v4HealthPath();
 if(!path.startsWith("/var/lib/disdex/v12-v4/"))throw Error("V4_HEALTH_PATH_INVALID");
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const now=Date.now(),tmp=path+"."+process.pid+"."+now+".tmp";
 const serviceUnit=String(process.env.V12_V4_SERVICE_UNIT??`disdex-v12-v4@${releaseSha}.service`).trim();
 const workingDirectory=String(process.env.DISDEX_RELEASE_ROOT??process.cwd()).trim();
 const failed=result.status==="blocked"||result.status.toLowerCase()==="failed";
 const deferred=result.reason.startsWith("V4_RATE_BUDGET_DEFERRED");
 const payload={
  schema:V4_HEALTH_SCHEMA,runnerId:"V12_V4",serviceUnit,expectedSha:releaseSha,workingDirectory,
  liveEnabled:true,limitedLive:operationMode==="CANARY",safetyState:failed?"BLOCKED":deferred?"DEFERRED_FAIL_CLOSED":classifyV4HealthSafetyState(result),
  heartbeatAt:now,mainPid:process.pid,strategyId:"V12_V4",releaseSha,runtimeSha:releaseSha,
  operationMode,mode:"LIVE",updatedAt:now,lastTickAt:result.eventTs,
  status:result.status,reason:result.reason,candidateCount:result.candidateCount,
  orderEnabled:result.orderEnabled,
 };
 await writeFile(tmp,JSON.stringify(payload)+"\n",{encoding:"utf8",mode:0o600});
 await rename(tmp,path);
}

function env(name:string){
 const value=String(process.env[name]??"").trim();
 if(!value)throw Error("V4_MISSING_CONFIGURATION:"+name);
 return value;
}
async function safeJson(path:string){
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink())throw Error("V4_UNSAFE_SOURCE_FILE");
 return JSON.parse(await readFile(path,"utf8")) as Record<string,any>;
}
async function loadPeers(releaseSha:string,lineageMode:V4PeerLineageMode="UNIFIED_RELEASE"):Promise<V4PeerSource[]>{
 const paths=JSON.parse(env("V12_V4_PEER_STATE_PATHS_JSON")) as Record<V4PeerKind,string>;
 const kinds:V4PeerKind[]=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"];
 return Promise.all(kinds.map(async kind=>{
  const path=paths[kind];
  if(!path||!path.startsWith("/var/lib/disdex/"))throw Error("V4_PEER_STATE_PATH_INVALID:"+kind);
  const raw=await safeJson(path);
  let programSha=String(raw.runtimeCommitSha??raw.runtimeSha??"").toLowerCase();
  let programShaSource:"STATE"|"SYSTEMD"="STATE";
  let service;
  const explicitlyDisabledV52=kind==="V52"&&raw.mode==="DISABLED"&&raw.ordersAllowed===false&&raw.newOrdersAllowed===false&&
   raw.pending==null&&raw.pendingOrder==null&&raw.manualReview==null&&raw.manualReviewReason==null&&
   raw.position==null&&raw.positions&&typeof raw.positions==="object"&&Object.keys(raw.positions).length===0&&
   Number.isFinite(Number(raw.updatedAt));
  if(explicitlyDisabledV52){
   if(!/^[a-f0-9]{40}$/.test(programSha))throw Error("V4_DISABLED_PEER_RELEASE_NOT_ATTESTED:V52");
   service={unit:"disdex-v52-aster-only@"+programSha+".service",active:false,retiredV12:false,disabled:true,observedAt:Date.now(),mainPid:0};
  }else if(kind!=="V12"&&lineageMode==="ATTEST_EACH_PEER"&&!/^[a-f0-9]{40}$/.test(programSha)){
   const current=await observeCurrentV4PeerService(kind);
   programSha=current.sha;service=current.service;programShaSource="SYSTEMD";
  }else{
   if(!/^[a-f0-9]{40}$/.test(programSha))throw Error("V4_PEER_RELEASE_NOT_ATTESTED:"+kind);
   const serviceSha=kind==="V12"||lineageMode==="UNIFIED_RELEASE"?releaseSha:programSha;
   service=await observeV4PeerService(kind,serviceSha);
  }
  if(!service.retiredV12&&!service.active&&!service.disabled)throw Error("V4_PEER_SERVICE_NOT_ATTESTED:"+kind);
  return {kind,programSha,programShaSource,raw,service};
 }));
}
function requireReleaseSha(){
 const sha=env("DISDEX_RELEASE_SHA").toLowerCase();
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error("V4_INVALID_RELEASE_SHA");
 if(env("V12_V4_LIVE_ACK").toLowerCase()!==sha)throw Error("V4_RELEASE_ACK_MISMATCH");
 return sha;
}
function requireV4OperationMode():"CERTIFIED"|"CANARY"{
 const operationModeRaw=String(process.env.V12_V4_OPERATION_MODE??"CERTIFIED").trim().toUpperCase();
 if(operationModeRaw!=="CERTIFIED"&&operationModeRaw!=="CANARY")throw Error("V4_OPERATION_MODE_INVALID");
 return operationModeRaw;
}
export type V4ProductionRuntimeOptions={
 operatorExitLegIds?:ReadonlySet<string>;
 authorizeOperatorExit?:V4OperatorExitAuthorization;
};
export async function buildV4ProductionRuntime(options:V4ProductionRuntimeOptions={}){
 const releaseSha=requireReleaseSha();
 const operationMode=requireV4OperationMode();
 const canaryPermit=operationMode==="CANARY"?await readV4CanaryPermit(releaseSha):undefined;
 // Existing PENGU, FET, Q102, V52, HYPE and Idle remain on independently observed exact SHA releases.
 const peerLineageMode=liveV4PeerLineageMode(operationMode);
 const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,
  userAddress:process.env.ASTER_USER_ADDRESS,
  privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,
  requestTimeoutMs:10000,userAgent:"DisDex-V12-V4-Production/"+releaseSha.slice(0,12)});
 if(!client.hasTradingCredentials())throw Error("V4_SIGNED_VENUE_CREDENTIALS_REQUIRED");
 const adapter=new V12AsterLiveAdapter(client,{maxSlippageBps:20});
 const store=new V4ExecutionStore(env("V12_V4_EXECUTION_STORE_PATH"),releaseSha);
 if(process.argv.includes("--init-signed-flat")){
  await initializeV4SignedFlatState({store,client,peers:await loadPeers(releaseSha,peerLineageMode),
   pendingPath:env("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH"),peerLineageMode});
 }
 store.read();
 const lock=new FileAccountOrderLock(env("DISDEX_ACCOUNT_LOCK_PATH"),120000);
 const pendingRegistryPath=env("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH");
 let info:Awaited<ReturnType<AsterV3Client["getExchangeInfo"]>>;
 try{
  info=await retryV4StartupExchangeInfo({operation:()=>client.getExchangeInfo(),store});
 }catch(error){
  const failure=classifyV4MarketDataReadFailure(error,Date.now(),store.read());
  if(!failure)throw error;
  throw Error("V4_STARTUP_EXCHANGE_INFO_UNAVAILABLE:"+failure.reason);
 }
 const symbols=new Map(info.symbols.map(row=>[row.symbol,row]));
 let cache:{boundary:number;value:ReturnType<typeof buildV4LiveDecisionBatch>}|undefined;
 const fetchDecision=async()=>{
  const now=Date.now(),boundary=now-now%H2;
  if(cache&&cache.boundary===boundary)return cache.value;
  const bars=await loadV4ClosedCandles(client,now);
  let value=buildV4LiveDecisionBatch(bars,now);
  if(value.nativeCoreEvents.length){
   const refs=new Map<string,number>();
   for(const event of value.nativeCoreEvents){
    const raw=await client.getKlines(event.symbol+"USDT","1h",3);
    const opened=raw.find(row=>Number(row[0])===event.entry_ts_ms);
    if(!opened||Number(opened[0])>now||!(Number(opened[1])>0))
     throw Error("V4_NATIVE_CORE_ENTRY_H1_OPEN_MISSING");
    refs.set(event.symbol+"|"+event.entry_ts_ms,Number(opened[1]));
   }
   value=attachV4NativeCoreCandidates(value,bars,refs);
  }
  cache={boundary,value};
  return value;
 };
 const engine=new V4RunnerEngine({
  store,accountLock:lock,adapter,client,pendingRegistryPath,
  fetchDecision,fetchPeers:()=>loadPeers(releaseSha,peerLineageMode),peerLineageMode,
  fetchExitFeed:async (symbol,fromTs,untilTs)=>{
   const now=Date.now();
   const start=Number.isFinite(fromTs)?Number(fromTs):undefined;
   const end=Number.isFinite(untilTs)?Math.min(Number(untilTs),now):undefined;
   const [rows,m5rows]=await Promise.all([
    client.getKlines(symbol,"1h",500,{startTime:start,endTime:end}),
    client.getKlines(symbol,"5m",1000,{startTime:start,endTime:end}),
   ]);
   const nextOpens=rows.filter(x=>Number(x[0])<=now).map(x=>({ts:Number(x[0]),price:Number(x[1])}));
   // Some venue responses exclude the candle whose open time equals the
   // requested endTime. At a terminal TIME/native boundary, re-read only
   // that exact H1 open; never substitute a close or fabricate a price.
   const exactBoundary=Number(untilTs);
   if(Number.isFinite(exactBoundary)&&exactBoundary%3600000===0&&exactBoundary<=now&&
      !nextOpens.some(x=>x.ts===exactBoundary)){
    const targeted=await client.getKlines(symbol,"1h",3,{startTime:exactBoundary,endTime:exactBoundary+3600000-1});
    for(const row of targeted){
     const ts=Number(row[0]),price=Number(row[1]);
     if(ts===exactBoundary&&price>0&&Number(row[6])<now)nextOpens.push({ts,price});
    }
   }
   return {
    closed:rows.filter(x=>Number(x[0])+3600000<=now&&Number(x[6])<now)
     .map(x=>({openTs:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4])})),
    closedM5:m5rows.filter(x=>Number(x[0])+300000<=now&&Number(x[6])<now)
     .map(x=>({openTs:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),observedAt:now})),
    nextOpens,
   };
  },
  quantityNormalizer:adapter.executor,
  referencePrice:async symbol=>{
   const quote=await adapter.executor.getMarketQuote(symbol);
   const p=(Number(quote.askPrice)+Number(quote.bidPrice))/2;
   if(!(p>0))throw Error("V4_MARKET_QUOTE_NOT_VALID");
   return p;
  },
  minimumVenueOrderNotional:async(symbol,price)=>{
   const row=symbols.get(symbol);
   if(!row||row.status!=="TRADING")throw Error("V4_SYMBOL_NOT_TRADING");
   const notional=Number(row.filters?.find(f=>f.filterType==="MIN_NOTIONAL")?.notional);
   const qty=Number(row.filters?.find(f=>f.filterType==="LOT_SIZE")?.minQty);
   if(!(notional>0)||!(qty>0))throw Error("V4_VENUE_FILTER_NOT_ATTESTED");
   return Math.max(notional,qty*price);
  },
  requiredResidentStop:async({route,side,entryPrice,atr14})=>{
   const spec=productionExitSpec(route),sg=side==="LONG"?1:-1;
   if(spec.kind==="TIME"){
    // Never infer authorization from research scores or environment flags.
    // A root-owned exact-SHA policy artifact must be explicitly installed.
    const approval=await readV4TimeStopApproval(releaseSha);
    return approvedV4TimeStopQuote({route,side,signedAverageEntryFill:entryPrice,approval});
   }
   return spec.kind==="ATR"?entryPrice-sg*spec.sl*atr14:
    (await import("../lib/v12-x1-all")).protectiveLevels(entryPrice,atr14,side).initialStop;
  },
  canaryEntry:canaryPermit?{maxNotionalUsd:canaryPermit.absoluteNotionalCapUsd}:undefined,
  operatorExitLegIds:options.operatorExitLegIds,
  authorizeOperatorExit:options.authorizeOperatorExit,
  assertEntrySafety:async()=>{await assertV4EntrySafety();},
  assertSourceParity:async decision=>{
   if(canaryPermit)assertV4CanarySourceSnapshot(decision,canaryPermit,releaseSha);
   else await assertV4CertifiedSource(releaseSha,decision);
  },
  assertAuthority:async cmd=>{
   if(canaryPermit)assertV4CanaryOrderAuthority({sha:releaseSha,command:cmd,
    permit:canaryPermit,ownedDocument:store.read()});
   else await assertV4CertifiedOrder(releaseSha,cmd,store.read());
  },
 });
 return {engine,store,releaseSha,operationMode};
}
async function main(){
 const once=process.argv.includes("--once"),daemon=process.argv.includes("--daemon"),initialize=process.argv.includes("--init-signed-flat");
 if(process.argv.includes("--self-test")){
  const {PRODUCTION_EXIT_CATALOG}=await import("../lib/v12-v4-production-lifecycle");
  if(PRODUCTION_EXIT_CATALOG.length!==41)throw Error("V4_ROUTE_CATALOG_INCOMPLETE");
  console.log(JSON.stringify({status:"SELF_TEST_PASS",routes:41,realOrderEnabledV4:0}));
  return;
 }
 if(!once&&!daemon&&!initialize)throw Error("V4_RUNNER_REQUIRES_MODE");
 let stopping=false;
 process.once("SIGINT",()=>{stopping=true;});
 process.once("SIGTERM",()=>{stopping=true;});
 let runtime:Awaited<ReturnType<typeof buildV4ProductionRuntime>>|undefined;
 for(;;){
  try{
   runtime=await buildV4ProductionRuntime();
   break;
  }catch(error){
   const startup=classifyV4StartupExchangeInfoFailure(error,Date.now());
   if(!startup)throw error;
   const releaseSha=requireReleaseSha(),operationMode=requireV4OperationMode();
   try{await writeV4DecisionTelemetry(releaseSha,operationMode,undefined,startup);}catch(telemetryError){
    console.error(JSON.stringify({level:"error",status:"V4_TELEMETRY_WRITE_FAILED",error:telemetryError instanceof Error?telemetryError.message:String(telemetryError)}));
   }
   await writeV4Health(releaseSha,operationMode,startup);
   const retryAfterMs=startup.retryAfterMs??15000;
   console.log(JSON.stringify({releaseSha,operationMode,timestamp:new Date().toISOString(),...startup,retryAfterMs,startup:true}));
   if(!daemon||stopping)return;
   await new Promise<void>(done=>setTimeout(done,retryAfterMs));
  }
 }
 if(!runtime)return;
 const {engine,store,releaseSha,operationMode}=runtime;
 if(initialize){console.log(JSON.stringify({status:"SIGNED_FLAT_STATE_INITIALIZED",releaseSha,operationMode,orderEnabled:false}));return;}
 do{
  let result:V4TickResult;
  let prepared:V4PreparedDecision|undefined;
  let deferredWaitMs=0;
  let hadLockContention=false;
  try{
   // Complete H1/H2 market-data reads outside the account mutex when V4 has
   // no unresolved order or owned leg. Signed account and STOP recovery always
   // remain inside engine.tick() under the original exclusive lease.
   // Check exact-SHA TIME37 authority *before* any possible flat ENTRY.
   // When the signed store is flat, publish a fail-closed BLOCKED heartbeat and
   // keep the process alive for an explicitly approved root-owned artifact.
   // Existing exposure is never treated as a benign approval deferral.
   let approvalBlock:ReturnType<typeof classifyV4DaemonTimeStopApprovalBlock>;
   try{await readV4TimeStopApproval(releaseSha);}
   catch(error){
    approvalBlock=classifyV4DaemonTimeStopApprovalBlock(error,store.read());
    if(!approvalBlock)throw error;
   }
   if(approvalBlock){
    result={status:"blocked",reason:approvalBlock.reason,eventTs:Date.now(),candidateCount:0,orderEnabled:false};
    deferredWaitMs=approvalBlock.waitMs;
   }else{
    prepared=await engine.prepareFlatMarketDecision();
    await writeV4IdleBaselineSnapshot(releaseSha,prepared);
    result=await executeV4WithContentionAudit({
     operation:()=>engine.tick(prepared),releaseSha,operationMode,
     accountLockPath:env("DISDEX_ACCOUNT_LOCK_PATH"),
     attempts:10,retryMs:750,shouldStop:()=>stopping,
     onContention:()=>{hadLockContention=true;},
    });
    deferredWaitMs=Math.max(deferredWaitMs,result.retryAfterMs??0);
   }
  }catch(error){
   const leaseRenewal=classifyV4AccountLeaseRenewalFailure(error,Date.now());
   if(leaseRenewal){
    result=leaseRenewal;
    deferredWaitMs=leaseRenewal.retryAfterMs??15000;
   }else{
   const staleExitReview=classifyV4StaleExitDecisionFailure(error,Date.now());
   if(staleExitReview){
    result=staleExitReview;
    deferredWaitMs=Math.max(15000,Number(process.env.V12_V4_TICK_INTERVAL_MS||60000));
   }else{
    const recoverableExitGap=classifyV4RecoverableExitFeedFailure(error,Date.now());
    if(recoverableExitGap){
    result=recoverableExitGap;
    deferredWaitMs=Math.max(15000,Number(process.env.V12_V4_TICK_INTERVAL_MS||60000));
    }else{
    const budget=classifyV4DaemonRateBudgetOutcome(error,store.read());
    if(!budget)throw error;
    deferredWaitMs=budget.waitMs;
    result={status:budget.status,reason:budget.reason,eventTs:Date.now(),candidateCount:0,orderEnabled:false};
    }
   }
   }
  }
  try{await writeV4DecisionTelemetry(releaseSha,operationMode,prepared,result);}catch(error){
   console.error(JSON.stringify({level:"error",status:"V4_TELEMETRY_WRITE_FAILED",error:error instanceof Error?error.message:String(error)}));
  }
  await writeV4Health(releaseSha,operationMode,result);
  console.log(JSON.stringify({releaseSha,operationMode,timestamp:new Date().toISOString(),...result,
   ...(deferredWaitMs?{retryAfterMs:deferredWaitMs}:{}),hadLockContention}));
  if(!daemon||stopping)break;
  // Persistent lock contention retries quickly, while a resolved collision gets
  // one phase-shifted normal tick so V4 does not re-align with the same peer.
  const normalWait=Math.max(15000,Number(process.env.V12_V4_TICK_INTERVAL_MS||60000));
  const nextDelay=result.status==="locked"?15000:
   deferredWaitMs>0?Math.max(1000,deferredWaitMs):
   normalWait+(hadLockContention?7000:0);
  await new Promise<void>(done=>setTimeout(done,nextDelay));
 }while(!stopping);
}
if(process.argv[1]?.includes("v12-v4-production-runner"))
 main().catch(error=>{
  console.error(JSON.stringify({level:"fatal",status:"V4_RUNNER_FAILED_CLOSED",
   error:error instanceof Error?error.message:String(error)}));
  process.exitCode=2;
 });
