/** Live V4 Runner emits this observer result from the SAME completed H1/H2 candle batch
 * used for production route selection. No new venue reads or account mutations.
 * These facts are native source gates; V4 route evaluation is emitted-only, not 41-route coverage.
 */
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { observeV12NativeEntryGates, resampleV12H1ToH2, type V12Bar, type V12NativeGateObservation } from "./v12-x1-all";
import type { V4VenueH1Bar, V4LiveDecisionSnapshot } from "./v12-v4-live-candidate-builder";

export const V4_GATE_TELEMETRY_SCHEMA="disdex-v12-v4-gate-telemetry/v1" as const;
export type V4TelemetryState="PASS"|"BLOCK"|"NOT_EVALUATED";
export type V4RunnerSymbolGate={
 symbol:string;
 nativeSide:"LONG"|"SHORT"|null;
 sourceEligible:boolean|null;
 sourceReason:string;
 portfolioRank:number|null;
 nativeScore:number|null;
 gates:V12NativeGateObservation["gates"];
 routeGate:{state:V4TelemetryState;routes:string[];reason:string};
};
export type V4RunnerGateTelemetry={
 schema:typeof V4_GATE_TELEMETRY_SCHEMA;strategyId:"V12_V4";
 releaseSha:string;runtimeSha:string;activeRunnerSha:string;decisionTs:number;capturedAtMs:number;computedAtMs:number;
 sourceFingerprint:string;sourceCount:number;candidateCount:number;filteredCount:number;
 btcRegime:"LONG"|"SHORT"|"NEUTRAL";
 symbolCount:number;symbols:V4RunnerSymbolGate[];
 readOnly:true;orderEnabled:false;tradingMutation:0;
 source:"RUNNER_SAME_CLOSED_CANDLE_BATCH";
};
export function buildV4RunnerGateTelemetry(
 h1:Record<string,V4VenueH1Bar[]>, decision:V4LiveDecisionSnapshot, releaseSha:string, at=Date.now(),
):V4RunnerGateTelemetry{
 if(!/^[0-9a-f]{40}$/.test(releaseSha)||decision.schema!=="v12-v4-live-decision/v1"||
    decision.orderEnabled!==false||decision.tradingMutation!==0||decision.errors.length||
    !Number.isFinite(decision.decisionTs)||!Number.isFinite(decision.capturedAtMs)||
    decision.decisionTs>decision.capturedAtMs||at<decision.capturedAtMs-60_000||
    typeof decision.sourceFingerprint!=="string"||!/^[0-9a-f]{64}$/.test(decision.sourceFingerprint))
   throw Error("V4_GATE_TELEMETRY_UNTRUSTED_DECISION");
 const universe=V12_X1_ALL.universe;
 const h2:Record<string,V12Bar[]>={};
 for(const symbol of universe){
  const rows=h1[symbol];
  if(!Array.isArray(rows)||rows.length<245)throw Error("V4_GATE_TELEMETRY_H1_MISSING:"+symbol);
  h2[symbol]=resampleV12H1ToH2(rows.map(row=>({
   ...row,ts:row.openTs,volume:row.volume,closed:true as const,
  })));
 }
 const shared=universe.reduce<Set<number>|undefined>((set,symbol)=>{
  const ts=new Set(h2[symbol].map(b=>b.endTs));
  return set===undefined?ts:new Set([...set].filter(t=>ts.has(t)));
 },undefined);
 if(!shared||shared.size<121)throw Error("V4_GATE_TELEMETRY_H2_WARMUP");
 const aligned:Record<string,V12Bar[]>={};
 for(const symbol of universe)aligned[symbol]=h2[symbol].filter(b=>shared.has(b.endTs));
 const index=aligned.BTC.length-1;
 if(aligned.BTC[index]?.endTs!==decision.decisionTs||aligned.BTC.some((bar,i)=>i>0&&bar.ts!==aligned.BTC[i-1].endTs))
  throw Error("V4_GATE_TELEMETRY_DECISION_CLOCK_MISMATCH");
 const native=observeV12NativeEntryGates(aligned,index);
 if(!native||native.decisionTs!==decision.decisionTs||native.items.length!==universe.length)
  throw Error("V4_GATE_TELEMETRY_NATIVE_SOURCE_MISMATCH");
 const symbols=native.items.map(row=>{
  const candidates=decision.candidates.filter(c=>c.symbol===row.symbol+"USDT");
  const filtered=decision.filtered.filter(c=>c.symbol===row.symbol+"USDT");
  const routeGate:V4RunnerSymbolGate["routeGate"]=candidates.length?
   {state:"PASS",routes:[...new Set(candidates.map(c=>c.route))],reason:"V4_ROUTE_CANDIDATE_EMITTED"}:
   filtered.length?
   {state:"BLOCK",routes:[...new Set(filtered.map(c=>c.route))],reason:[...new Set(filtered.map(c=>c.reason))].join(";").slice(0,360)}:
   {state:"NOT_EVALUATED",routes:[],reason:"NO_ROUTE_RESULT_EMITTED_NOT_41_ROUTE_VETO"};
  return {symbol:row.symbol+"USDT",nativeSide:row.side,sourceEligible:row.sourceEligible,
    sourceReason:row.sourceReason,portfolioRank:row.portfolioRank,nativeScore:row.rawScore,
    gates:row.gates,routeGate} satisfies V4RunnerSymbolGate;
 });
 if(decision.candidateCount!==decision.candidates.length||decision.filteredCount!==decision.filtered.length||
    new Set(symbols.map(s=>s.symbol)).size!==universe.length)throw Error("V4_GATE_TELEMETRY_COUNT_MISMATCH");
 return {schema:V4_GATE_TELEMETRY_SCHEMA,strategyId:"V12_V4",
  releaseSha,runtimeSha:releaseSha,activeRunnerSha:releaseSha,decisionTs:decision.decisionTs,capturedAtMs:decision.capturedAtMs,computedAtMs:at,
  sourceFingerprint:decision.sourceFingerprint,sourceCount:decision.sourceCount,
  candidateCount:decision.candidateCount,filteredCount:decision.filteredCount,
  btcRegime:native.regime,symbolCount:symbols.length,symbols,
  readOnly:true,orderEnabled:false,tradingMutation:0,source:"RUNNER_SAME_CLOSED_CANDLE_BATCH"};
}
