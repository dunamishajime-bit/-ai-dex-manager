import {V12_V4_MAXIMUM_DRAWDOWN} from "../config/v12V4AdoptionRiskPolicy";
/** Fail-closed, evidence-only classification. This module never grants order authority. */
import {V12_V4_V2_POLICY,V12_V4_V2_CAPS,V12_V4_V2_BT,V12_V4_V2_PRIORITY} from "./v12-v4-v2-shadow";
import {PRODUCTION_EXIT_CATALOG} from "./v12-v4-production-lifecycle";
import type {V4InventoryVerdict} from "./v12-v4-account-inventory";
export const V4_RANKING_CUTOFF_EXCLUSIVE_MS=Date.parse("2026-08-11T00:00:00Z");
export type CertificationEvidence={
 policyId:typeof V12_V4_V2_POLICY; evaluatedAtMs:number;
 signalEntryTimesMs:number[];
 /** Independently linked current native generator parity proof, not a candidate payload boolean. */
 nativeSignalProof?:{sourceSha:string; reportSha256:string; mismatches:number; samples:number};
 nativeExitProof?:{sourceRows:number; matching:number; mismatches:number; priceModelOnly:boolean};
 account?:{capturedAtMs:number; holdProtected:boolean; pendingReconciled:boolean; ownerInventoryVerified:boolean;
  /** Actual signed GET readback matched against all current owner snapshots. */
  inventory?:V4InventoryVerdict;
  /** Legacy fields are never accepted as proof of current ownership. */
  protectedPenguQty?:number; protectedTslaQty?:number; releaseCoherent:boolean; quoteFresh:boolean};
 venueQuantityAndFillProof?:{reportSha256:string; samples:number; mismatches:number; l2Verified:boolean};
 wholePortfolioExternalProof?:{reportSha256:string; nonV12ProgramsSha:string; costsBps:readonly number[]; eventMismatches:number};
};
function positiveSampleCount(value:unknown){return typeof value==="number"&&Number.isSafeInteger(value)&&value>0;}
function sha(value:unknown,length:number){return typeof value==="string"&&new RegExp("^[a-fA-F0-9]{"+length+"}$").test(value);}
export function certifyV4Production(e:CertificationEvidence){
 if(e.policyId!==V12_V4_V2_POLICY||!Number.isFinite(e.evaluatedAtMs)||!Array.isArray(e.signalEntryTimesMs)||
  e.signalEntryTimesMs.some(t=>!Number.isFinite(t)||t>e.evaluatedAtMs))throw Error("INVALID_CERTIFICATION_EVIDENCE");
 const blockers:string[]=[];
 const add=(condition:boolean,reason:string)=>{if(condition)blockers.push(reason);};
 const policyTemporalCausal=e.signalEntryTimesMs.length>0&&e.signalEntryTimesMs.every(t=>t>=V4_RANKING_CUTOFF_EXCLUSIVE_MS);
 add(!policyTemporalCausal,"HISTORICAL_FULL_YEAR_RANKING_LOOKAHEAD_OR_NO_FORWARD_SIGNALS");
 add(V12_V4_V2_BT.externalY06.profitFactor10bps<1,"OBSERVED_EXTERNAL_Y06_PF_FAILED");
 add(Math.abs(V12_V4_V2_BT.costs["10bps"].dd)>V12_V4_MAXIMUM_DRAWDOWN+1e-12||Math.abs(V12_V4_V2_BT.costs["20bps"].dd)>V12_V4_MAXIMUM_DRAWDOWN+1e-12,"OBSERVED_DEVELOPMENT_DD_OVER_OPERATOR_LIMIT");
 add(PRODUCTION_EXIT_CATALOG.length!==41||V12_V4_V2_PRIORITY.length!==41,"FROZEN_41_ROUTE_CONTRACT_INVALID");
 const n=e.nativeSignalProof;
 add(!n||!sha(n.sourceSha,40)||!sha(n.reportSha256,64)||!positiveSampleCount(n.samples)||n.mismatches!==0,"NATIVE_SIGNAL_SOURCE_PARITY_NOT_CERTIFIED");
 const x=e.nativeExitProof;
 add(!x||x.sourceRows!==1978||x.matching!==1978||x.mismatches!==0,"NATIVE_EXIT_1978_EVENT_PARITY_NOT_VERIFIED");
 // H1 exit parity does not certify venue resident protection or intrabar executability.
 add(!x||x.priceModelOnly!==false,"H1_PRICE_MODEL_IS_NOT_VENUE_EXIT_CERTIFICATION");
 const a=e.account;
 add(!a||!Number.isFinite(a.capturedAtMs)||a.capturedAtMs>e.evaluatedAtMs||e.evaluatedAtMs-a.capturedAtMs>30000,"FRESH_ACCOUNT_READBACK_REQUIRED");
 add(!a||a.holdProtected!==false,"HOLD_PROTECTED_OR_HOLD_STATUS_UNKNOWN");
 add(!a||a.pendingReconciled!==true,"PENDING_ORDER_RECONCILIATION_REQUIRED");
 add(!a||a.ownerInventoryVerified!==true||!a.inventory||a.inventory.verified!==true||a.inventory.blockers.length!==0||a.inventory.capturedAtMs!==a.capturedAtMs,"CURRENT_SIGNED_ACCOUNT_OWNERSHIP_NOT_VERIFIED");
 add(!a||a.releaseCoherent!==true||a.quoteFresh!==true,"RELEASE_OR_QUOTE_HEALTH_NOT_VERIFIED");
 const v=e.venueQuantityAndFillProof;
 add(!v||!sha(v.reportSha256,64)||!positiveSampleCount(v.samples)||v.mismatches!==0||v.l2Verified!==true,"VENUE_QUANTITY_FILL_AND_L2_PARITY_REQUIRED");
 const p=e.wholePortfolioExternalProof;
 add(!p||!sha(p.reportSha256,64)||!sha(p.nonV12ProgramsSha,40)||p.eventMismatches!==0||
  ![10,20,30].every(c=>p.costsBps.includes(c)),"EXACT_NON_V12_AND_V4_EXTERNAL_PORTFOLIO_PARITY_REQUIRED");
 // Neither evidence payloads nor a future clean test report may auto-enable the strategy.
 blockers.push("SEPARATE_OPERATOR_ACTIVATION_REQUIRED");
 return {status:"BLOCKED_PRODUCTION_PARITY" as const,policyId:V12_V4_V2_POLICY,policyTemporalCausal,
  evaluatedAtMs:e.evaluatedAtMs,signalEntryTimesMs:[...e.signalEntryTimesMs],
  rankingTrainingCutoffExclusiveMs:V4_RANKING_CUTOFF_EXCLUSIVE_MS,fullYearRankingHindsight:true as const,
  caps:V12_V4_V2_CAPS,routeCount:PRODUCTION_EXIT_CATALOG.length,blockers,
  orderEnabled:false as const,realOrderEnabledV4:0 as const,tradingMutation:0 as const};
}
