/**
 * V12 V4 D-tier capacity-yield PROPOSAL ONLY.
 *
 * A lower-priority V12 V4 D position may be considered for yielding ONLY when
 * the intended higher-priority order cannot use any applicable shared Gross.
 *
 * This pure planner has ZERO venue/exit/order side effects and never grants
 * authority to close or replace a protected position. The actual cross-runner
 * atomic handoff, signed fills and resident-STOP lifecycle require separate
 * account-owner certification before enabling any live mutation.
 */
import { V12_V4_D_APPROVED_GROSS_BY_ROUTE } from "./v12-v4-v2-shadow";

const EPS = 1e-9;
export type V4DYieldVictim = {
  legId: string; route: string; symbol: string; side: "LONG" | "SHORT";
  status: "OPEN" | "PENDING_ENTRY" | "PENDING_EXIT" | "CLOSED";
  qty: number; acceptedGross: number; priorityRank: number;
  entryTsMs: number; residentStopCertified: boolean; noPendingOrder: boolean;
};
export type V4DYieldInput = {
  decisionTsMs: number; observedAtMs: number;
  /** Signifies a higher-priority candidate passing EVERY gate except shortage. */
  higherCandidate: {
    strategyId: string; route: string; symbol: string; priorityRank: number;
    requestedGross: number; eligibleAfterAllNonCapacityGates: boolean;
    minVenueOrderFeasible: boolean; rankProven: boolean;
    /** Admission would otherwise be possible; do not yield to only top up an existing valid entry. */
    blockedSolelyBySharedGross: boolean;
  };
  /** From a signed, coherent account snapshot; includes foreign and pending reservations. */
  shared: {
    applicableFreeGross: number; totalFreeGross: number; strategyFreeGross: number;
    fullyReconciledPendingAndOpenOrders: boolean;
    accountLeaseHeld: boolean; sharedRiskGreen: boolean; marginGuardGreen: boolean;
    killSwitchGreen: boolean; signedVenueSnapshot: boolean;
  };
  protectedDLegs: readonly V4DYieldVictim[];
};
export type V4DYieldProposal =
 | {kind:"NO_YIELD";reason:string;victimLegIds:readonly []}
 | {kind:"STAGED_HANDOFF_CANDIDATE_ONLY";reason:"ZERO_SHARED_GROSS_CONFIRMED";
    victimLegIds:readonly string[]; estimatedGrossFreed:number;
    /** Staging this proposal is NOT permission to send reduce-only orders. */
    venueMutationAuthorized:false};

function finiteNonnegative(n:number):boolean {
  return typeof n==="number" && Number.isFinite(n) && n>=0;
}
export function evaluateV12V4DZeroGrossYield(input: V4DYieldInput): V4DYieldProposal {
  const no=(reason:string):V4DYieldProposal=>({kind:"NO_YIELD",reason,victimLegIds:[]});
  const {higherCandidate:h,shared:s}=input;
  if(!Number.isFinite(input.decisionTsMs) || !Number.isFinite(input.observedAtMs) ||
     input.decisionTsMs<=0 || input.observedAtMs<input.decisionTsMs ||
     input.observedAtMs-input.decisionTsMs>15*60_000) return no("DECISION_STALE_OR_INVALID");
  if(!h.strategyId || !h.symbol || !h.route || !Number.isFinite(h.priorityRank) ||
     !(h.requestedGross>0) || !Number.isFinite(h.requestedGross) ||
     !finiteNonnegative(s.applicableFreeGross) ||
     !finiteNonnegative(s.totalFreeGross) ||
     !finiteNonnegative(s.strategyFreeGross)) return no("SOURCE_OR_GROSS_INVALID");
  if(!s.fullyReconciledPendingAndOpenOrders || !s.accountLeaseHeld ||
     !s.signedVenueSnapshot) return no("ACCOUNT_EXPOSURE_OR_LOCK_NOT_CERTIFIED");
  if(!s.sharedRiskGreen || !s.marginGuardGreen || !s.killSwitchGreen)
    return no("SHARED_RISK_OR_KILL_SWITCH");
  if(!h.eligibleAfterAllNonCapacityGates || !h.minVenueOrderFeasible ||
     !h.rankProven || !h.blockedSolelyBySharedGross) return no("HIGHER_ENTRY_NOT_CERTIFIED");
  if(s.strategyFreeGross<=EPS) return no("UPPER_STRATEGY_OWN_CAP_EXHAUSTED");
  // Explicit user rule: even tiny POSITIVE available shared Gross blocks a yield.
  // Applicable shared room is the minimum relevant crypto/total class room.
  // Total gross alone can remain positive while crypto gross is exhausted.
  if(s.applicableFreeGross>s.totalFreeGross+EPS) return no("SHARED_GROSS_SNAPSHOT_INCONSISTENT");
  if(s.applicableFreeGross>EPS)
    return no("SHARED_GROSS_STILL_AVAILABLE");
  if(input.protectedDLegs.length===0) return no("NO_PROTECTED_D_LEG");
  const victims=input.protectedDLegs.filter(v=>{
    const permitted=V12_V4_D_APPROVED_GROSS_BY_ROUTE[v.route];
    return permitted!==undefined && v.status==="OPEN" &&
      v.symbol!==h.symbol && v.residentStopCertified && v.noPendingOrder &&
      Number.isFinite(v.entryTsMs) && v.entryTsMs<input.decisionTsMs &&
      Number.isFinite(v.qty) && v.qty>0 &&
      Number.isFinite(v.acceptedGross) && v.acceptedGross>EPS &&
      Number.isFinite(v.priorityRank) && v.priorityRank>h.priorityRank &&
      !!v.legId;
  }).sort((a,b)=>b.priorityRank-a.priorityRank || a.entryTsMs-b.entryTsMs ||
    a.legId.localeCompare(b.legId));
  if(victims.length===0) return no("NO_CERTIFIED_LOWER_PRIORITY_VICTIM");
  // Only propose enough capacity to satisfy the NEW minimum executable Gross.
  // Accounting/yield executor must recompute this against fresh signed venue data.
  const ids:string[]=[];let freed=0;
  for(const v of victims) {
    if(freed+EPS>=h.requestedGross) break;
    ids.push(v.legId);freed+=v.acceptedGross;
  }
  if(freed+EPS<h.requestedGross) return no("INSUFFICIENT_CERTIFIED_D_GROSS");
  return {kind:"STAGED_HANDOFF_CANDIDATE_ONLY",
    reason:"ZERO_SHARED_GROSS_CONFIRMED",victimLegIds:ids,
    estimatedGrossFreed:freed,venueMutationAuthorized:false};
}
