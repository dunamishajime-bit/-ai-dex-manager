/** Deterministic source-candidate coordination for research, never dispatches orders. */
import {evaluateStable4DryEntry,type Proposed,type OpenRisk,type RiskInput} from "./stable4-seven-runner-dryrun-gate";
const H=3600000;
export const STABLE4_SOURCE_PRIORITY={V52:0,PENGU:1,V4:2,Q102:3,FET:4,HYPE:5,IDLE:6} as const;
export type SourceCandidate=Proposed&{sourceReleaseSha:string;sourceDecisionTs:number;sourceComplete:boolean};
export type CoordinatorInput=Omit<RiskInput,"candidate"|"open">&{
 candidates:readonly SourceCandidate[];open:readonly OpenRisk[];
 allOwnerPositionsReconciled:boolean;r21SlotStateReconciled:boolean;
 sourcePins:Readonly<Record<Proposed["sleeve"],string>>;
 lastR21ExitBySymbol:Readonly<Record<string,number>>;
};
export type CoordinatorDecision={candidateId:string;sleeve:SourceCandidate["sleeve"];status:"RETAINED_OFFLINE"|"BLOCKED";reason:string;orderAuthority:false};
export function coordinateStable4DryCandidates(input:CoordinatorInput){
 const ordered=[...input.candidates].sort((a,b)=>
  STABLE4_SOURCE_PRIORITY[a.sleeve]-STABLE4_SOURCE_PRIORITY[b.sleeve]||
  (a.route.startsWith("R21_")?0:1)-(b.route.startsWith("R21_")?0:1)||
  a.symbol.localeCompare(b.symbol)||a.id.localeCompare(b.id));
 const open=[...input.open];const decisions:CoordinatorDecision[]=[],seen=new Set<string>();
 for(const c of ordered){
  const block=(reason:string):CoordinatorDecision=>({candidateId:c.id,sleeve:c.sleeve,status:"BLOCKED",reason,orderAuthority:false});
  if(seen.has(c.id)){decisions.push(block("CANDIDATE_DUPLICATE"));continue;}
  seen.add(c.id);
  if(!input.allOwnerPositionsReconciled||open.some(x=>x.status==="UNKNOWN")){decisions.push(block("ALL_OWNER_POSITIONS_UNVERIFIED"));continue;}
  if(!/^[a-f0-9]{40}$/.test(input.sourcePins?.[c.sleeve]??"")||c.sourceReleaseSha!==input.sourcePins[c.sleeve]||c.sourceDecisionTs!==Math.floor(input.asof/H)*H||c.sourceComplete!==true){
   decisions.push(block("NATIVE_SOURCE_UNVERIFIED"));continue;
  }
  if(c.route==="IDLE_RENDER_RELATIVE_SHORT"){decisions.push(block("IDLE_R26_RENDER_REMOVED"));continue;}
  if(c.route.startsWith("R21_")){
   if(!input.r21SlotStateReconciled){decisions.push(block("R21_SLOT_NOT_RECONCILED"));continue;}
   const last=input.lastR21ExitBySymbol[c.symbol];
   if(last!==undefined&&(!Number.isSafeInteger(last)||last>c.entryTs||c.entryTs<last+12*H)){
    decisions.push(block("R21_COOLDOWN_12H"));continue;
   }
  }
  const v=evaluateStable4DryEntry({...input,candidate:c,open});
  if(v.status!=="ELIGIBLE_OFFLINE"){decisions.push(block(v.reason));continue;}
  // A dry-run reservation is counted immediately, even if another native
  // candidate arrives in the exact same clock tick.
  open.push({id:c.id,sleeve:c.sleeve,symbol:c.symbol,route:c.route,
   gross:c.gross,stock:c.sleeve==="V52",status:"PENDING"});
  decisions.push({candidateId:c.id,sleeve:c.sleeve,status:"RETAINED_OFFLINE",
   reason:"SOURCE_AND_RISK_CHECKS_PASS_NO_ORDER_AUTHORITY",orderAuthority:false});
 }
 return {decisions,offlinePending:open.filter(x=>!input.open.includes(x)),orderAuthority:false as const};
}
