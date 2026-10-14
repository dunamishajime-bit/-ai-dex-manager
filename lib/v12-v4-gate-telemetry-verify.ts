import type {V12V4HpSnapshot} from "./v12-v4-hp-contract";
import type {V4VerifiedGateTelemetry,V4GateTelemetryItem,V4SourceGateState} from "./v12-v4-gate-score";
import {DIST_TERMINAL_LIVE_CONFIG} from "./disterminal-live-config";
import {V12_V4_HP_TARGET} from "./v12-v4-hp-contract";
type Obj=Record<string,unknown>;
const object=(v:unknown):v is Obj=>!!v&&typeof v==="object"&&!Array.isArray(v);
const state=(v:unknown):v is V4SourceGateState=>v==="PASS"||v==="BLOCK"||v==="NOT_EVALUATED";
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
export function verifyV4GateTelemetry(
 gates:unknown,decision:unknown,live:V12V4HpSnapshot,now=Date.now(),
):V4VerifiedGateTelemetry|null{
 const sha=live.actual.currentReleaseSha;
 if(!object(gates)||!object(decision)||!sha||live.displayStatus!=="LIVE_VERIFIED"||
  !live.freshness.heartbeat||live.actual.v12PrimaryMode!=="V4"||
  live.actual.legacyV12RunnerActive!==false||live.actual.heartbeatSha!==sha||
  live.actual.activeRunnerSha!==sha||
  gates.schema!=="disdex-v12-v4-gate-telemetry/v1"||
  gates.source!=="RUNNER_SAME_CLOSED_CANDLE_BATCH"||
  gates.releaseSha!==sha||gates.runtimeSha!==sha||
  gates.readOnly!==true||gates.orderEnabled!==false||gates.tradingMutation!==0||
  decision.schema!=="v12-v4-live-decision/v1"||decision.policyId!==V12_V4_HP_TARGET.policyId||decision.releaseSha!==sha||
  decision.runtimeSha!==sha||decision.orderEnabled!==false||
  decision.tradingMutation!==0||decision.realOrderEnabledV4!==0||
  !finite(gates.decisionTs)||!finite(gates.capturedAtMs)||
  gates.decisionTs!==decision.decisionTs||gates.capturedAtMs!==decision.capturedAtMs||
  typeof gates.sourceFingerprint!=="string"||!/^[a-f0-9]{64}$/.test(gates.sourceFingerprint)||
  gates.sourceFingerprint!==decision.sourceFingerprint||
  now-gates.decisionTs>135*60_000||now-gates.decisionTs< -60_000||
  now-gates.capturedAtMs>135*60_000||now-gates.capturedAtMs< -60_000||
  !Array.isArray(gates.symbols)||!Array.isArray(decision.candidates)||!Array.isArray(decision.filtered)||
  gates.symbols.length!==14||gates.symbolCount!==14||
  gates.candidateCount!==decision.candidates.length||
  gates.filteredCount!==decision.filtered.length||!Array.isArray(decision.errors)||decision.errors.length)return null;
 const symbolSet=new Set<string>(DIST_TERMINAL_LIVE_CONFIG.v12Symbols);
 const seen=new Set<string>(),items:V4GateTelemetryItem[]=[];
 const gateKeys=["VOLUME_RATIO","EDGE_TO_COST","DIRECTIONAL_MOMENTUM","REGIME_ENTRY_QUALITY","WIN_RATE_OVERLAY"];
 for(const x of gates.symbols){
  if(!object(x)||typeof x.symbol!=="string"||!symbolSet.has(x.symbol)||seen.has(x.symbol)||
   !Array.isArray(x.gates)||x.gates.length!==5||!object(x.routeGate)||
   !(x.nativeSide===null||x.nativeSide==="LONG"||x.nativeSide==="SHORT")||
   !(x.sourceEligible===null||typeof x.sourceEligible==="boolean")||
   typeof x.sourceReason!=="string"||
   !(x.portfolioRank===null||finite(x.portfolioRank))||
   !(x.nativeScore===null||finite(x.nativeScore)))return null;
  const found=new Map<string,V4GateTelemetryItem["gates"][number]>();
  for(const raw of x.gates){
   if(!object(raw)||typeof raw.key!=="string"||!gateKeys.includes(raw.key)||found.has(raw.key)||
    !state(raw.state)||!(raw.actual===null||finite(raw.actual)||typeof raw.actual==="string")||
    !(finite(raw.required)||typeof raw.required==="string")||typeof raw.reason!=="string")return null;
   found.set(raw.key,{key:raw.key,state:raw.state,actual:raw.actual as number|string|null,
    required:raw.required as number|string,reason:raw.reason});
  }
  if(!gateKeys.every(key=>found.has(key))||!state(x.routeGate.state)||
   !Array.isArray(x.routeGate.routes)||x.routeGate.routes.some(y=>typeof y!=="string")||
   typeof x.routeGate.reason!=="string")return null;
  // A route PASS cannot come from a standalone telemetry claim.
  // Verify its exact emitted route inventory against the paired original V4 decision.
  const emitted=(decision.candidates as unknown[]).filter(y=>object(y)&&y.symbol===x.symbol)
    .map(y=>(y as Obj).route).filter(y=>typeof y==="string") as string[];
  const rejected=(decision.filtered as unknown[]).filter(y=>object(y)&&y.symbol===x.symbol)
    .map(y=>(y as Obj).route).filter(y=>typeof y==="string") as string[];
  const actualRoutes=[...new Set(x.routeGate.routes as string[])].sort();
  const expectedRoutes=[...new Set(emitted.length?emitted:rejected)].sort();
  if(actualRoutes.length!==expectedRoutes.length||
    actualRoutes.some((name,i)=>name!==expectedRoutes[i])||
    (emitted.length>0&&x.routeGate.state!=="PASS")||
    (emitted.length===0&&rejected.length>0&&x.routeGate.state!=="BLOCK")||
    (emitted.length===0&&rejected.length===0&&x.routeGate.state!=="NOT_EVALUATED"))return null;
  seen.add(x.symbol);
  items.push({symbol:x.symbol,nativeSide:x.nativeSide,sourceEligible:x.sourceEligible,
   sourceReason:x.sourceReason,portfolioRank:x.portfolioRank,nativeScore:x.nativeScore,
   gates:[...found.values()],routeGate:{state:x.routeGate.state,
     routes:x.routeGate.routes as string[],reason:x.routeGate.reason}});
 }
 if(seen.size!==14)return null;
 return {verified:true,releaseSha:sha,decisionTs:gates.decisionTs,capturedAtMs:gates.capturedAtMs,
  sourceFingerprint:gates.sourceFingerprint,symbols:items};
}
